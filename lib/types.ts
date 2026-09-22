import type { Channel, StageId } from "@/lib/stages";

export type Tag = { id: string; name: string; color: string; sort: number };
export type NamedItem = { id: string; name: string; sort: number };

/** A package is the one retainer a lead sits on; add-ons stack on top of it. */
export type Package = { id: string; name: string; priceCents: number; sort: number };
export type Addon = { id: string; name: string; priceCents: number; sort: number };

export type CadenceStep = { id: string; day: number; label: string };

/** One stage ladder. `demoteDay` is the day the lead becomes due to demote. */
export type Cadence = { stage: StageId; demoteDay: number; steps: CadenceStep[] };

export type Social = { id: string; platform: string; handle: string; sort: number };

export type TouchRecord = {
  id: string;
  channel: Channel;
  detail: string;
  createdAt: string;
};

export type Lead = {
  id: string;
  name: string;
  /** Denormalised from socials[0] so lists need not join to render a row. */
  handle: string;
  platform: string;
  audience: string;
  stage: StageId;
  /** When the lead entered its current stage. The retarget clock reads this. */
  stageEnteredAt: string;
  touches: number;
  /** Overrides the package + add-on sum when the deal was quoted differently. */
  quotedValueCents: number | null;
  notes: string;
  email: string;
  phone: string;
  sourceId: string | null;
  /** Set once, when the lead is moved to Dead Lead. Null otherwise. */
  lostReason: string | null;
  packageId: string | null;
  addonIds: string[];
  tagIds: string[];
  socials: Social[];
  history: TouchRecord[];
  createdAt: string;
};

export type Meeting = {
  id: string;
  /** 0 = Monday through 6 = Sunday, matching the week grid columns. */
  day: number;
  time: string;
  title: string;
  kind: "meeting" | "internal";
  leadId: string | null;
};

export type CalendarAccount = {
  id: string;
  key: string;
  name: string;
  detail: string;
  connected: boolean;
};

export type TeamShare = { url: string; shared: boolean };

/**
 * One closed month, frozen.
 *
 * MRR figures are state as it stood when the month was captured; won and lost
 * are counted from the transition log and are exact.
 */
export type MonthlySnapshot = {
  /** First day of the month, ISO date. */
  month: string;
  activeMrrCents: number;
  pipelineMrrCents: number;
  leadCount: number;
  convertedCount: number;
  stageCounts: Partial<Record<StageId, number>>;
  stageValues: Partial<Record<StageId, number>>;
  wonCount: number;
  lostCount: number;
};

/** Everything the app needs for a session, loaded once and held client-side. */
export type Workspace = {
  leads: Lead[];
  tags: Tag[];
  platforms: NamedItem[];
  sources: NamedItem[];
  packages: Package[];
  addons: Addon[];
  cadences: Record<StageId, Cadence>;
  meetings: Meeting[];
  calendarAccounts: CalendarAccount[];
  teamShare: TeamShare;
  /** Closed months, newest first. Empty until the first month rolls over. */
  history: MonthlySnapshot[];
};

export type ViewId =
  | "today"
  | "pipeline"
  | "leads"
  | "calendar"
  | "revenue"
  | "settings";
