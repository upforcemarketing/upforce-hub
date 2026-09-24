"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useHub } from "@/components/HubStore";
import { useUi } from "@/components/Shell";
import { Avatar, DueChip, StagePill } from "@/components/ui";
import { useDerivedLead } from "@/components/useDerived";
import { ProposalStatusPicker } from "@/components/ProposalStatusPicker";
import { useSetProposalStatus } from "@/components/useProposalStatus";
import {
  daysInStage,
  ink,
  money,
  moneyFull,
  relativeTime,
} from "@/lib/engine";
import { usd } from "@/lib/proposal";
import { CHANNELS, STAGES, STAGE_ORDER, type StageId } from "@/lib/stages";

/**
 * Everything about one lead, in the order a rep needs it.
 *
 * The clock comes first, then the two things that move it - a touch or a stage
 * change - then the record. Notes and history sit at the bottom because they
 * are read when something has already gone wrong, not on every visit.
 */
export function LeadDrawer() {
  const { selectedId, select } = useHub();
  const lead = useDerivedLead(selectedId);
  const panelRef = useRef<HTMLDivElement>(null);

  /* Escape closes, and focus moves into the panel on open so a keyboard user
     is not left tabbing through the view behind it. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") select(null);
    };
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [select]);

  if (!lead) return null;

  return (
    <div
      className="upf-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`${lead.name} details`}
      onClick={(e) => {
        if (e.target === e.currentTarget) select(null);
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="upf-card upf-pop"
        style={{
          width: "100%",
          maxWidth: 980,
          maxHeight: "calc(100vh - 48px)",
          overflowY: "auto",
          overscrollBehavior: "contain",
          boxShadow: "var(--shadow)",
          outline: "none",
        }}
      >
        <Header />
        <NextTouch />
        <MoveStage />
        <Proposals />

        {/* The two things worth acting on every visit (above) get the full
            width. Everything else is the record, not the queue - it reads
            fine as two columns once there is room for them. */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))",
          }}
        >
          <div>
            <SocialAccounts />
            <Tags />
            <Services />
            <Details />
          </div>
          <div style={{ borderLeft: "1px solid var(--t16)" }}>
            <Ladder />
            <Notes />
          </div>
        </div>

        <History />
        <DangerZone />
      </div>
    </div>
  );
}

/* --- Sections -------------------------------------------------------------- */

function Header() {
  const { selectedId, select, patchLead } = useHub();
  const lead = useDerivedLead(selectedId)!;
  const [name, setName] = useState(lead.name);

  // Re-sync when the drawer is reused for a different lead.
  useEffect(() => setName(lead.name), [lead.id, lead.name]);

  return (
    <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--t18)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Avatar name={lead.name} color={STAGES[lead.stage].color} size="xl" />

        <div style={{ minWidth: 0, flex: 1 }}>
          {/* Borderless until hovered or focused: the name is a heading first
              and a field second. */}
          <input
            aria-label="Lead name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              const trimmed = name.trim();
              if (!trimmed) return setName(lead.name);
              if (trimmed !== lead.name) patchLead(lead.id, { name: trimmed });
            }}
            className="upf-display"
            style={{
              width: "100%",
              padding: "2px 6px",
              margin: "-2px -6px",
              fontSize: 17,
              fontWeight: 600,
              letterSpacing: "-.01em",
              color: "var(--t40)",
              background: "transparent",
              border: "1px solid transparent",
              borderRadius: 7,
              outline: "none",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--t21)";
            }}
            onMouseLeave={(e) => {
              if (document.activeElement !== e.currentTarget)
                e.currentTarget.style.borderColor = "transparent";
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = "var(--t25)";
              e.currentTarget.style.background = "var(--t6)";
            }}
            onBlurCapture={(e) => {
              e.currentTarget.style.borderColor = "transparent";
              e.currentTarget.style.background = "transparent";
            }}
          />
          <div style={{ fontSize: 12.5, color: "var(--t35)", marginTop: 4 }}>
            {lead.socials.length}{" "}
            {lead.socials.length === 1 ? "account" : "accounts"}
            {lead.audience ? ` · ${lead.audience}` : ""}
          </div>
        </div>

        <button
          className="upf-btn upf-btn-ghost"
          type="button"
          onClick={() => select(null)}
          aria-label="Close"
          style={{ width: 32, padding: 0, flex: "0 0 auto" }}
        >
          ✕
        </button>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          marginTop: 12,
        }}
      >
        <StagePill stage={lead.stage} />
        <span style={{ fontSize: 12.5, color: "var(--t35)" }}>
          {daysInStage(lead)} days in stage
        </span>
        <span
          className="upf-mono"
          style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--tg)" }}
        >
          {money(lead.mrrCents)}/mo
        </span>
      </div>
    </div>
  );
}

function NextTouch() {
  const { selectedId, logTouch, snooze } = useHub();
  const { compose } = useUi();
  const lead = useDerivedLead(selectedId)!;

  const entered = new Date(lead.stageEnteredAt);
  const due =
    lead.step.dueIn === null
      ? null
      : new Date(Date.now() + lead.step.dueIn * 86_400_000);

  return (
    <Section title="Next scheduled touch">
      <div style={{ fontSize: 14, fontWeight: 500, color: "var(--t40)" }}>
        {lead.step.label}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          margin: "9px 0 4px",
        }}
      >
        <DueChip due={lead.due} />
        {due ? (
          <span style={{ fontSize: 12, color: "var(--t35)" }}>
            scheduled {formatDay(due)}
          </span>
        ) : null}
        <span style={{ fontSize: 12, color: "var(--t34)" }}>
          entered {formatDay(entered)}
        </span>
      </div>

      {lead.step.dueIn !== null ? (
        <div
          style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 12 }}
        >
          {CHANNELS.map((channel) => (
            <button
              key={channel}
              className="upf-btn"
              type="button"
              onClick={() => compose(lead.id, channel)}
            >
              Log {channel}
            </button>
          ))}
          <button
            className="upf-btn upf-btn-ghost"
            type="button"
            onClick={() => snooze(lead.id)}
          >
            Snooze 3d
          </button>
        </div>
      ) : (
        <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--t35)" }}>
          This stage has no retarget clock.{" "}
          <button
            type="button"
            onClick={() => logTouch(lead.id, "Email", "Check-in")}
            style={{
              padding: 0,
              border: "none",
              background: "none",
              color: "var(--ta)",
              fontSize: 12.5,
            }}
          >
            Log a check-in anyway
          </button>
        </p>
      )}
    </Section>
  );
}

function MoveStage() {
  const { selectedId, moveStage, theme } = useHub();
  const { confirmLostReason } = useUi();
  const lead = useDerivedLead(selectedId)!;

  function go(stage: StageId) {
    if (stage === "dead") {
      confirmLostReason(lead.id, (reason) => moveStage(lead.id, stage, reason));
      return;
    }
    moveStage(lead.id, stage);
  }

  return (
    <Section title="Move stage">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
          gap: 7,
        }}
      >
        {STAGE_ORDER.map((stage) => {
          const active = stage === lead.stage;
          const color = STAGES[stage].color;
          return (
            <button
              key={stage}
              type="button"
              disabled={active}
              onClick={() => go(stage)}
              className="upf-focus"
              style={{
                padding: "8px 6px",
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 9,
                cursor: active ? "default" : "pointer",
                color: ink(color, theme),
                background: `${color}${active ? "2E" : "14"}`,
                border: `1px solid ${color}${active ? "55" : "2E"}`,
                transition: "background .16s ease, border-color .16s ease",
              }}
            >
              {STAGES[stage].label}
            </button>
          );
        })}
      </div>
      <p style={{ margin: "9px 0 0", fontSize: 11.5, color: "var(--t34)" }}>
        Moving a lead restarts its clock and clears its logged touches.
      </p>
    </Section>
  );
}

function SocialAccounts() {
  const { selectedId, ws, addSocial, patchSocial, removeSocial } = useHub();
  const lead = useDerivedLead(selectedId)!;

  return (
    <Section title="Social accounts">
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {lead.socials.map((social, i) => (
          <div key={social.id} style={{ display: "flex", gap: 6 }}>
            <select
              className="upf-input"
              style={{ flex: "0 0 116px" }}
              value={social.platform}
              onChange={(e) =>
                patchSocial(lead.id, social.id, { platform: e.target.value })
              }
              aria-label={`Platform for account ${i + 1}`}
            >
              {ws.platforms.map((p) => (
                <option key={p.id} value={p.name}>
                  {p.name}
                </option>
              ))}
              {/* A lead may sit on a platform since removed from Settings;
                  keep it selectable rather than silently reassigning it. */}
              {ws.platforms.every((p) => p.name !== social.platform) ? (
                <option value={social.platform}>{social.platform}</option>
              ) : null}
            </select>

            <input
              className="upf-input"
              defaultValue={social.handle}
              placeholder="@handle"
              onBlur={(e) =>
                patchSocial(lead.id, social.id, { handle: e.target.value })
              }
              aria-label={`Handle for account ${i + 1}`}
            />

            <button
              className="upf-btn upf-btn-ghost"
              type="button"
              style={{ flex: "0 0 32px", padding: 0 }}
              onClick={() => removeSocial(lead.id, social.id)}
              aria-label={`Remove ${social.handle || "account"}`}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <button
        className="upf-btn upf-btn-ghost"
        type="button"
        style={{ marginTop: 8 }}
        onClick={() => addSocial(lead.id)}
      >
        + Add another account
      </button>

      {lead.socials.length > 0 ? (
        <p style={{ margin: "8px 0 0", fontSize: 11.5, color: "var(--t34)" }}>
          The first account is the primary — it is the handle every list shows.
        </p>
      ) : null}
    </Section>
  );
}

function Tags() {
  const { selectedId, ws, setTag, theme } = useHub();
  const lead = useDerivedLead(selectedId)!;

  return (
    <Section title="Tags">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {ws.tags.map((tag) => {
          const on = lead.tagIds.includes(tag.id);
          return (
            /* A real checkbox, so the desired state arrives on the event
               rather than being derived from a snapshot that may be stale. */
            <label
              key={tag.id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "4px 10px",
                fontSize: 12,
                fontWeight: 500,
                borderRadius: 16,
                cursor: "pointer",
                color: on ? ink(tag.color, theme) : "var(--t35)",
                background: on ? `${tag.color}14` : "var(--t6)",
                border: `1px solid ${on ? `${tag.color}55` : "var(--t19)"}`,
                transition: "background .16s ease, border-color .16s ease",
              }}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={(e) => setTag(lead.id, tag.id, e.target.checked)}
                style={{
                  position: "absolute",
                  width: 1,
                  height: 1,
                  opacity: 0,
                  pointerEvents: "none",
                }}
              />
              {tag.name}
            </label>
          );
        })}
      </div>
    </Section>
  );
}

function Services() {
  const { selectedId, ws, patchLead, setAddon, theme } = useHub();
  const lead = useDerivedLead(selectedId)!;

  const pkg = ws.packages.find((p) => p.id === lead.packageId) ?? null;

  return (
    <Section
      title="Package & add-ons"
      aside={
        <span
          className="upf-mono"
          style={{ fontSize: 12, color: "var(--tg)" }}
        >
          {money(lead.mrrCents)}/mo
        </span>
      }
    >
      <label className="upf-label" style={{ display: "block", marginBottom: 6 }}>
        Package
      </label>
      <select
        className="upf-input"
        value={lead.packageId ?? ""}
        onChange={(e) =>
          patchLead(lead.id, { packageId: e.target.value || null })
        }
        aria-label="Package"
      >
        <option value="">No package yet</option>
        {ws.packages.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} — {moneyFull(p.priceCents)}/mo
          </option>
        ))}
      </select>

      <label
        className="upf-label"
        style={{ display: "block", margin: "14px 0 6px" }}
      >
        Add-ons
      </label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {ws.addons.map((addon) => {
          const on = lead.addonIds.includes(addon.id);
          const hue = "#E9A83B";
          return (
            <label
              key={addon.id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
                fontSize: 12,
                fontWeight: 500,
                borderRadius: 16,
                cursor: "pointer",
                color: on ? ink(hue, theme) : "var(--t35)",
                background: on ? `${hue}14` : "var(--t6)",
                border: `1px solid ${on ? `${hue}55` : "var(--t19)"}`,
                transition: "background .16s ease, border-color .16s ease",
              }}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={(e) => setAddon(lead.id, addon.id, e.target.checked)}
                style={{
                  position: "absolute",
                  width: 1,
                  height: 1,
                  opacity: 0,
                  pointerEvents: "none",
                }}
              />
              {addon.name}
              {addon.priceCents > 0 ? (
                <span className="upf-mono" style={{ fontSize: 11 }}>
                  {money(addon.priceCents)}
                </span>
              ) : null}
            </label>
          );
        })}
      </div>

      {pkg === null && lead.addonIds.length > 0 ? (
        <p style={{ margin: "9px 0 0", fontSize: 11.5, color: "var(--t34)" }}>
          Add-ons without a package still count toward MRR, but the deal has no
          retainer under it yet.
        </p>
      ) : null}
    </Section>
  );
}

function Details() {
  const { selectedId, ws, patchLead } = useHub();
  const lead = useDerivedLead(selectedId)!;

  return (
    <Section title="Details">
      <label className="upf-label" style={{ display: "block", marginBottom: 6 }}>
        Email
      </label>
      <input
        className="upf-input"
        type="email"
        defaultValue={lead.email}
        placeholder="creator@example.com"
        onBlur={(e) => patchLead(lead.id, { email: e.target.value })}
        aria-label="Email"
      />

      <label
        className="upf-label"
        style={{ display: "block", margin: "12px 0 6px" }}
      >
        Phone
      </label>
      <input
        className="upf-input"
        type="tel"
        defaultValue={lead.phone}
        placeholder="(555) 555-5555"
        onBlur={(e) => patchLead(lead.id, { phone: e.target.value })}
        aria-label="Phone"
      />

      <label
        className="upf-label"
        style={{ display: "block", margin: "12px 0 6px" }}
      >
        Quoted value override
      </label>
      <input
        className="upf-input"
        type="number"
        min={0}
        step={50}
        placeholder="Computed from package + add-ons"
        // Remount when the value changes elsewhere (signing a proposal sets it).
        key={lead.quotedValueCents ?? "none"}
        defaultValue={
          lead.quotedValueCents === null ? "" : lead.quotedValueCents / 100
        }
        onBlur={(e) => {
          const raw = e.target.value.trim();
          patchLead(lead.id, {
            // Blank clears the override and hands MRR back to the rate card.
            quotedValueCents: raw === "" ? null : Math.round(Number(raw) * 100),
          });
        }}
        aria-label="Quoted value override, dollars per month"
      />

      <label
        className="upf-label"
        style={{ display: "block", margin: "12px 0 6px" }}
      >
        Audience
      </label>
      <input
        className="upf-input"
        defaultValue={lead.audience}
        placeholder="412K"
        onBlur={(e) => patchLead(lead.id, { audience: e.target.value })}
        aria-label="Audience size"
      />

      <label
        className="upf-label"
        style={{ display: "block", margin: "12px 0 6px" }}
      >
        Source
      </label>
      <select
        className="upf-input"
        value={lead.sourceId ?? ""}
        onChange={(e) => patchLead(lead.id, { sourceId: e.target.value || null })}
        aria-label="Source"
      >
        <option value="">Unknown</option>
        {ws.sources.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </Section>
  );
}

function Ladder() {
  const { selectedId, ws, theme } = useHub();
  const lead = useDerivedLead(selectedId)!;
  const cadence = ws.cadences[lead.stage];
  const stage = STAGES[lead.stage];
  const color = stage.color;

  if (cadence.steps.length === 0) {
    return (
      <Section title="Retarget ladder">
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--t35)" }}>
          {stage.definition}
        </p>
      </Section>
    );
  }

  return (
    <Section title="Retarget ladder">
      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {cadence.steps.map((step, i) => {
          const sent = i < lead.touches;
          const isNext = i === lead.touches;

          return (
            <li
              key={step.id}
              style={{
                display: "flex",
                gap: 10,
                paddingBottom: 12,
                position: "relative",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 9,
                  height: 9,
                  flex: "0 0 auto",
                  marginTop: 4,
                  borderRadius: "50%",
                  background: sent
                    ? ink("#3FBF7F", theme)
                    : isNext
                      ? color
                      : "transparent",
                  border: `1px solid ${
                    sent ? ink("#3FBF7F", theme) : isNext ? color : "var(--t24)"
                  }`,
                }}
              />
              <div style={{ minWidth: 0 }}>
                <div
                  className="upf-mono"
                  style={{ fontSize: 10.5, color: "var(--t34)" }}
                >
                  DAY {step.day}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    marginTop: 2,
                    color: sent ? "var(--t34)" : "var(--t39)",
                    textDecoration: sent ? "line-through" : "none",
                  }}
                >
                  {step.label}
                </div>
              </div>
            </li>
          );
        })}

        {stage.next ? (
          <li style={{ display: "flex", gap: 10 }}>
            <span
              aria-hidden
              style={{
                width: 9,
                height: 9,
                flex: "0 0 auto",
                marginTop: 4,
                borderRadius: "50%",
                border: `1px dashed var(--t29)`,
              }}
            />
            <div>
              <div
                className="upf-mono"
                style={{ fontSize: 10.5, color: "var(--t34)" }}
              >
                DAY {cadence.demoteDay}
              </div>
              <div style={{ fontSize: 13, marginTop: 2, color: "var(--t35)" }}>
                {stage.demote}
              </div>
            </div>
          </li>
        ) : null}
      </ol>
    </Section>
  );
}

function Notes() {
  const { selectedId, patchLead } = useHub();
  const lead = useDerivedLead(selectedId)!;

  return (
    <Section title="Notes">
      <textarea
        className="upf-input"
        rows={4}
        defaultValue={lead.notes}
        placeholder="What happened, what they asked for, what to say next."
        onBlur={(e) => patchLead(lead.id, { notes: e.target.value })}
        aria-label="Notes"
      />
    </Section>
  );
}

function History() {
  const { selectedId, undoTouch } = useHub();
  const lead = useDerivedLead(selectedId)!;

  /* Only the newest entry, and only while it still counts toward this
     stage's ladder. After a stage change the counter is back at zero and the
     old touches are just history - undoing one would step a ladder that never
     counted it. */
  const undoable = lead.touches > 0 ? lead.history[0] : undefined;

  return (
    <Section title="Touch history">
      {lead.history.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--t35)" }}>
          Nothing logged yet.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {lead.history.map((entry) => {
            const canUndo = entry === undoable;
            // Still carrying its client-side id - the server has not handed
            // back the real one yet.
            const pending = canUndo && entry.id.startsWith("temp-");

            return (
              <li
                key={entry.id}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  padding: "6px 0",
                  fontSize: 12.5,
                  color: "var(--t36)",
                }}
              >
                <span style={{ fontWeight: 600, color: "var(--t39)" }}>
                  {entry.channel}
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>{entry.detail}</span>
                <span style={{ color: "var(--t34)", flex: "0 0 auto" }}>
                  {relativeTime(entry.createdAt)}
                </span>
                {canUndo ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => undoTouch(lead.id, entry.id)}
                    title="Remove this touch and step the ladder back one rung"
                    className="upf-focus"
                    style={{
                      flex: "0 0 auto",
                      padding: "1px 8px",
                      fontSize: 11.5,
                      fontWeight: 600,
                      borderRadius: 6,
                      border: "1px solid var(--t21)",
                      background: "var(--t6)",
                      color: pending ? "var(--t33)" : "var(--ta)",
                      cursor: pending ? "default" : "pointer",
                    }}
                  >
                    {pending ? "Saving…" : "Undo"}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

/**
 * Deleting a lead, behind a deliberate second click.
 *
 * No window.confirm: it is suppressible, unstyleable, and reads as a browser
 * warning rather than something this app meant to say. The inline two-step
 * costs the same one extra click and can explain what is about to happen.
 */
function DangerZone() {
  const { selectedId, removeLead } = useHub();
  const lead = useDerivedLead(selectedId)!;
  const [armed, setArmed] = useState(false);

  // Disarm when the drawer is reused for a different lead, so a primed
  // confirm cannot carry over onto someone else's record.
  useEffect(() => setArmed(false), [lead.id]);

  return (
    <Section title="Danger zone" last>
      {!armed ? (
        <>
          <button
            className="upf-btn upf-btn-ghost"
            type="button"
            onClick={() => setArmed(true)}
          >
            Delete lead
          </button>
          <p style={{ margin: "9px 0 0", fontSize: 11.5, color: "var(--t34)" }}>
            For duplicates and mistakes. A lead that went nowhere is better
            moved to Dead Lead — that keeps its history.
          </p>
        </>
      ) : (
        <>
          <p
            style={{
              margin: "0 0 10px",
              fontSize: 12.5,
              color: "var(--terr)",
              lineHeight: 1.55,
            }}
          >
            Delete {lead.name} permanently? Its accounts, tags, add-ons,{" "}
            {lead.history.length}{" "}
            {lead.history.length === 1 ? "logged touch" : "logged touches"} and
            stage history go with it, and it is removed from every month it
            contributed to. This cannot be undone.
          </p>
          <div style={{ display: "flex", gap: 7 }}>
            <button
              className="upf-btn"
              type="button"
              style={{
                color: "var(--terr)",
                background: "rgba(242,104,60,.10)",
                borderColor: "rgba(242,104,60,.28)",
              }}
              onClick={() => removeLead(lead.id)}
            >
              Delete permanently
            </button>
            <button
              className="upf-btn upf-btn-ghost"
              type="button"
              onClick={() => setArmed(false)}
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </Section>
  );
}

/**
 * Every proposal written for this creator, newest first. The builder is where
 * a proposal is edited; here it is found, opened, moved along (sent, signed)
 * or used as the starting point for the next one.
 */
function Proposals() {
  const { selectedId, ws, proposals, select } = useHub();
  const setStatus = useSetProposalStatus();
  const lead = useDerivedLead(selectedId)!;
  const list = ws.proposals.filter((p) => p.leadId === lead.id);

  // Links leave for the builder, so the lead view closes behind them.
  const leave = () => select(null);

  return (
    <Section
      title={list.length ? `Proposals · ${list.length}` : "Proposals"}
      aside={
        <Link
          href={`/proposals?lead=${lead.id}`}
          onClick={leave}
          className="upf-btn"
          style={{ height: 28, fontSize: 12 }}
        >
          + New proposal
        </Link>
      }
    >
      {!ws.proposalsReady ? (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--terr)" }}>
          Saving proposals needs the proposals table. Run
          supabase/migrations/0006_proposals.sql in the Supabase SQL Editor.
        </p>
      ) : list.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--t35)" }}>
          No proposals yet. Start one here and it saves to {lead.name}&apos;s profile.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {list.map((p) => {
            return (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                  padding: "9px 11px",
                  borderRadius: 10,
                  background: "var(--t6)",
                  border: "1px solid var(--t19)",
                }}
              >
                <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                  <Link
                    href={`/proposals?id=${p.id}`}
                    onClick={leave}
                    style={{ fontSize: 13.5, fontWeight: 600, color: "var(--t40)" }}
                  >
                    {p.title}
                  </Link>
                  <div style={{ fontSize: 12, color: "var(--t35)", marginTop: 2 }}>
                    {[
                      p.monthlyCents ? `${usd(p.monthlyCents)}/mo` : "",
                      p.oneTimeCents ? `${usd(p.oneTimeCents)} one-time` : "",
                    ]
                      .filter(Boolean)
                      .join(" + ") || "No charge"}{" "}
                    · updated {relativeTime(p.updatedAt)}
                  </div>
                </div>
                <ProposalStatusPicker
                  value={p.status}
                  onChange={(s) => setStatus(p, s)}
                  label={`Status of ${p.title}`}
                />
                <div style={{ display: "flex", gap: 6 }}>
                  {p.status !== "signed" ? (
                    <button
                      type="button"
                      className="upf-btn"
                      style={{ height: 28 }}
                      onClick={() => setStatus(p, "signed")}
                    >
                      ✓ Mark signed
                    </button>
                  ) : null}
                  <Link href={`/proposals?id=${p.id}`} onClick={leave} className="upf-btn upf-btn-ghost" style={{ height: 28 }}>
                    Open
                  </Link>
                  <Link
                    href={`/proposals?from=${p.id}`}
                    onClick={leave}
                    className="upf-btn upf-btn-ghost"
                    style={{ height: 28 }}
                    title="Start a new proposal from this one"
                  >
                    Duplicate
                  </Link>
                  <button
                    type="button"
                    className="upf-btn upf-btn-ghost"
                    style={{ height: 28 }}
                    onClick={() => {
                      if (window.confirm(`Delete "${p.title}"? This can't be undone.`)) proposals.remove(p.id);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

/* --- Shared ---------------------------------------------------------------- */

function Section({
  title,
  aside,
  children,
  last,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <section
      style={{
        padding: "14px 18px",
        borderBottom: last ? "none" : "1px solid var(--t16)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <h3 className="upf-label" style={{ margin: 0 }}>
          {title}
        </h3>
        {aside ? <span style={{ marginLeft: "auto" }}>{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

function formatDay(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
