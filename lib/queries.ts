import "server-only";

import { createClient } from "@/lib/supabase/server";
import { STAGE_ORDER, type StageId } from "@/lib/stages";
import type {
  Addon,
  Cadence,
  CalendarAccount,
  Lead,
  Meeting,
  MonthlySnapshot,
  NamedItem,
  Package,
  Tag,
  TeamShare,
  Workspace,
} from "@/lib/types";

/**
 * Loads the entire workspace in one pass.
 *
 * This looks greedy and is deliberate: Upforce runs a few hundred leads at
 * most, and every view here (queue, board, table, revenue, calendar) reads
 * across all of them. Fetching per-view would mean five round trips showing
 * five slightly different snapshots of the same pipeline - the stat cards
 * disagreeing with the table underneath them is exactly the bug that erodes
 * trust in a CRM. One read, one snapshot, held client-side for the session.
 */
export async function getWorkspace(): Promise<Workspace> {
  const supabase = createClient();

  const [
    leads,
    socials,
    leadTags,
    leadAddons,
    touches,
    tags,
    platforms,
    sources,
    packages,
    addons,
    cadences,
    cadenceSteps,
    meetings,
    calendarAccounts,
    settings,
    history,
  ] = await Promise.all([
    supabase
      .from("leads")
      .select(
        "id,name,audience,stage,stage_entered_at,touches,quoted_value_cents,notes,email,phone,source_id,package_id,lost_reason,created_at"
      )
      .order("created_at", { ascending: true }),
    supabase
      .from("lead_socials")
      .select("id,lead_id,platform,handle,sort")
      .order("sort", { ascending: true }),
    supabase.from("lead_tags").select("lead_id,tag_id"),
    supabase.from("lead_addons").select("lead_id,addon_id"),
    supabase
      .from("touches")
      .select("id,lead_id,channel,detail,created_at")
      .order("created_at", { ascending: false }),
    supabase.from("tags").select("id,name,color,sort").order("sort"),
    supabase.from("platforms").select("id,name,sort").order("sort"),
    supabase.from("sources").select("id,name,sort").order("sort"),
    supabase.from("packages").select("id,name,price_cents,sort").order("sort"),
    supabase.from("addons").select("id,name,price_cents,sort").order("sort"),
    supabase.from("cadences").select("stage,demote_day"),
    supabase
      .from("cadence_steps")
      .select("id,stage,day,label,sort")
      .order("sort", { ascending: true }),
    supabase
      .from("meetings")
      .select("id,day_of_week,time_label,title,kind,lead_id")
      .order("time_label", { ascending: true }),
    supabase
      .from("calendar_accounts")
      .select("id,key,name,detail,connected,sort")
      .order("sort"),
    supabase.from("app_settings").select("key,value"),
    /* Two years is plenty for a month-over-month table and keeps the payload
       bounded no matter how long the workspace runs. */
    supabase
      .from("monthly_snapshots")
      .select(
        "month,active_mrr_cents,pipeline_mrr_cents,lead_count,converted_count,stage_counts,stage_values,won_count,lost_count"
      )
      .order("month", { ascending: false })
      .limit(24),
  ]);

  const failure = [
    leads,
    socials,
    leadTags,
    leadAddons,
    touches,
    tags,
    platforms,
    sources,
    packages,
    addons,
    cadences,
    cadenceSteps,
    meetings,
    calendarAccounts,
    settings,
    history,
  ].find((r) => r.error);

  if (failure?.error) throw new Error(failure.error.message);

  /* Group the joins once rather than filtering the same arrays inside a
     sixteen-iteration loop - the difference does not matter at this size, but
     the shape is what a larger workspace would need. */
  const socialsBy = groupBy(socials.data ?? [], (r) => r.lead_id);
  const tagsBy = groupBy(leadTags.data ?? [], (r) => r.lead_id);
  const addonsBy = groupBy(leadAddons.data ?? [], (r) => r.lead_id);
  const touchesBy = groupBy(touches.data ?? [], (r) => r.lead_id);

  const mappedLeads: Lead[] = (leads.data ?? []).map((row) => {
    const rowSocials = (socialsBy.get(row.id) ?? []).sort(
      (a, b) => a.sort - b.sort
    );
    const primary = rowSocials[0];

    return {
      id: row.id,
      name: row.name,
      // Denormalised from the primary account so list rows need no join.
      handle: primary?.handle ?? "",
      platform: primary?.platform ?? "",
      audience: row.audience ?? "",
      stage: row.stage as StageId,
      stageEnteredAt: row.stage_entered_at,
      touches: row.touches,
      quotedValueCents: row.quoted_value_cents,
      notes: row.notes ?? "",
      email: row.email ?? "",
      phone: row.phone ?? "",
      sourceId: row.source_id,
      packageId: row.package_id,
      lostReason: row.lost_reason ?? null,
      addonIds: (addonsBy.get(row.id) ?? []).map((r) => r.addon_id),
      tagIds: (tagsBy.get(row.id) ?? []).map((r) => r.tag_id),
      socials: rowSocials.map((s) => ({
        id: s.id,
        platform: s.platform,
        handle: s.handle,
        sort: s.sort,
      })),
      history: (touchesBy.get(row.id) ?? []).map((t) => ({
        id: t.id,
        channel: t.channel,
        detail: t.detail,
        createdAt: t.created_at,
      })),
      createdAt: row.created_at,
    };
  });

  /* Every stage must have a cadence entry even if the table is missing one,
     or the drawer for a lead in that stage would throw rather than render. */
  const cadenceMap = {} as Record<StageId, Cadence>;
  for (const stage of STAGE_ORDER) {
    const row = (cadences.data ?? []).find((c) => c.stage === stage);
    cadenceMap[stage] = {
      stage,
      demoteDay: row?.demote_day ?? 30,
      steps: (cadenceSteps.data ?? [])
        .filter((s) => s.stage === stage)
        .sort((a, b) => a.sort - b.sort)
        .map((s) => ({ id: s.id, day: s.day, label: s.label })),
    };
  }

  const shareRow = (settings.data ?? []).find((s) => s.key === "team_share");
  const teamShare: TeamShare = {
    url:
      (shareRow?.value as TeamShare | undefined)?.url ??
      "app.cadencedock.com/team/upforce",
    shared: (shareRow?.value as TeamShare | undefined)?.shared ?? true,
  };

  return {
    leads: mappedLeads,
    tags: (tags.data ?? []) as Tag[],
    platforms: (platforms.data ?? []) as NamedItem[],
    sources: (sources.data ?? []) as NamedItem[],
    packages: (packages.data ?? []).map(
      (p): Package => ({
        id: p.id,
        name: p.name,
        priceCents: p.price_cents,
        sort: p.sort,
      })
    ),
    addons: (addons.data ?? []).map(
      (a): Addon => ({
        id: a.id,
        name: a.name,
        priceCents: a.price_cents,
        sort: a.sort,
      })
    ),
    cadences: cadenceMap,
    meetings: (meetings.data ?? []).map(
      (m): Meeting => ({
        id: m.id,
        day: m.day_of_week,
        time: m.time_label,
        title: m.title,
        kind: m.kind,
        leadId: m.lead_id,
      })
    ),
    calendarAccounts: (calendarAccounts.data ?? []).map(
      (c): CalendarAccount => ({
        id: c.id,
        key: c.key,
        name: c.name,
        detail: c.detail,
        connected: c.connected,
      })
    ),
    teamShare,
    history: (history.data ?? []).map(
      (h): MonthlySnapshot => ({
        month: h.month,
        activeMrrCents: h.active_mrr_cents,
        pipelineMrrCents: h.pipeline_mrr_cents,
        leadCount: h.lead_count,
        convertedCount: h.converted_count,
        stageCounts: (h.stage_counts ?? {}) as MonthlySnapshot["stageCounts"],
        stageValues: (h.stage_values ?? {}) as MonthlySnapshot["stageValues"],
        wonCount: h.won_count,
        lostCount: h.lost_count,
      })
    ),
  };
}

function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = out.get(k);
    if (bucket) bucket.push(row);
    else out.set(k, [row]);
  }
  return out;
}

export async function getSignedInProfile() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("id,email,full_name")
    .eq("id", user.id)
    .maybeSingle();

  return (
    data ?? {
      id: user.id,
      email: user.email ?? "",
      full_name: (user.email ?? "").split("@")[0],
    }
  );
}
