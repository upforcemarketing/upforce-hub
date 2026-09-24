"use client";

import { useHub } from "@/components/HubStore";
import { PROPOSAL_STATUSES, statusMeta } from "@/components/useProposalStatus";
import { ink } from "@/lib/engine";
import type { ProposalStatus } from "@/lib/types";

/**
 * A proposal's status as a coloured pill that is plainly a dropdown.
 *
 * The app's selects hide the native arrow, which reads fine in a form but left
 * a lone status box looking like a label - nobody found "Signed" inside it. So
 * this one carries its own chevron and the status colour.
 */
export function ProposalStatusPicker({
  value,
  onChange,
  label,
}: {
  value: ProposalStatus;
  onChange: (status: ProposalStatus) => void;
  label: string;
}) {
  const { theme } = useHub();
  const color = ink(statusMeta(value).color, theme);

  return (
    <span style={{ position: "relative", display: "inline-flex", flex: "0 0 auto" }}>
      <select
        className="upf-focus"
        value={value}
        onChange={(e) => onChange(e.target.value as ProposalStatus)}
        aria-label={label}
        title="Change status"
        style={{
          appearance: "none",
          height: 30,
          padding: "0 28px 0 12px",
          borderRadius: 20,
          fontSize: 12.5,
          fontWeight: 600,
          cursor: "pointer",
          color,
          background: `${statusMeta(value).color}1A`,
          border: `1px solid ${statusMeta(value).color}66`,
        }}
      >
        {PROPOSAL_STATUSES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      <span
        aria-hidden
        style={{
          position: "absolute",
          right: 11,
          top: "50%",
          transform: "translateY(-50%)",
          fontSize: 10,
          color,
          pointerEvents: "none",
        }}
      >
        ▼
      </span>
    </span>
  );
}
