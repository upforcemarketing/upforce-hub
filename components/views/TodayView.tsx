"use client";

import { useMemo } from "react";

import { useHub } from "@/components/HubStore";
import { useUi } from "@/components/Shell";
import {
  Avatar,
  DueChip,
  EmptyState,
  SectionCard,
  StagePill,
  StatCard,
  TagChips,
  riseDelay,
} from "@/components/ui";
import { useDerivedLeads, type DerivedLead } from "@/components/useDerived";
import { daysInStage, money, relativeTime } from "@/lib/engine";
import { STAGES } from "@/lib/stages";

/**
 * The daily work surface.
 *
 * One question only: what does this pipeline owe today? Everything due within
 * three days, overdue, or ready to demote surfaces here; everything else is a
 * click away on Pipeline. A queue that shows all sixteen leads is a list, not
 * a queue.
 */
export function TodayView() {
  const { ws, select, logTouch, applyDemotion } = useHub();
  const { compose, confirmLostReason } = useUi();
  const leads = useDerivedLeads();

  const stats = useMemo(() => {
    const dueToday = leads.filter((l) => l.due.tone === "today").length;
    const overdue = leads.filter((l) => l.due.tone === "over").length;
    const hotWarm = leads.filter(
      (l) => l.stage === "hot" || l.stage === "warm"
    ).length;

    // Converted revenue is booked, and dead leads are not pipeline - neither
    // belongs in a number labelled "pipeline value".
    const pipelineValue = leads
      .filter((l) => l.stage !== "converted" && l.stage !== "dead")
      .reduce((sum, l) => sum + l.mrrCents, 0);

    return { dueToday, overdue, hotWarm, pipelineValue };
  }, [leads]);

  /* Overdue first, then today, then soon - the order a rep would work them.
     Anything further out is not in the queue at all. */
  const queue = useMemo(
    () =>
      leads
        .filter((l) => l.step.dueIn !== null && l.step.dueIn <= 3)
        .sort((a, b) => (a.step.dueIn ?? 0) - (b.step.dueIn ?? 0)),
    [leads]
  );

  /* Demotions are surfaced, never fired. A lead dropping from Warm to Cold
     without anyone seeing it is how a pipeline quietly empties. */
  const pending = useMemo(
    () =>
      leads
        .filter(
          (l) =>
            l.step.terminal &&
            l.step.dueIn !== null &&
            l.step.dueIn <= 0 &&
            STAGES[l.stage].next !== null
        )
        .sort((a, b) => (a.step.dueIn ?? 0) - (b.step.dueIn ?? 0)),
    [leads]
  );

  const activity = useMemo(() => {
    return leads
      .flatMap((lead) =>
        lead.history.map((h) => ({ lead: lead.name, ...h }))
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 8);
  }, [leads]);

  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))",
          gap: 12,
          marginBottom: 22,
        }}
      >
        <StatCard
          label="Due today"
          value={stats.dueToday}
          note={stats.dueToday === 1 ? "1 touch scheduled" : "touches scheduled"}
        />
        <StatCard
          label="Overdue"
          value={stats.overdue}
          note="past their scheduled day"
          tone="#F2683C"
        />
        <StatCard
          label="Hot + warm"
          value={stats.hotWarm}
          note="live conversations"
          tone="#E9A83B"
        />
        <StatCard
          label="Pipeline value"
          value={money(stats.pipelineValue)}
          note="per month, unweighted"
          tone="#3FBF7F"
        />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        <div style={{ flex: "1 1 520px", minWidth: 0 }}>
          <SectionCard
            title="Action queue"
            aside={
              <span
                className="upf-mono"
                style={{ fontSize: 11.5, color: "var(--t35)" }}
              >
                {stats.overdue} overdue · {stats.dueToday} due today
              </span>
            }
          >
            <div className="upf-scroll-x">
              <div
                style={{ display: "flex", flexDirection: "column", gap: 10 }}
              >
                {queue.length === 0 ? (
                  <EmptyState>
                    Nothing is due in the next three days. The clock is still
                    running on everything else.
                  </EmptyState>
                ) : (
                  queue.map((lead, i) => (
                    <QueueCard
                      key={lead.id}
                      lead={lead}
                      index={i}
                      onOpen={() => select(lead.id)}
                      onLog={() => logTouch(lead.id, "Email", lead.step.label)}
                      onCompose={() => compose(lead.id, "Email")}
                    />
                  ))
                )}
              </div>
            </div>
          </SectionCard>
        </div>

        <div
          style={{
            flex: "1 1 300px",
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <SectionCard title="Stage transitions pending">
            {pending.length === 0 ? (
              <EmptyState>No demotions waiting for approval.</EmptyState>
            ) : (
              <div
                style={{ display: "flex", flexDirection: "column", gap: 10 }}
              >
                {pending.map((lead) => (
                  <div
                    key={lead.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 12px",
                      borderRadius: 11,
                      background: "var(--t6)",
                      border: "1px solid var(--t19)",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <button
                        type="button"
                        onClick={() => select(lead.id)}
                        style={{
                          padding: 0,
                          border: "none",
                          background: "none",
                          fontSize: 13.5,
                          fontWeight: 600,
                          color: "var(--t40)",
                          textAlign: "left",
                        }}
                      >
                        {lead.name}
                      </button>
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--t35)",
                          marginTop: 2,
                        }}
                      >
                        {STAGES[lead.stage].label} →{" "}
                        {STAGES[lead.stage].nextLabel} ·{" "}
                        {daysInStage(lead)} days in stage
                      </div>
                    </div>

                    <button
                      className="upf-btn"
                      type="button"
                      style={{ marginLeft: "auto" }}
                      onClick={() => {
                        if (STAGES[lead.stage].next === "dead") {
                          confirmLostReason(lead.id, (reason) =>
                            applyDemotion(lead.id, reason)
                          );
                          return;
                        }
                        applyDemotion(lead.id);
                      }}
                    >
                      Apply
                    </button>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Recent activity">
            {activity.length === 0 ? (
              <EmptyState>No touches logged yet.</EmptyState>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {activity.map((entry) => (
                  <li
                    key={entry.id}
                    style={{
                      display: "flex",
                      gap: 8,
                      padding: "6px 4px",
                      fontSize: 12.5,
                      color: "var(--t36)",
                    }}
                  >
                    <span aria-hidden style={{ color: "var(--t31)" }}>
                      •
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <strong style={{ color: "var(--t39)", fontWeight: 600 }}>
                        {entry.lead}
                      </strong>{" "}
                      — {entry.channel}
                      {entry.detail ? ` · ${entry.detail}` : ""}{" "}
                      <span style={{ color: "var(--t34)" }}>
                        {relativeTime(entry.createdAt)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>
    </>
  );
}

function QueueCard({
  lead,
  index,
  onOpen,
  onLog,
  onCompose,
}: {
  lead: DerivedLead;
  index: number;
  onOpen: () => void;
  onLog: () => void;
  onCompose: () => void;
}) {
  const color = STAGES[lead.stage].color;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="upf-rise upf-hover-card upf-focus"
      style={{
        ...riseDelay(index),
        display: "flex",
        alignItems: "center",
        gap: 16,
        minWidth: 480,
        padding: "15px 17px",
        borderRadius: 12,
        border: "1px solid var(--t19)",
        borderLeft: `3px solid ${color}`,
        background: "var(--t6)",
        cursor: "pointer",
      }}
    >
      <Avatar name={lead.name} color={color} size="lg" />

      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-.01em" }}
          >
            {lead.name}
          </span>
          <StagePill stage={lead.stage} />
        </div>

        {/* The action label is the point of the card - it is what the rep is
            here to do, so it outranks the metadata below it. */}
        <div
          style={{
            fontSize: 14.5,
            fontWeight: 500,
            color: "var(--t40)",
            margin: "5px 0 4px",
          }}
        >
          {lead.step.label}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            fontSize: 12.5,
            color: "var(--t35)",
          }}
        >
          <span>
            {lead.handle}
            {lead.extraAccounts > 0 ? `  +${lead.extraAccounts} more` : ""}
          </span>
          {lead.audience ? <span>· {lead.audience}</span> : null}
          <TagChips tagIds={lead.tagIds} />
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 8,
          flex: "0 0 auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <DueChip due={lead.due} />
        <button className="upf-btn" type="button" onClick={onLog}>
          Log touch
        </button>
        <button
          className="upf-btn upf-btn-ghost"
          type="button"
          onClick={onCompose}
        >
          Compose
        </button>
      </div>
    </div>
  );
}
