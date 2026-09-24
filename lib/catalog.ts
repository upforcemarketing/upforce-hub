/* ---------------------------------------------------------------------------
   The service catalog, one price sheet per client category.

   Transcribed from "Upforce Service Catalog and Pricing" (Gaming, Gambling and
   Business tabs). Names and descriptions are rewritten for the client, since
   they print straight onto the proposal; costs and prices are as the sheet
   has them.

   A service that exists in more than one category keeps the same id in each.
   That is what lets the proposal builder carry a selection across when the
   category changes: the id stays, the price and wording follow the new sheet.
   --------------------------------------------------------------------------- */

export type CategoryId = "gaming" | "gambling" | "business";

export type Billing = "monthly" | "one-time";

export type Service = {
  id: string;
  group: string;
  name: string;
  /** Client-facing, printed on the proposal. */
  description: string;
  deliverables: string;
  turnaround: string;
  /** Expected editor cost. Internal only - never printed. */
  costCents: number;
  priceCents: number;
  billing: Billing;
  /** What one unit is, for "$75 / video" style labels. */
  unit: string;
  /** Kept off new proposals. Set from Settings. */
  hidden?: boolean;
  /** Added from Settings; not on the spreadsheet. */
  custom?: boolean;
  /** A sheet service whose defaults were changed in Settings. */
  edited?: boolean;
};

export type Category = {
  id: CategoryId;
  label: string;
  blurb: string;
  /** Default proposal intro. Editable per proposal. */
  intro: string;
  services: Service[];
};

const $ = (dollars: number) => Math.round(dollars * 100);

type Row = [
  id: string,
  group: string,
  name: string,
  description: string,
  deliverables: string,
  turnaround: string,
  cost: number,
  price: number,
  billing: Billing,
  unit: string,
];

function rows(list: Row[]): Service[] {
  return list.map(
    ([id, group, name, description, deliverables, turnaround, cost, price, billing, unit]) => ({
      id,
      group,
      name,
      description,
      deliverables,
      turnaround,
      costCents: $(cost),
      priceCents: $(price),
      billing,
      unit,
    })
  );
}

/* --- Shared wording ---------------------------------------------------------
   Each description is written once and reused by every sheet that sells the
   service, so the same service reads the same way on every proposal. */

const D = {
  longStd: "Clean long-form edit with captions, cuts and zooms.",
  longPro: "Full long-form edit with captions, pacing, music, sound effects and animations.",
  shortStd: "Short-form edit with captions.",
  shortPro: "Full short-form edit with captions and animations.",
  thumbStd: "Custom YouTube thumbnail design.",
  thumbPro: "High-end custom YouTube thumbnail design.",
  mgmt1: "Uploading, SEO and publishing of approved content on one channel (YouTube).",
  mgmtMulti: "Uploading, SEO and publishing of approved content across two or more channels.",
  clip1: "Source review and clipping to find and prepare the moments for one YouTube video.",
};

const EDIT = "Edited video + revision + export";
const THUMB = "Edited thumbnail + revisions + delivery";
const CLIP = "Clipping + shipping + revisions";

/* --- Gaming ---------------------------------------------------------------- */

const GAMING: Category = {
  id: "gaming",
  label: "Gaming",
  blurb: "Streamers and YouTube gaming creators",
  intro:
    "A content partnership built around consistent output: editing, design and channel support so your streams keep turning into videos that grow the channel.",
  services: [
    ...rows([
      ["long-t1", "Long-form editing", "Long-Form Edit (Standard)", D.longStd, EDIT, "48 hours", 50, 75, "one-time", "video"],
      ["long-t2", "Long-form editing", "Long-Form Edit (Premium)", D.longPro, EDIT, "48-72 hours", 50, 100, "one-time", "video"],
      ["short-over-t1", "Short-form editing", "Short-Form Edit, over 60s (Standard)", D.shortStd, EDIT, "48 hours", 10, 25, "one-time", "video"],
      ["short-over-t2", "Short-form editing", "Short-Form Edit, over 60s (Premium)", D.shortPro, EDIT, "48 hours", 25, 40, "one-time", "video"],
      ["short-under-t1", "Short-form editing", "Short-Form Edit, under 60s (Standard)", D.shortStd, EDIT, "48 hours", 10, 30, "one-time", "video"],
      ["short-under-t2", "Short-form editing", "Short-Form Edit, under 60s (Premium)", D.shortPro, EDIT, "48 hours", 25, 50, "one-time", "video"],
      ["thumb-1", "Thumbnails", "Thumbnail (Standard)", D.thumbStd, THUMB, "24-48 hours", 12.5, 25, "one-time", "thumbnail"],
      ["thumb-p1", "Thumbnails", "Thumbnail (Premium)", D.thumbPro, THUMB, "24-48 hours", 20, 30, "one-time", "thumbnail"],
      ["mgmt-1", "Management & clipping", "Channel Management (1 Channel)", D.mgmt1, "Uploading + SEO on 1 channel", "24 hours", 0, 100, "monthly", "month"],
      ["mgmt-multi", "Management & clipping", "Channel Management (2+ Channels)", D.mgmtMulti, "Uploading + SEO on 2+ channels", "24 hours", 0, 250, "monthly", "month"],
      ["clip-1", "Management & clipping", "Clipping (Single Video)", D.clip1, CLIP, "24 hours", 0, 50, "one-time", "video"],
    ]),
  ],
};

/* --- Gambling -------------------------------------------------------------- */

const GAMBLING: Category = {
  id: "gambling",
  label: "Gambling",
  blurb: "Casino and slots streamers, affiliates",
  intro:
    "A full-service partnership for casino and slots creators: editing, thumbnails and channel support, plus the affiliate tooling that turns an audience into tracked players.",
  services: [
    ...rows([
      ["long-1", "Long-form editing", "Long-Form Edit", "One long-form YouTube edit.", EDIT, "24-48 hours", 50, 100, "one-time", "video"],
      ["short-under", "Short-form editing", "Short-Form Edit, under 60s", "One short-form edit, under 60 seconds.", EDIT, "24-48 hours", 10, 15, "one-time", "video"],
      ["short-over", "Short-form editing", "Short-Form Edit, over 60s", "One short-form edit, over 60 seconds.", EDIT, "24-48 hours", 15, 20, "one-time", "video"],
      ["thumb-1", "Thumbnails", "Slots Thumbnail (Standard)", "Custom slots thumbnail design for YouTube.", THUMB, "24-48 hours", 12.5, 25, "one-time", "thumbnail"],
      ["thumb-p1", "Thumbnails", "Slots Thumbnail (Premium)", "High-end slots thumbnail design for YouTube.", THUMB, "24-48 hours", 20, 30, "one-time", "thumbnail"],
      ["mgmt-1", "Management & clipping", "Channel Management (1 Channel)", D.mgmt1, "Uploading + SEO on 1 channel", "24 hours", 0, 200, "monthly", "month"],
      ["mgmt-multi", "Management & clipping", "Channel Management (2+ Channels)", D.mgmtMulti, "Uploading + SEO on 2+ channels", "24 hours", 0, 400, "monthly", "month"],
      ["clip-1", "Management & clipping", "Clipping (Single Video)", D.clip1, CLIP, "24 hours", 0, 50, "one-time", "video"],
      ["sheet-500", "Affiliate", "Player Username Sheet (500)", "A list of 500 player usernames from one casino.", "500 usernames from 1 casino", "24-48 hours", 0, 250, "one-time", "sheet"],
      ["sheet-5k", "Affiliate", "Player Username Sheet (5,000)", "A list of 5,000 player usernames from two casinos.", "5,000 usernames from 2 casinos", "24-48 hours", 0, 1000, "one-time", "sheet"],
      ["sheet-50k", "Affiliate", "Player Username Sheet (50,000)", "A list of 50,000 player usernames from two or more casinos.", "50,000 usernames from 2+ casinos", "24-48 hours", 0, 5000, "one-time", "sheet"],
      ["web-site", "Website", "Affiliate Website", "Casino streamer website, designed and developed front to back.", "Designed website, front and back end", "14 days", 1500, 2500, "one-time", "project"],
      ["web-retainer", "Website", "Website Management", "Monthly development retainer covering up to 10 hours of work.", "Up to 10 dev hours / month", "48 hours", 1000, 2000, "monthly", "month"],
      ["web-checker", "Website", "Affiliate Cross-Checker", "Access to the UpForce username cross-reference tool.", "1 month of cross-checker access", "30 days", 0, 2000, "monthly", "month"],
    ]),
  ],
};

/* --- Business -------------------------------------------------------------- */

const BUSINESS: Category = {
  id: "business",
  label: "Business",
  blurb: "Brands, founders, podcasts and companies",
  intro:
    "End-to-end video production support for your brand: polished long-form, short-form built for reach, and the design and publishing work that keeps it all consistent.",
  services: [
    ...rows([
      ["podcast", "Podcast", "Podcast Episode Edit", "Professional podcast edit, with clips and thumbnails for the episode.", "Episode + clips", "48-72 hours", 100, 250, "one-time", "episode"],
      ["long-t1", "Long-form editing", "Long-Form Edit (Standard)", D.longStd, EDIT, "48 hours", 75, 150, "one-time", "video"],
      ["long-t2", "Long-form editing", "Long-Form Edit (Premium)", D.longPro, EDIT, "48-72 hours", 100, 250, "one-time", "video"],
      ["short-over-t1", "Short-form editing", "Short-Form Edit, over 60s (Standard)", D.shortStd, EDIT, "48 hours", 25, 40, "one-time", "video"],
      ["short-over-t2", "Short-form editing", "Short-Form Edit, over 60s (Premium)", D.shortPro, EDIT, "48 hours", 40, 75, "one-time", "video"],
      ["short-under-t1", "Short-form editing", "Short-Form Edit, under 60s (Standard)", D.shortStd, EDIT, "48 hours", 30, 50, "one-time", "video"],
      ["short-under-t2", "Short-form editing", "Short-Form Edit, under 60s (Premium)", D.shortPro, EDIT, "48 hours", 50, 100, "one-time", "video"],
      ["thumb-1", "Thumbnails", "Thumbnail", D.thumbStd, THUMB, "24-48 hours", 25, 50, "one-time", "thumbnail"],
      ["mgmt-1", "Management & clipping", "Channel Management (1 Channel)", D.mgmt1, "Uploading + SEO on 1 channel", "24 hours", 0, 100, "monthly", "month"],
      ["mgmt-multi", "Management & clipping", "Channel Management (2+ Channels)", D.mgmtMulti, "Uploading + SEO on 2+ channels", "24 hours", 0, 250, "monthly", "month"],
      ["clip-1", "Management & clipping", "Clipping (Single Video)", D.clip1, CLIP, "24 hours", 0, 50, "one-time", "video"],
    ]),
  ],
};

/** The spreadsheet as shipped. The built-in defaults every edit resets to. */
export const CATEGORIES: Record<CategoryId, Category> = {
  gaming: GAMING,
  gambling: GAMBLING,
  business: BUSINESS,
};

export const CATEGORY_ORDER: CategoryId[] = ["gaming", "gambling", "business"];

/* --- Edited defaults --------------------------------------------------------
   Settings stores the team's changes to the sheet in the service_catalog
   table: a row per service that differs, keyed by (category, service id).
   The catalog every screen reads is the sheet with those rows laid over it. */

export type ServiceOverride = {
  category: CategoryId;
  serviceId: string;
  group: string;
  name: string;
  description: string;
  deliverables: string;
  turnaround: string;
  priceCents: number;
  costCents: number;
  billing: Billing;
  unit: string;
  isCustom: boolean;
  hidden: boolean;
  sort: number;
};

/** Every category's services, sheet defaults with Settings edits applied. */
export type Catalog = Record<CategoryId, Service[]>;

function fromOverride(o: ServiceOverride, edited: boolean): Service {
  return {
    id: o.serviceId,
    group: o.group,
    name: o.name,
    description: o.description,
    deliverables: o.deliverables,
    turnaround: o.turnaround,
    priceCents: o.priceCents,
    costCents: o.costCents,
    billing: o.billing,
    unit: o.unit,
    hidden: o.hidden,
    custom: !edited,
    edited,
  };
}

const COMPARED: (keyof Service)[] = [
  "group", "name", "description", "deliverables", "turnaround",
  "priceCents", "costCents", "billing", "unit",
];

function differs(a: Service, b: Service): boolean {
  return COMPARED.some((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

export function resolveCatalog(overrides: ServiceOverride[]): Catalog {
  const out = {} as Catalog;
  for (const id of CATEGORY_ORDER) {
    const rows = overrides.filter((o) => o.category === id);
    const byId = new Map(rows.map((o) => [o.serviceId, o]));
    const sheet = CATEGORIES[id].services.map((s) => {
      const o = byId.get(s.id);
      if (!o) return s;
      const merged = fromOverride(o, true);
      // Hiding alone is not an edit to the service itself.
      return { ...merged, edited: differs(s, merged) };
    });
    const added = rows
      .filter((o) => !CATEGORIES[id].services.some((s) => s.id === o.serviceId))
      .sort((a, b) => a.sort - b.sort)
      .map((o) => fromOverride(o, false));
    out[id] = [...sheet, ...added];
  }
  return out;
}

/** The untouched spreadsheet catalog, for when no edits have loaded. */
export const SHEET_CATALOG: Catalog = resolveCatalog([]);

/** The spreadsheet's own version of a service, if it has one. */
export function sheetService(category: CategoryId, id: string): Service | undefined {
  return CATEGORIES[category].services.find((s) => s.id === id);
}

export function overrideFromService(
  category: CategoryId,
  s: Service,
  sort: number
): ServiceOverride {
  return {
    category,
    serviceId: s.id,
    group: s.group,
    name: s.name,
    description: s.description,
    deliverables: s.deliverables,
    turnaround: s.turnaround,
    priceCents: s.priceCents,
    costCents: s.costCents,
    billing: s.billing,
    unit: s.unit,
    isCustom: !sheetService(category, s.id),
    hidden: !!s.hidden,
    sort,
  };
}

export function serviceById(
  catalog: Catalog,
  category: CategoryId,
  id: string
): Service | undefined {
  return catalog[category].find((s) => s.id === id);
}

/* The Gambling sheet sells one long-form and one short-form tier where the
   other two sheets sell a Standard and a Premium. These families say which
   service stands in for which, nearest match first, so switching category
   maps a line across instead of dropping it. */
const FAMILIES: string[][] = [
  ["long-t2", "long-1", "long-t1"],
  ["short-over-t1", "short-over", "short-over-t2"],
  ["short-under-t1", "short-under", "short-under-t2"],
];

/**
 * The same service in another category, or its nearest equivalent there.
 * Hidden services are not on offer, so they never stand in.
 */
export function equivalentService(
  catalog: Catalog,
  category: CategoryId,
  id: string
): Service | undefined {
  const offered = (sid: string) => {
    const s = serviceById(catalog, category, sid);
    return s && !s.hidden ? s : undefined;
  };
  const exact = offered(id);
  if (exact) return exact;
  const family = FAMILIES.find((f) => f.includes(id));
  for (const alt of family ?? []) {
    const s = offered(alt);
    if (s) return s;
  }
  return undefined;
}

/**
 * Services grouped for display, groups in order of first appearance. A
 * service added from Settings joins its group rather than trailing the list.
 */
export function groupedServices(services: Service[]): { group: string; services: Service[] }[] {
  const groups = new Map<string, Service[]>();
  for (const s of services) {
    const list = groups.get(s.group);
    if (list) list.push(s);
    else groups.set(s.group, [s]);
  }
  return Array.from(groups, ([group, list]) => ({ group, services: list }));
}

/** Group names in a category, for the "add service" picker. */
export function groupNames(catalog: Catalog, category: CategoryId): string[] {
  return groupedServices(catalog[category]).map((g) => g.group);
}
