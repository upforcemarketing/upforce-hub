/**
 * The six pipeline stages.
 *
 * Colour, definition and successor are product facts, not configuration - they
 * are fixed here. The *cadence* (which touches fire on which day, and the day a
 * lead is due to demote) is data, editable in Settings, and lives in the
 * database. Keep the two apart: changing a ladder must never require a deploy.
 */

export type StageId =
  | "cold"
  | "warm"
  | "hot"
  | "converted"
  | "reactivation"
  | "dead";

export type Stage = {
  id: StageId;
  label: string;
  color: string;
  /** Human summary of the ladder, shown on Pipeline column headers. */
  cadence: string;
  definition: string;
  /** Stage a lead falls to when its ladder runs out. null = end of the line. */
  next: StageId | null;
  nextLabel: string;
  /** Label on the pending-transition row. Empty when there is no successor. */
  demote: string;
};

export const STAGES: Record<StageId, Stage> = {
  cold: {
    id: "cold",
    label: "Cold Lead",
    color: "#5B9BD5",
    cadence: "Touch at day 7 · 37 · 67, then Dead",
    definition:
      "Anyone we reached out to first — email, DM, socials. Three retargets, then archived.",
    next: "dead",
    nextLabel: "Dead Lead",
    demote: "Archive as Dead Lead",
  },
  warm: {
    id: "warm",
    label: "Warm Lead",
    color: "#E9A83B",
    cadence: "Every 7 days for 3 weeks, demote at day 30",
    definition:
      "They came to us, or replied to a cold touch, and want to learn more.",
    next: "cold",
    nextLabel: "Cold Lead",
    demote: "Drop back to Cold Lead",
  },
  hot: {
    id: "hot",
    label: "Hot Lead",
    color: "#F2683C",
    cadence: "Touch at day 3 · 10, back to Warm at day 30",
    definition: "Meeting held, pricing presented, ready to onboard.",
    next: "warm",
    nextLabel: "Warm Lead",
    demote: "Cool off to Warm Lead",
  },
  converted: {
    id: "converted",
    label: "Converted",
    color: "#3FBF7F",
    cadence: "Managed client — no retarget clock",
    definition: "Signed and onboarded. Lives in delivery, not the pipeline.",
    next: null,
    nextLabel: "",
    demote: "",
  },
  reactivation: {
    id: "reactivation",
    label: "Reactivation",
    color: "#C9A227",
    cadence: "Review at 3mo · hard retarget 6 · 12 · 18mo",
    definition: "Past clients who left on good terms and could come back.",
    next: "dead",
    nextLabel: "Dead Lead",
    demote: "Archive as Dead Lead",
  },
  dead: {
    id: "dead",
    label: "Dead Lead",
    color: "#6B6560",
    cadence: "Retarget every 6 months for 365 days",
    definition:
      "Not worth active outreach. Two long-shot touches, then closed for good.",
    next: null,
    nextLabel: "Closed",
    demote: "",
  },
};

/** Display order for the pipeline board and every stage filter row. */
export const STAGE_ORDER: StageId[] = [
  "hot",
  "warm",
  "cold",
  "converted",
  "reactivation",
  "dead",
];

export const STAGE_IDS = new Set<string>(STAGE_ORDER);

export function isStageId(value: string): value is StageId {
  return STAGE_IDS.has(value);
}

export const CHANNELS = ["Email", "DM", "Call"] as const;
export type Channel = (typeof CHANNELS)[number];

export const CALL_OUTCOMES = [
  "Connected",
  "No answer",
  "Booked meeting",
  "Not interested",
] as const;

/** Offered when a lead is moved to Dead Lead, so the loss is diagnosable later. */
export const LOST_REASONS = [
  "Unresponsive",
  "Not interested",
  "Too expensive",
  "Bad fit",
  "Went with a competitor",
  "Other",
] as const;

/** Colour picker offered wherever a tag colour is chosen. */
export const SWATCHES = [
  "#E9A83B",
  "#F2683C",
  "#3FBF7F",
  "#5B9BD5",
  "#8B7BD8",
  "#C9A227",
  "#6B6560",
  "#D96B8F",
];
