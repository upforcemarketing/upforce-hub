"use client";

import { useEffect, useState } from "react";

import { useDerivedLead } from "@/components/useDerived";
import { LOST_REASONS } from "@/lib/stages";

/**
 * Asked once, at the moment a lead is moved to Dead Lead.
 *
 * A reason left for a field nobody goes back to fill in is a reason nobody
 * ever records. Asking here, when the decision is already being made, is the
 * only point in the flow where it costs nothing extra to answer.
 */
export function LostReasonModal({
  leadId,
  onConfirm,
  onClose,
}: {
  leadId: string;
  /** Undefined when skipped - the move still happens, just without a reason. */
  onConfirm: (reason?: string) => void;
  onClose: () => void;
}) {
  const lead = useDerivedLead(leadId);
  const [choice, setChoice] = useState<string | null>(null);
  const [custom, setCustom] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!lead) return null;

  const reason = choice === "Other" ? custom.trim() : choice;
  const canConfirm = Boolean(reason);

  return (
    <div
      className="upf-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Why is ${lead.name} going to Dead Lead?`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="upf-card upf-pop"
        style={{ width: "100%", maxWidth: 440, boxShadow: "var(--shadow)" }}
      >
        <header
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--t16)",
          }}
        >
          <h2
            className="upf-display"
            style={{ fontSize: 15, fontWeight: 600, margin: 0 }}
          >
            Why did {lead.name} not work out?
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--t35)" }}>
            One click. Helps spot a pattern later — skip it and the move still
            goes through.
          </p>
        </header>

        <div style={{ padding: 18 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
            {LOST_REASONS.map((option) => {
              const active = choice === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setChoice(option)}
                  aria-pressed={active}
                  className="upf-focus"
                  style={{
                    padding: "6px 12px",
                    fontSize: 12.5,
                    fontWeight: 600,
                    borderRadius: 18,
                    color: active ? "var(--ta)" : "var(--t36)",
                    background: active ? "var(--t14)" : "var(--t6)",
                    border: `1px solid ${active ? "var(--t25)" : "var(--t19)"}`,
                    transition:
                      "background .16s ease, border-color .16s ease, color .16s ease",
                  }}
                >
                  {option}
                </button>
              );
            })}
          </div>

          {choice === "Other" ? (
            <input
              className="upf-input"
              autoFocus
              placeholder="What happened"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              style={{ marginTop: 12 }}
              aria-label="Custom reason"
            />
          ) : null}
        </div>

        <footer
          style={{
            display: "flex",
            gap: 8,
            padding: "0 18px 18px",
            justifyContent: "flex-end",
          }}
        >
          <button
            className="upf-btn upf-btn-ghost"
            type="button"
            onClick={() => {
              onConfirm(undefined);
              onClose();
            }}
          >
            Skip
          </button>
          <button
            className="upf-btn"
            type="button"
            disabled={!canConfirm}
            onClick={() => {
              if (!reason) return;
              onConfirm(reason);
              onClose();
            }}
          >
            Move to Dead Lead
          </button>
        </footer>
      </div>
    </div>
  );
}
