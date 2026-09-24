"use client";

import { useCallback } from "react";

import { useHub } from "@/components/HubStore";
import { usd } from "@/lib/proposal";
import type { ProposalStatus, SavedProposal } from "@/lib/types";

export const PROPOSAL_STATUSES: { id: ProposalStatus; label: string; color: string }[] = [
  { id: "draft", label: "Draft", color: "#8A8077" },
  { id: "sent", label: "Sent", color: "#5B9BD5" },
  { id: "signed", label: "Signed", color: "#3FBF7F" },
  { id: "declined", label: "Declined", color: "#F2683C" },
];

export function statusMeta(status: ProposalStatus) {
  return PROPOSAL_STATUSES.find((s) => s.id === status) ?? PROPOSAL_STATUSES[0];
}

/**
 * Changes a saved proposal's status, from the builder or the lead.
 *
 * Signing is the one status with a consequence elsewhere: the lead's value in
 * the pipeline should become what was actually agreed. That is asked, not
 * assumed - a signed one-off project, say, is not monthly revenue.
 */
export function useSetProposalStatus() {
  const { proposals, patchLead, lead } = useHub();

  return useCallback(
    (summary: SavedProposal, status: ProposalStatus) => {
      if (summary.status === status) return;
      proposals.setStatus(summary.id, status);

      if (status !== "signed" || !summary.leadId || summary.monthlyCents <= 0) return;
      const target = lead(summary.leadId);
      if (!target || target.quotedValueCents === summary.monthlyCents) return;

      const ok = window.confirm(
        `Set ${target.name}'s quoted value to ${usd(summary.monthlyCents)}/mo from this proposal?`
      );
      if (ok) patchLead(summary.leadId, { quotedValueCents: summary.monthlyCents });
    },
    [proposals, patchLead, lead]
  );
}
