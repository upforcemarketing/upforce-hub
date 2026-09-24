import {
  CATEGORIES,
  equivalentService,
  type Billing,
  type Catalog,
  type CategoryId,
  type Service,
} from "@/lib/catalog";

/* ---------------------------------------------------------------------------
   A proposal, and the arithmetic that prices it.

   A selected line is a snapshot of the catalog entry plus the overrides typed
   against it. The snapshot is what prints, so a later change to the catalog
   never silently rewrites a proposal that has already been drafted.
   --------------------------------------------------------------------------- */

export type Line = {
  key: string;
  /** Catalog id, or null for a custom line typed in by hand. */
  serviceId: string | null;
  name: string;
  description: string;
  deliverables: string;
  turnaround: string;
  unit: string;
  qty: number;
  billing: Billing;
  listCents: number;
  listCostCents: number;
  /** Per-unit discount off the line's price, 0-100. 100 prints as "Included free". */
  discountPct?: number;
  /** Per-unit price override. 0 prints as "Included free". */
  priceCents: number | null;
  /** Per-unit editor-cost override. Internal only. */
  costCents: number | null;
  /** Recommended add-on: shown separately and left out of the core total. */
  optional: boolean;
};

export type Term = { key: string; title: string; body: string };

export type Creator = {
  name: string;
  contactName: string;
  email: string;
  handle: string;
  platform: string;
  audience: string;
  /** Data URL, printed beside the UpForce logo. */
  logo: string;
};

export type Proposal = {
  creator: Creator;
  leadId: string | null;
  category: CategoryId | null;
  lines: Line[];
  title: string;
  /** One line under the title in the header band. */
  subtitle: string;
  /** Opening paragraph under the meta row. */
  intro: string;
  /** Applied to the core totals, before any total override. */
  discountPct: number;
  monthlyOverrideCents: number | null;
  oneTimeOverrideCents: number | null;
  showLinePrices: boolean;
  /** How new per-unit lines bill: a monthly retainer or a one-time project. */
  billing: Billing;
  /** Prices worked out from a margin are rounded up to this, in cents. */
  roundToCents: number;
  termsPreset: TermsPresetId;
  terms: Term[];
  notesTitle: string;
  notes: string;
  preparedBy: string;
  date: string;
  validDays: number;
};

let seq = 0;
export function newKey(prefix = "k"): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

export function followsProposalBilling(unit: string): boolean {
  // Billed by the month (management) or by the project (a website build),
  // these bill that way whatever the rest of the proposal does.
  return unit !== "month" && unit !== "project";
}

/**
 * A catalog service as a proposal line. Per-unit services bill the way the
 * proposal does (a monthly retainer or a one-time project); services priced
 * by the month or by the project keep their own billing either way.
 */
export function lineFromService(s: Service, billing: Billing = s.billing): Line {
  return {
    key: newKey("line"),
    serviceId: s.id,
    name: s.name,
    description: s.description,
    deliverables: s.deliverables,
    turnaround: s.turnaround,
    unit: s.unit,
    qty: 1,
    billing: followsProposalBilling(s.unit) ? billing : s.billing,
    listCents: s.priceCents,
    listCostCents: s.costCents,
    priceCents: null,
    costCents: null,
    optional: false,
  };
}

export function customLine(billing: Billing = "one-time"): Line {
  return {
    key: newKey("line"),
    serviceId: null,
    name: "Custom service",
    description: "",
    deliverables: "",
    turnaround: "",
    unit: "unit",
    qty: 1,
    billing,
    listCents: 0,
    listCostCents: 0,
    priceCents: null,
    costCents: null,
    optional: false,
  };
}

/**
 * Re-prices the selection against another category's sheet.
 *
 * Lines whose service (or its nearest equivalent) exists there take its
 * wording and list price and keep everything typed against them (quantity,
 * overrides, add-on flag). Lines it does not sell are dropped and returned so
 * the caller can say so.
 */
export function moveToCategory(
  catalog: Catalog,
  lines: Line[],
  to: CategoryId
): { lines: Line[]; dropped: Line[] } {
  const kept: Line[] = [];
  const dropped: Line[] = [];
  for (const line of lines) {
    if (!line.serviceId) {
      kept.push(line);
      continue;
    }
    const s = equivalentService(catalog, to, line.serviceId);
    if (!s) {
      dropped.push(line);
      continue;
    }
    const fresh = lineFromService(s);
    kept.push({
      ...fresh,
      key: line.key,
      qty: line.qty,
      billing: line.billing,
      priceCents: line.priceCents,
      costCents: line.costCents,
      discountPct: line.discountPct,
      optional: line.optional,
    });
  }
  return { lines: kept, dropped };
}

/* --- Pricing ---------------------------------------------------------------- */

/** The line's price before any discount: its override, else the sheet price. */
export function basePrice(line: Line): number {
  return line.priceCents ?? line.listCents;
}

export function discountOf(line: Line): number {
  const d = line.discountPct ?? 0;
  return Number.isFinite(d) ? Math.min(100, Math.max(0, d)) : 0;
}

/**
 * What one unit is actually charged at: the line's price, less its discount.
 * The discount always comes off the price on the line - never the sheet price
 * or the cost - so "10% off" means 10% off what the client was going to pay.
 */
export function unitPrice(line: Line): number {
  return Math.round(basePrice(line) * (1 - discountOf(line) / 100));
}

/**
 * The pre-discount price that lands on `effective` once the line's discount
 * is taken off. For margin and target tools, which think in charged prices.
 */
export function baseForEffective(line: Line, effective: number): number {
  const d = discountOf(line);
  return d >= 100 ? effective : Math.round(effective / (1 - d / 100));
}

export function lineTotal(line: Line): number {
  return unitPrice(line) * line.qty;
}

export function lineListTotal(line: Line): number {
  return line.listCents * line.qty;
}

export function lineCost(line: Line): number {
  return (line.costCents ?? line.listCostCents) * line.qty;
}

type Bucket = {
  /** Sum of line prices after per-line overrides. */
  subtotal: number;
  /** Sum at catalog price - the "value" the client is getting. */
  list: number;
  discount: number;
  /** What is actually charged: override if set, else subtotal less discount. */
  total: number;
  overridden: boolean;
  cost: number;
};

export type Totals = {
  monthly: Bucket;
  oneTime: Bucket;
  /** Recommended add-ons, never discounted or overridden. */
  addons: { monthly: number; oneTime: number; list: number; cost: number };
  /** Internal margin across the core scope. */
  revenue: number;
  cost: number;
  marginPct: number | null;
};

export function totals(p: Proposal): Totals {
  const bucket = (billing: Billing, override: number | null): Bucket => {
    const core = p.lines.filter((l) => !l.optional && l.billing === billing);
    const subtotal = core.reduce((n, l) => n + lineTotal(l), 0);
    const list = core.reduce((n, l) => n + lineListTotal(l), 0);
    const discount = Math.round((subtotal * clampPct(p.discountPct)) / 100);
    const overridden = override !== null;
    return {
      subtotal,
      list,
      discount: overridden ? 0 : discount,
      total: overridden ? override : subtotal - discount,
      overridden,
      cost: core.reduce((n, l) => n + lineCost(l), 0),
    };
  };

  const monthly = bucket("monthly", p.monthlyOverrideCents);
  const oneTime = bucket("one-time", p.oneTimeOverrideCents);

  const extra = p.lines.filter((l) => l.optional);
  const addons = {
    monthly: extra.filter((l) => l.billing === "monthly").reduce((n, l) => n + lineTotal(l), 0),
    oneTime: extra.filter((l) => l.billing === "one-time").reduce((n, l) => n + lineTotal(l), 0),
    list: extra.reduce((n, l) => n + lineListTotal(l), 0),
    cost: extra.reduce((n, l) => n + lineCost(l), 0),
  };

  const revenue = monthly.total + oneTime.total;
  const cost = monthly.cost + oneTime.cost;

  return {
    monthly,
    oneTime,
    addons,
    revenue,
    cost,
    marginPct: revenue > 0 ? ((revenue - cost) / revenue) * 100 : null,
  };
}

function clampPct(n: number): number {
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
}

export function marginOf(priceCents: number, costCents: number): number | null {
  return priceCents > 0 ? ((priceCents - costCents) / priceCents) * 100 : null;
}

/**
 * The price that earns a given gross margin on a cost:
 * price = cost / (1 - margin). Rounded up to `roundTo` cents so rounding
 * never takes the margin under the target.
 *
 * Null when it cannot be worked out: no cost to mark up (the margin is 100%
 * at any price) or a margin of 100% or more (no finite price reaches it).
 */
export function priceForMargin(costCents: number, marginPct: number, roundTo = 100): number | null {
  if (!(costCents > 0) || !Number.isFinite(marginPct) || marginPct >= 100) return null;
  const raw = costCents / (1 - marginPct / 100);
  const step = roundTo > 0 ? roundTo : 1;
  return Math.ceil(raw / step - 1e-9) * step;
}

/** "$1,080" - whole dollars unless there are cents to show. */
export function usd(cents: number): string {
  const n = cents / 100;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/* --- Terms -----------------------------------------------------------------
   Lifted from the signed PatrckStatic and TKOR agreements. {creator} is filled
   in with the creator's name when the proposal renders. */

export type TermsPresetId = "monthly" | "project" | "custom";

export const TERMS_PRESETS: Record<
  Exclude<TermsPresetId, "custom">,
  { label: string; blurb: string; terms: Omit<Term, "key">[] }
> = {
  monthly: {
    label: "Month-to-month",
    blurb: "No commitment, billed after each month's content is approved.",
    terms: [
      { title: "No commitment", body: "Month-to-month service. No long-term commitment or early termination fees. Services continue month-to-month unless either party elects to discontinue the relationship." },
      { title: "Billing", body: "Billing occurs after the monthly committed content is published by UpForce and approved by {creator}." },
      { title: "Payment due", body: "Payment is due on the first day of the following month." },
      { title: "Past due", body: "At 30 days past due, UpForce will halt operations until the account is brought current." },
    ],
  },
  project: {
    label: "Project commitment",
    blurb: "Committed scope, Net 30 invoicing, early-termination clause.",
    terms: [
      { title: "Project commitment", body: "This proposal is based on a commitment to the complete project scope as outlined. By accepting this proposal, {creator} authorizes UpForce to provide the services outlined and agrees to the full project scope and associated pricing." },
      { title: "Early termination", body: "Pricing and discounts in this proposal are based on completion of the full project. If {creator} elects to discontinue before completion, {creator} will remain responsible for all completed work, all work already in production, and 50% of the remaining uncompleted project balance." },
      { title: "Billing & payment", body: "UpForce will invoice as each deliverable package is completed and provided to {creator}. Each invoice is due within 30 days of the invoice date (Net 30). If more than one invoice is past due at the same time, UpForce will pause further production until the outstanding past-due balance is paid." },
      { title: "Delivery & revisions", body: "Once all recordings and content have been provided in the shared UpForce x {creator} Google Drive along with a creative direction document, UpForce will deliver all publishable content within seven (7) calendar days. Footage or assets added after content has been handed to the editing team may incur additional fees. Revision requests must be submitted within 72 hours of UpForce notifying {creator} that content is ready for review, and are returned within 48 hours." },
    ],
  },
};

export function presetTerms(id: Exclude<TermsPresetId, "custom">): Term[] {
  return TERMS_PRESETS[id].terms.map((t) => ({ ...t, key: newKey("term") }));
}

export function fillCreator(text: string, creator: string): string {
  return text.replace(/\{creator\}/g, creator.trim() || "the Creator");
}

/* --- Defaults --------------------------------------------------------------- */

export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function blankProposal(): Proposal {
  return {
    creator: { name: "", contactName: "", email: "", handle: "", platform: "", audience: "", logo: "" },
    leadId: null,
    category: null,
    lines: [],
    title: "Content Partnership Proposal",
    subtitle: "",
    intro: "",
    discountPct: 0,
    monthlyOverrideCents: null,
    oneTimeOverrideCents: null,
    showLinePrices: true,
    billing: "monthly",
    roundToCents: 100,
    termsPreset: "monthly",
    terms: presetTerms("monthly"),
    notesTitle: "Content source + clipping",
    notes: "",
    preparedBy: "",
    date: todayIso(),
    validDays: 14,
  };
}

export function defaultIntro(category: CategoryId | null): string {
  return category ? CATEGORIES[category].intro : "";
}

export function formatDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Old drafts saved before a field existed still load cleanly. */
export function reviveProposal(raw: unknown): Proposal | null {
  if (!raw || typeof raw !== "object") return null;
  const base = blankProposal();
  const p = raw as Partial<Proposal>;
  if (!Array.isArray(p.lines)) return null;
  return {
    ...base,
    ...p,
    creator: { ...base.creator, ...(p.creator ?? {}) },
    // Drafts saved while packages existed carry fields that no longer do.
    lines: p.lines.map((l) => {
      const { includes: _i, isPackage: _p, ...line } = l as Line & { includes?: unknown; isPackage?: unknown };
      return line;
    }),
    terms: Array.isArray(p.terms) ? p.terms : base.terms,
  };
}
