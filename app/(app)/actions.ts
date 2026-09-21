"use server";

import { createClient } from "@/lib/supabase/server";
import { isStageId, type Channel, type StageId } from "@/lib/stages";

/* ---------------------------------------------------------------------------
   Every mutation in the app.

   Two rules hold throughout, both learned from the prototype:

   1. An action takes stable identifiers only - a lead id, a tag id, a desired
      boolean - never a derived value read from a snapshot the caller happened
      to be holding. Toggles derived from stale reads were the single largest
      source of bugs in the design build.

   2. Writes are idempotent where the shape allows it. Setting a tag on a lead
      twice must land the same as setting it once, so a double-click or a
      retried request cannot corrupt state.
   --------------------------------------------------------------------------- */

export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function fail(message: string): { ok: false; error: string } {
  return { ok: false, error: message };
}

const OK = { ok: true, data: null } as const;

/* --- Leads ----------------------------------------------------------------- */

/**
 * Logs a touch and advances the ladder.
 *
 * The increment is read-modify-write rather than a raw `touches + 1` in SQL,
 * which is a real (if small) race if two people log the same lead at once.
 * Accepted here because the alternative - a stored procedure - buys atomicity
 * the team size does not need, and a double-logged touch is visible and
 * correctable in the history list rather than silent.
 */
export async function logTouch(
  leadId: string,
  channel: Channel,
  detail: string
): Promise<ActionResult<{ id: string }>> {
  const supabase = createClient();

  // maybeSingle, not single: when the lead is gone, single() reports it as
  // "Cannot coerce the result to a single JSON object", which is PostgREST
  // talking to itself rather than to the person who clicked.
  const { data: lead, error: readError } = await supabase
    .from("leads")
    .select("touches")
    .eq("id", leadId)
    .maybeSingle();

  if (readError) return fail(readError.message);
  if (!lead) return fail("That lead no longer exists — it may have just been deleted.");

  // The new row's id goes back to the client, which is holding a temporary
  // one. Without it an immediate Undo would ask the database to delete a row
  // under an id the database has never seen.
  const { data: touch, error: touchError } = await supabase
    .from("touches")
    .insert({ lead_id: leadId, channel, detail })
    .select("id")
    .single();

  if (touchError || !touch)
    return fail(touchError?.message ?? "Could not log the touch.");

  const { error } = await supabase
    .from("leads")
    .update({ touches: lead.touches + 1 })
    .eq("id", leadId);

  return error ? fail(error.message) : { ok: true, data: { id: touch.id } };
}

/**
 * Takes back the most recent touch and steps the ladder back one rung.
 *
 * Only the most recent, and only while the ladder has something to give
 * back. The ladder position is a counter, not a pointer at particular history
 * rows - and history keeps touches from earlier stages, which a stage change
 * has already zeroed out of the counter. Undoing any row but the latest would
 * move the ladder for a reason that has nothing to do with that row.
 *
 * Takes the touch id rather than "whatever is latest" so a double-click cannot
 * undo two touches: the second call names a row that no longer exists, and
 * fails instead of quietly taking the one before it.
 */
export async function undoTouch(
  leadId: string,
  touchId: string
): Promise<ActionResult> {
  const supabase = createClient();

  const [{ data: lead, error: leadError }, { data: latest, error: latestError }] =
    await Promise.all([
      supabase.from("leads").select("touches").eq("id", leadId).maybeSingle(),
      supabase
        .from("touches")
        .select("id")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  if (leadError) return fail(leadError.message);
  if (latestError) return fail(latestError.message);
  if (!lead) return fail("That lead no longer exists — it may have just been deleted.");

  if (!latest || latest.id !== touchId)
    return fail("Only the most recent touch can be undone.");
  if (lead.touches <= 0)
    return fail("That touch belongs to an earlier stage, so there is nothing to step back.");

  const { error: deleteError } = await supabase
    .from("touches")
    .delete()
    .eq("id", touchId)
    .eq("lead_id", leadId);

  if (deleteError) return fail(deleteError.message);

  const { error } = await supabase
    .from("leads")
    .update({ touches: lead.touches - 1 })
    .eq("id", leadId);

  return error ? fail(error.message) : OK;
}

/**
 * Moves a lead to a stage and restarts its clock.
 *
 * Resetting `stage_entered_at` and `touches` together is the whole contract of
 * a stage change - a lead that arrives in Warm carrying three spent touches
 * would show as immediately due to demote.
 */
export async function moveStage(
  leadId: string,
  stage: string
): Promise<ActionResult> {
  if (!isStageId(stage)) return fail("Unknown stage.");

  const supabase = createClient();
  const { error } = await supabase
    .from("leads")
    .update({
      stage,
      stage_entered_at: new Date().toISOString(),
      touches: 0,
    })
    .eq("id", leadId);

  return error ? fail(error.message) : OK;
}

/**
 * Pushes the clock back, buying a few more days before the next touch is due.
 *
 * Implemented by moving `stage_entered_at` forward rather than storing a
 * snooze-until date: the clock stays the single source of truth, so nothing
 * else in the app has to learn about a second kind of deadline.
 */
export async function snoozeLead(
  leadId: string,
  days = 3
): Promise<ActionResult> {
  const supabase = createClient();

  const { data: lead, error: readError } = await supabase
    .from("leads")
    .select("stage_entered_at")
    .eq("id", leadId)
    .single();

  if (readError || !lead) return fail(readError?.message ?? "Lead not found.");

  const entered = new Date(lead.stage_entered_at);
  entered.setDate(entered.getDate() + days);

  // Never push the entry date into the future - that would read as a negative
  // age and put the lead below zero days in stage.
  const capped = entered > new Date() ? new Date() : entered;

  const { error } = await supabase
    .from("leads")
    .update({ stage_entered_at: capped.toISOString() })
    .eq("id", leadId);

  return error ? fail(error.message) : OK;
}

export type LeadPatch = {
  name?: string;
  audience?: string;
  notes?: string;
  sourceId?: string | null;
  packageId?: string | null;
  quotedValueCents?: number | null;
};

export async function updateLead(
  leadId: string,
  patch: LeadPatch
): Promise<ActionResult> {
  const supabase = createClient();

  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.audience !== undefined) row.audience = patch.audience;
  if (patch.notes !== undefined) row.notes = patch.notes;
  if (patch.sourceId !== undefined) row.source_id = patch.sourceId;
  if (patch.packageId !== undefined) row.package_id = patch.packageId;
  if (patch.quotedValueCents !== undefined)
    row.quoted_value_cents = patch.quotedValueCents;

  if (Object.keys(row).length === 0) return OK;
  if (row.name === "") return fail("A lead needs a name.");

  const { error } = await supabase.from("leads").update(row).eq("id", leadId);
  return error ? fail(error.message) : OK;
}

export type NewLead = {
  name: string;
  stage: string;
  accounts: { platform: string; handle: string }[];
};

export async function createLead(
  input: NewLead
): Promise<ActionResult<{ id: string }>> {
  const name = input.name.trim();
  if (!name) return fail("A lead needs a name.");
  if (!isStageId(input.stage)) return fail("Unknown stage.");

  const accounts = input.accounts
    .map((a) => ({ platform: a.platform, handle: a.handle.trim() }))
    .filter((a) => a.handle);

  const supabase = createClient();

  const { data, error } = await supabase
    .from("leads")
    .insert({ name, stage: input.stage })
    .select("id")
    .single();

  if (error || !data) return fail(error?.message ?? "Could not create lead.");

  if (accounts.length > 0) {
    const { error: socialError } = await supabase.from("lead_socials").insert(
      accounts.map((a, i) => ({
        lead_id: data.id,
        platform: a.platform,
        handle: a.handle,
        sort: i,
      }))
    );
    if (socialError) return fail(socialError.message);
  }

  return { ok: true, data: { id: data.id } };
}

export async function deleteLead(leadId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("leads").delete().eq("id", leadId);
  return error ? fail(error.message) : OK;
}

/* --- Lead relations -------------------------------------------------------- */

/**
 * The desired boolean arrives from the event, not from a snapshot.
 *
 * This is why the tag chips in the drawer are real checkboxes: the browser
 * tells us what the user wants the state to be, so there is nothing to derive
 * and nothing to read stale.
 */
export async function setLeadTag(
  leadId: string,
  tagId: string,
  on: boolean
): Promise<ActionResult> {
  const supabase = createClient();

  const { error } = on
    ? await supabase
        .from("lead_tags")
        .upsert({ lead_id: leadId, tag_id: tagId }, { ignoreDuplicates: true })
    : await supabase
        .from("lead_tags")
        .delete()
        .eq("lead_id", leadId)
        .eq("tag_id", tagId);

  return error ? fail(error.message) : OK;
}

export async function setLeadAddon(
  leadId: string,
  addonId: string,
  on: boolean
): Promise<ActionResult> {
  const supabase = createClient();

  const { error } = on
    ? await supabase
        .from("lead_addons")
        .upsert(
          { lead_id: leadId, addon_id: addonId },
          { ignoreDuplicates: true }
        )
    : await supabase
        .from("lead_addons")
        .delete()
        .eq("lead_id", leadId)
        .eq("addon_id", addonId);

  return error ? fail(error.message) : OK;
}

export async function addSocial(
  leadId: string,
  platform: string,
  handle: string,
  sort: number
): Promise<ActionResult<{ id: string }>> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("lead_socials")
    .insert({ lead_id: leadId, platform, handle: handle.trim(), sort })
    .select("id")
    .single();

  if (error || !data) return fail(error?.message ?? "Could not add account.");
  return { ok: true, data: { id: data.id } };
}

export async function updateSocial(
  socialId: string,
  patch: { platform?: string; handle?: string }
): Promise<ActionResult> {
  const supabase = createClient();

  const row: Record<string, unknown> = {};
  if (patch.platform !== undefined) row.platform = patch.platform;
  if (patch.handle !== undefined) row.handle = patch.handle.trim();
  if (Object.keys(row).length === 0) return OK;

  const { error } = await supabase
    .from("lead_socials")
    .update(row)
    .eq("id", socialId);

  return error ? fail(error.message) : OK;
}

export async function removeSocial(socialId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase
    .from("lead_socials")
    .delete()
    .eq("id", socialId);
  return error ? fail(error.message) : OK;
}

/* --- Taxonomy -------------------------------------------------------------- */

export async function createTag(
  name: string,
  color: string
): Promise<ActionResult<{ id: string }>> {
  const trimmed = name.trim();
  if (!trimmed) return fail("A tag needs a name.");

  const supabase = createClient();
  const { data, error } = await supabase
    .from("tags")
    .insert({ name: trimmed, color })
    .select("id")
    .single();

  if (error || !data) return fail(error?.message ?? "Could not create tag.");
  return { ok: true, data: { id: data.id } };
}

/**
 * Renaming a tag rewrites it everywhere at once.
 *
 * Leads reference tags by id, so this is a single-row update - which is the
 * point of the join table. The prototype stored tag names on the lead and had
 * to walk every lead on rename; that version could half-apply.
 */
export async function updateTag(
  tagId: string,
  patch: { name?: string; color?: string }
): Promise<ActionResult> {
  const supabase = createClient();

  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim();
    if (!trimmed) return fail("A tag needs a name.");
    row.name = trimmed;
  }
  if (patch.color !== undefined) row.color = patch.color;
  if (Object.keys(row).length === 0) return OK;

  const { error } = await supabase.from("tags").update(row).eq("id", tagId);
  return error ? fail(error.message) : OK;
}

/** Cascades through lead_tags, so deleting a tag strips it from every lead. */
export async function deleteTag(tagId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("tags").delete().eq("id", tagId);
  return error ? fail(error.message) : OK;
}

type ListTable = "platforms" | "sources";

export async function addListItem(
  table: ListTable,
  name: string,
  sort: number
): Promise<ActionResult<{ id: string }>> {
  const trimmed = name.trim();
  if (!trimmed) return fail("Enter a name first.");

  const supabase = createClient();
  const { data, error } = await supabase
    .from(table)
    .insert({ name: trimmed, sort })
    .select("id")
    .single();

  if (error || !data) return fail(error?.message ?? "Could not add.");
  return { ok: true, data: { id: data.id } };
}

export async function removeListItem(
  table: ListTable,
  id: string
): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from(table).delete().eq("id", id);
  return error ? fail(error.message) : OK;
}

/* --- Pricing --------------------------------------------------------------- */

type PriceTable = "packages" | "addons";

export async function addPriced(
  table: PriceTable,
  name: string,
  priceCents: number,
  sort: number
): Promise<ActionResult<{ id: string }>> {
  const trimmed = name.trim();
  if (!trimmed) return fail("Enter a name first.");
  if (!Number.isFinite(priceCents) || priceCents < 0)
    return fail("Price must be zero or more.");

  const supabase = createClient();
  const { data, error } = await supabase
    .from(table)
    .insert({ name: trimmed, price_cents: Math.round(priceCents), sort })
    .select("id")
    .single();

  if (error || !data) return fail(error?.message ?? "Could not add.");
  return { ok: true, data: { id: data.id } };
}

export async function updatePriced(
  table: PriceTable,
  id: string,
  patch: { name?: string; priceCents?: number }
): Promise<ActionResult> {
  const supabase = createClient();

  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim();
    if (!trimmed) return fail("A name is required.");
    row.name = trimmed;
  }
  if (patch.priceCents !== undefined) {
    if (!Number.isFinite(patch.priceCents) || patch.priceCents < 0)
      return fail("Price must be zero or more.");
    row.price_cents = Math.round(patch.priceCents);
  }
  if (Object.keys(row).length === 0) return OK;

  const { error } = await supabase.from(table).update(row).eq("id", id);
  return error ? fail(error.message) : OK;
}

/**
 * Deleting a package leaves the leads on it with no package.
 *
 * `on delete set null` rather than a cascade: losing the price is recoverable,
 * losing the lead is not.
 */
export async function removePriced(
  table: PriceTable,
  id: string
): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from(table).delete().eq("id", id);
  return error ? fail(error.message) : OK;
}

/* --- Cadences -------------------------------------------------------------- */

/**
 * Editing a ladder reschedules every lead in that stage immediately.
 *
 * No migration or backfill is needed for that to be true: the next touch is
 * computed from the ladder at read time, so changing day 7 to day 5 moves
 * every Warm lead's clock the moment this returns.
 */
export async function updateCadenceStep(
  stepId: string,
  patch: { day?: number; label?: string }
): Promise<ActionResult> {
  const supabase = createClient();

  const row: Record<string, unknown> = {};
  if (patch.day !== undefined) {
    if (!Number.isFinite(patch.day) || patch.day < 0)
      return fail("A touch day must be zero or more.");
    row.day = Math.round(patch.day);
  }
  if (patch.label !== undefined) row.label = patch.label;
  if (Object.keys(row).length === 0) return OK;

  const { error } = await supabase
    .from("cadence_steps")
    .update(row)
    .eq("id", stepId);

  return error ? fail(error.message) : OK;
}

export async function addCadenceStep(
  stage: string,
  day: number,
  label: string,
  sort: number
): Promise<ActionResult<{ id: string }>> {
  if (!isStageId(stage)) return fail("Unknown stage.");

  const supabase = createClient();
  const { data, error } = await supabase
    .from("cadence_steps")
    .insert({ stage, day: Math.round(day), label, sort })
    .select("id")
    .single();

  if (error || !data) return fail(error?.message ?? "Could not add touch.");
  return { ok: true, data: { id: data.id } };
}

export async function removeCadenceStep(
  stepId: string
): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase
    .from("cadence_steps")
    .delete()
    .eq("id", stepId);
  return error ? fail(error.message) : OK;
}

export async function setDemoteDay(
  stage: string,
  day: number
): Promise<ActionResult> {
  if (!isStageId(stage)) return fail("Unknown stage.");
  if (!Number.isFinite(day) || day < 0)
    return fail("The demote day must be zero or more.");

  const supabase = createClient();
  const { error } = await supabase
    .from("cadences")
    .update({ demote_day: Math.round(day) })
    .eq("stage", stage as StageId);

  return error ? fail(error.message) : OK;
}

/* --- Calendar -------------------------------------------------------------- */

export async function createMeeting(input: {
  day: number;
  time: string;
  title: string;
  kind: "meeting" | "internal";
  leadId: string | null;
}): Promise<ActionResult<{ id: string }>> {
  const title = input.title.trim();
  if (!title) return fail("Give the meeting a title.");
  if (input.day < 0 || input.day > 6) return fail("Pick a day of the week.");

  const supabase = createClient();
  const { data, error } = await supabase
    .from("meetings")
    .insert({
      day_of_week: input.day,
      time_label: input.time,
      title,
      kind: input.kind,
      lead_id: input.leadId,
    })
    .select("id")
    .single();

  if (error || !data) return fail(error?.message ?? "Could not book.");
  return { ok: true, data: { id: data.id } };
}

export async function deleteMeeting(id: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("meetings").delete().eq("id", id);
  return error ? fail(error.message) : OK;
}

export async function setCalendarAccount(
  id: string,
  connected: boolean
): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase
    .from("calendar_accounts")
    .update({ connected })
    .eq("id", id);
  return error ? fail(error.message) : OK;
}

export async function setTeamShare(shared: boolean): Promise<ActionResult> {
  const supabase = createClient();

  const { data: existing } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "team_share")
    .maybeSingle();

  const value = {
    url:
      (existing?.value as { url?: string } | undefined)?.url ??
      "app.cadencedock.com/team/upforce",
    shared,
  };

  const { error } = await supabase
    .from("app_settings")
    .upsert({ key: "team_share", value });

  return error ? fail(error.message) : OK;
}
