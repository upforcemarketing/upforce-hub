"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";

import { useHub } from "@/components/HubStore";
import { MarginChip, MarginInput, marginTone } from "@/components/ui";
import { useCatalog } from "@/components/useCatalog";
import { ProposalStatusPicker } from "@/components/ProposalStatusPicker";
import { statusMeta, useSetProposalStatus } from "@/components/useProposalStatus";
import { getProposal, saveProposal } from "@/app/(app)/actions";
import { ProposalDocument } from "@/components/proposal/ProposalDocument";
import {
  CATEGORIES,
  CATEGORY_ORDER,
  groupedServices,
  serviceById,
  type Billing,
  type CategoryId,
  type Service,
} from "@/lib/catalog";
import {
  baseForEffective,
  basePrice,
  blankProposal,
  customLine,
  defaultIntro,
  discountOf,
  followsProposalBilling,
  lineCost,
  lineFromService,
  lineTotal,
  marginOf,
  moveToCategory,
  newKey,
  presetTerms,
  priceForMargin,
  reviveProposal,
  TERMS_PRESETS,
  totals,
  unitPrice,
  usd,
  type Creator,
  type Line,
  type Proposal,
  type Term,
  todayIso,
} from "@/lib/proposal";
import type { Lead, ProposalStatus } from "@/lib/types";

/* ---------------------------------------------------------------------------
   Proposal builder.

   Five steps down the left, the finished document on the right. Everything
   is one Proposal value; the preview and the PDF are both a pure render of
   it, so there is no "generate" step that could drift from what was typed.

   The draft lives in this browser only. It is a working copy, not a record:
   the signed PDF is the record, and it lives wherever the signed PDF goes.
   --------------------------------------------------------------------------- */

const DRAFT_KEY = "upf-proposal-draft";

function loadDraft(): Proposal | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    return raw ? reviveProposal(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Which saved proposal the draft is, kept beside it in this browser. */
type DraftMeta = { savedId: string | null; status: ProposalStatus; snapshot: string | null };
const META_KEY = "upf-proposal-draft-meta";
const EMPTY_META: DraftMeta = { savedId: null, status: "draft", snapshot: null };

function loadMeta(): DraftMeta | null {
  try {
    const raw = window.localStorage.getItem(META_KEY);
    return raw ? { ...EMPTY_META, ...(JSON.parse(raw) as Partial<DraftMeta>) } : null;
  } catch {
    return null;
  }
}

function saveMeta(meta: DraftMeta) {
  try {
    window.localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    /* the draft still works; it just forgets which saved proposal it was */
  }
}

/** Links a proposal to a lead and fills the creator details from it. */
function withLead(p: Proposal, lead: Lead | undefined): Proposal {
  if (!lead) return p;
  return {
    ...p,
    leadId: lead.id,
    creator: {
      ...p.creator,
      name: lead.name,
      handle: lead.handle,
      platform: lead.platform,
      audience: lead.audience,
      email: lead.email,
    },
  };
}

function saveDraft(p: Proposal): boolean {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(p));
    return true;
  } catch {
    // Usually a large logo pushing past the storage quota. Keep the rest.
    try {
      window.localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ ...p, creator: { ...p.creator, logo: "" } })
      );
    } catch {
      /* storage unavailable: the draft just won't survive a reload */
    }
    return false;
  }
}

export function ProposalsView() {
  const { ws, notify, proposals } = useHub();
  const catalog = useCatalog();
  const params = useSearchParams();
  const setProposalStatus = useSetProposalStatus();
  const [p, setP] = useState<Proposal>(blankProposal);
  const [loaded, setLoaded] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pages, setPages] = useState(2);

  /* Where this draft lives in the database, if anywhere. `snapshot` is the
     proposal as last saved, so "unsaved changes" is a plain comparison. */
  const [savedId, setSavedId] = useState<string | null>(null);
  const [status, setStatus] = useState<ProposalStatus>("draft");
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const openedKey = useRef<string | null>(null);
  const confirmed = useRef(false);
  const consumeConfirmed = () => {
    const was = confirmed.current;
    confirmed.current = false;
    return was;
  };
  const router = useRouter();
  const savedIdRef = useRef(savedId);
  savedIdRef.current = savedId;

  const dirty = snapshot === null ? p.lines.length > 0 : JSON.stringify(p) !== snapshot;

  const adopt = (doc: Proposal, meta: DraftMeta) => {
    setP(doc);
    setSavedId(meta.savedId);
    setStatus(meta.status);
    setSnapshot(meta.snapshot);
  };

  /**
   * What to open: ?id= a saved proposal, ?from= a copy of one, ?lead= a new
   * proposal for that creator - otherwise the draft this browser was last on.
   * Unsaved edits to the same saved proposal win over its stored copy, so a
   * reload never throws work away.
   */
  const openKey = params.toString();
  useEffect(() => {
    const id = params.get("id");
    const from = params.get("from");
    const leadId = params.get("lead");
    // Our own URL updates (after a save) land here too; nothing to reopen.
    if (openedKey.current !== null && (!openKey || id === savedIdRef.current)) return;
    openedKey.current = openKey;

    const draft = loadDraft();
    const meta = loadMeta();
    const draftDirty =
      !!draft && (meta?.snapshot ? JSON.stringify(draft) !== meta.snapshot : draft.lines.length > 0);
    const finish = () => {
      setLoaded(true);
      setMounted(true);
    };
    const keepDraft = () => {
      if (draft) adopt(draft, meta ?? EMPTY_META);
      finish();
    };
    const leaving = (next: string | null) =>
      consumeConfirmed() ||
      !draftDirty ||
      meta?.savedId === next ||
      window.confirm("You have unsaved changes to another proposal. Discard them?");

    if (id || from) {
      if (id && meta?.savedId === id && draft) return keepDraft();
      if (!leaving(id)) {
        window.history.replaceState(null, "", "/proposals");
        return keepDraft();
      }
      let cancelled = false;
      void getProposal((id || from) as string).then((r) => {
        if (cancelled) return;
        if (!r.ok) {
          notify(r.error);
          return keepDraft();
        }
        const doc = reviveProposal(r.data.data) ?? blankProposal();
        if (id) {
          adopt(doc, { savedId: id, status: r.data.status as ProposalStatus, snapshot: JSON.stringify(doc) });
        } else {
          adopt({ ...doc, date: todayIso() }, EMPTY_META);
          window.history.replaceState(null, "", "/proposals");
          notify("Copy opened. Save it to keep it as a new proposal");
        }
        finish();
      });
      return () => {
        cancelled = true;
      };
    }

    if (leadId) {
      window.history.replaceState(null, "", "/proposals");
      if (!leaving(null)) return keepDraft();
      adopt(withLead(blankProposal(), ws.leads.find((l) => l.id === leadId)), EMPTY_META);
      return finish();
    }

    keepDraft();
    // Reopen only when the address asks for something new.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey]);


  useEffect(() => {
    if (loaded) saveDraft(p);
  }, [p, loaded]);

  useEffect(() => {
    if (loaded) saveMeta({ savedId, status, snapshot });
  }, [savedId, status, snapshot, loaded]);

  const patch = (next: Partial<Proposal>) => setP((cur) => ({ ...cur, ...next }));
  const patchCreator = (next: Partial<Creator>) =>
    setP((cur) => ({ ...cur, creator: { ...cur.creator, ...next } }));
  const patchLine = (key: string, next: Partial<Line>) =>
    setP((cur) => ({
      ...cur,
      lines: cur.lines.map((l) => (l.key === key ? { ...l, ...next } : l)),
    }));
  const removeLine = (key: string) =>
    setP((cur) => ({ ...cur, lines: cur.lines.filter((l) => l.key !== key) }));

  const t = useMemo(() => totals(p), [p]);
  /** What a bucket would total with no override: subtotal less the discount. */
  const sheetTotal = (subtotal: number) =>
    subtotal - Math.round((subtotal * p.discountPct) / 100);

  /* --- Actions ----------------------------------------------------------- */

  const chooseCategory = (id: CategoryId) => {
    if (p.category === id) return;
    const { lines, dropped } = moveToCategory(catalog, p.lines, id);
    const prevIntro = defaultIntro(p.category);
    setP((cur) => ({
      ...cur,
      category: id,
      lines,
      // A typed total was agreed against the old sheet's scope; carrying it
      // over would quietly price a different scope at the old number.
      monthlyOverrideCents: null,
      oneTimeOverrideCents: null,
      // Swap the intro only if it is still the stock one for the old category.
      intro: !cur.intro.trim() || cur.intro === prevIntro ? defaultIntro(id) : cur.intro,
    }));
    if (dropped.length)
      notify(
        `${dropped.length} service${dropped.length === 1 ? "" : "s"} not offered for ${CATEGORIES[id].label} removed`
      );
    else if (lines.length) notify(`Repriced to the ${CATEGORIES[id].label} sheet`);
  };

  const toggleService = (s: Service, on: boolean) =>
    setP((cur) =>
      on
        ? { ...cur, lines: [...cur.lines, lineFromService(s, cur.billing)] }
        : { ...cur, lines: cur.lines.filter((l) => l.serviceId !== s.id) }
    );

  /** Switches the proposal between a retainer and a project, lines included. */
  const setBilling = (billing: Billing) =>
    setP((cur) => ({
      ...cur,
      billing,
      lines: cur.lines.map((l) => (followsProposalBilling(l.unit) ? { ...l, billing } : l)),
      // A typed total belongs to the old billing; it would land in the wrong bucket.
      monthlyOverrideCents: null,
      oneTimeOverrideCents: null,
    }));

  /** Reprices every line with a cost to hit `marginPct`. Free lines stay free. */
  const applyMargin = (marginPct: number) =>
    setP((cur) => ({
      ...cur,
      lines: cur.lines.map((l) => {
        if (isFree(l)) return l;
        const price = priceForMargin(l.costCents ?? l.listCostCents, marginPct, cur.roundToCents);
        return price === null ? l : chargeAt(l, price);
      }),
    }));

  /**
   * Turns a typed total into line prices: every priced line in that billing
   * scales by the same factor, so the lines add up to the target (give or take
   * rounding) and the proposal no longer needs a separate adjustment row.
   */
  const spreadTotal = (billing: Billing) =>
    setP((cur) => {
      const target = billing === "monthly" ? cur.monthlyOverrideCents : cur.oneTimeOverrideCents;
      const lines = cur.lines.filter((l) => !l.optional && l.billing === billing && unitPrice(l) > 0);
      const subtotal = lines.reduce((n, l) => n + lineTotal(l), 0);
      if (target === null || subtotal === 0) return cur;
      // The discount still applies once the override is gone, so aim above
      // the target by exactly what it will take off.
      const keep = 1 - Math.min(99, Math.max(0, cur.discountPct)) / 100;
      const factor = target / (subtotal * keep);
      const step = cur.roundToCents > 0 ? cur.roundToCents : 1;
      const prices = new Map(
        lines.map((l) => [l.key, Math.max(step, Math.round((unitPrice(l) * factor) / step) * step)])
      );

      // Rounding leaves the lines a few dollars off the target. With no
      // discount in play, a single-quantity line can absorb that exactly -
      // one without its own line discount, whose price lands to the cent.
      if (keep === 1) {
        const drift = target - lines.reduce((n, l) => n + (prices.get(l.key) ?? 0) * l.qty, 0);
        const sink = [...lines]
          .reverse()
          .find((l) => l.qty === 1 && discountOf(l) === 0 && (prices.get(l.key) ?? 0) + drift > 0);
        if (drift !== 0 && sink) prices.set(sink.key, (prices.get(sink.key) ?? 0) + drift);
      }

      return {
        ...cur,
        ...(billing === "monthly" ? { monthlyOverrideCents: null } : { oneTimeOverrideCents: null }),
        lines: cur.lines.map((l) => {
          const price = prices.get(l.key);
          return price === undefined ? l : chargeAt(l, price);
        }),
      };
    });

  /** Links the proposal to a lead and fills the creator from it. */
  const loadLead = (leadId: string) =>
    setP((cur) =>
      leadId ? withLead(cur, ws.leads.find((l) => l.id === leadId)) : { ...cur, leadId: null }
    );

  const reset = () => {
    if (dirty && !window.confirm("Start a new proposal? Unsaved changes to this one will be lost.")) return;
    adopt(blankProposal(), EMPTY_META);
    window.history.replaceState(null, "", "/proposals");
    notify("New proposal started");
  };

  /**
   * Saves to the database under the linked lead. `asNew` forks a copy: the
   * saved one is left as it was and this becomes a separate draft.
   */
  const save = async (asNew = false) => {
    if (!ws.proposalsReady) {
      notify("Saving needs the proposals table. Run supabase/migrations/0006_proposals.sql in the Supabase SQL Editor.");
      return;
    }
    if (!p.lines.length) return notify("Add at least one service before saving");
    if (
      !p.leadId &&
      !window.confirm("This proposal isn't linked to a lead, so it won't show on a creator's profile. Save anyway?")
    )
      return;

    const id = asNew ? null : savedId;
    const nextStatus: ProposalStatus = asNew ? "draft" : status;
    const title = p.title.trim() || "Untitled proposal";
    setSaving(true);
    const r = await saveProposal({
      id,
      leadId: p.leadId,
      title,
      status: nextStatus,
      data: p,
      monthlyCents: t.monthly.total,
      oneTimeCents: t.oneTime.total,
    });
    setSaving(false);
    if (!r.ok) return notify(r.error);

    proposals.upsert({
      id: r.data.id,
      leadId: p.leadId,
      title,
      status: nextStatus,
      monthlyCents: t.monthly.total,
      oneTimeCents: t.oneTime.total,
      createdAt: r.data.createdAt,
      updatedAt: r.data.updatedAt,
    });
    adopt(p, { savedId: r.data.id, status: nextStatus, snapshot: JSON.stringify(p) });
    window.history.replaceState(null, "", `/proposals?id=${r.data.id}`);
    const leadName = ws.leads.find((l) => l.id === p.leadId)?.name;
    notify(leadName ? `Saved to ${leadName}'s profile` : "Proposal saved");
  };

  const changeStatus = (next: ProposalStatus) => {
    setStatus(next);
    const summary = ws.proposals.find((s) => s.id === savedId);
    if (summary) setProposalStatus(summary, next);
  };

  const download = () => {
    if (!p.lines.length) {
      notify("Select at least one service first");
      return;
    }
    const prevTitle = document.title;
    // Chrome and Safari name the saved PDF after the document title.
    document.title = `UpForce x ${p.creator.name.trim() || "Creator"} Proposal`;
    const restore = () => {
      document.title = prevTitle;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.print();
  };

  const creatorName = p.creator.name.trim();

  const steps: { id: string; label: string; done: boolean }[] = [
    { id: "step-creator", label: "Creator", done: !!creatorName },
    { id: "step-category", label: "Category", done: !!p.category },
    { id: "step-services", label: "Services", done: p.lines.length > 0 },
    { id: "step-pricing", label: "Pricing", done: p.lines.length > 0 },
    { id: "step-terms", label: "Terms", done: p.terms.length > 0 },
  ];

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <nav aria-label="Steps" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {steps.map((s, i) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="upf-pill upf-focus"
              style={{
                color: s.done ? "var(--ta)" : "var(--t37)",
                background: s.done ? "var(--t14)" : "var(--t6)",
                borderColor: s.done ? "var(--t25)" : "var(--t21)",
              }}
            >
              <span className="upf-mono" style={{ fontSize: 11 }}>
                {s.done ? "✓" : i + 1}
              </span>
              {s.label}
            </a>
          ))}
        </nav>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <SaveState
            savedId={savedId}
            dirty={dirty}
            saving={saving}
            leadName={ws.leads.find((l) => l.id === p.leadId)?.name ?? null}
          />
          {savedId ? (
            <ProposalStatusPicker value={status} onChange={changeStatus} label="Proposal status" />
          ) : null}
          {ws.proposals.length ? (
            <select
              className="upf-input"
              style={{ width: 170, height: 32, fontSize: 12.5 }}
              value=""
              aria-label="Open a saved proposal"
              onChange={(e) => {
                const id = e.target.value;
                if (!id || id === savedId) return;
                if (dirty && !window.confirm("Open another proposal? Unsaved changes to this one will be lost.")) return;
                // Already confirmed here, so opening it should not ask again.
                confirmed.current = true;
                router.push(`/proposals?id=${id}`);
              }}
            >
              <option value="">Open saved…</option>
              {ws.proposals.map((s) => (
                <option key={s.id} value={s.id}>
                  {ws.leads.find((l) => l.id === s.leadId)?.name ?? "No lead"} · {s.title} ·{" "}
                  {statusMeta(s.status).label}
                </option>
              ))}
            </select>
          ) : null}
          <button type="button" className="upf-btn upf-btn-ghost" onClick={reset}>
            New proposal
          </button>
          {savedId ? (
            <button type="button" className="upf-btn upf-btn-ghost" disabled={saving} onClick={() => void save(true)}>
              Save as new
            </button>
          ) : null}
          <button
            type="button"
            className="upf-btn"
            disabled={saving || (!!savedId && !dirty)}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : savedId && !dirty ? "Saved" : "Save"}
          </button>
          <button type="button" className="upf-btn" onClick={download}>
            ↓ Download PDF
          </button>
        </div>
      </div>

      <div className="upf-proposal-grid">
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          {/* --- 1. Creator ------------------------------------------------ */}
          <Step id="step-creator" n={1} title="Creator" hint="Who this proposal is for.">
            {ws.leads.length ? (
              <Field label="Lead (the proposal saves to their profile)">
                <select
                  className="upf-input"
                  value={p.leadId ?? ""}
                  onChange={(e) => loadLead(e.target.value)}
                >
                  <option value="">No lead - not linked</option>
                  {[...ws.leads]
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                        {l.handle ? ` (${l.handle})` : ""}
                      </option>
                    ))}
                </select>
              </Field>
            ) : null}

            {ws.leads.length && !p.leadId ? (
              <div style={{ fontSize: 12, color: "var(--ta)", margin: "6px 0 0" }}>
                Pick the lead so this proposal saves to their profile.
              </div>
            ) : null}

            <div className="upf-form-grid" style={{ marginTop: 10 }}>
              <Field label="Creator / brand name" required>
                <input
                  className="upf-input"
                  value={p.creator.name}
                  onChange={(e) => patchCreator({ name: e.target.value })}
                  placeholder="PatrckStatic"
                />
              </Field>
              <Field label="Contact name">
                <input
                  className="upf-input"
                  value={p.creator.contactName}
                  onChange={(e) => patchCreator({ contactName: e.target.value })}
                  placeholder="Who signs"
                />
              </Field>
              <Field label="Handle">
                <input
                  className="upf-input"
                  value={p.creator.handle}
                  onChange={(e) => patchCreator({ handle: e.target.value })}
                  placeholder="@handle"
                />
              </Field>
              <Field label="Platform">
                <input
                  className="upf-input"
                  list="upf-platforms"
                  value={p.creator.platform}
                  onChange={(e) => patchCreator({ platform: e.target.value })}
                  placeholder="YouTube, Twitch, Kick…"
                />
                <datalist id="upf-platforms">
                  {ws.platforms.map((pl) => (
                    <option key={pl.id} value={pl.name} />
                  ))}
                </datalist>
              </Field>
              <Field label="Email">
                <input
                  className="upf-input"
                  type="email"
                  value={p.creator.email}
                  onChange={(e) => patchCreator({ email: e.target.value })}
                  placeholder="name@example.com"
                />
              </Field>
              <Field label="Audience / niche">
                <input
                  className="upf-input"
                  value={p.creator.audience}
                  onChange={(e) => patchCreator({ audience: e.target.value })}
                  placeholder="e.g. 120k subs, FPS"
                />
              </Field>
            </div>

            <LogoField
              value={p.creator.logo}
              onChange={(logo) => patchCreator({ logo })}
              onTooBig={() => notify("Logo is over 1.5 MB. Try a smaller PNG or JPG")}
            />
          </Step>

          {/* --- 2. Category ----------------------------------------------- */}
          <Step
            id="step-category"
            n={2}
            title="Category"
            hint="Sets which price sheet the services come from."
          >
            <div role="radiogroup" aria-label="Category" className="upf-cat-grid">
              {CATEGORY_ORDER.map((id) => {
                const c = CATEGORIES[id];
                const on = p.category === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => chooseCategory(id)}
                    className="upf-focus upf-hover-card"
                    style={{
                      textAlign: "left",
                      padding: "13px 14px",
                      borderRadius: 11,
                      background: on ? "var(--t14)" : "var(--t6)",
                      border: `1px solid ${on ? "var(--ta)" : "var(--t21)"}`,
                    }}
                  >
                    <div
                      className="upf-display"
                      style={{
                        fontSize: 15,
                        fontWeight: 600,
                        color: on ? "var(--ta)" : "var(--t40)",
                      }}
                    >
                      {c.label}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--t36)", marginTop: 3 }}>
                      {c.blurb}
                    </div>
                    <div className="upf-label" style={{ marginTop: 8 }}>
                      {catalog[id].filter((s) => !s.hidden).length} services
                    </div>
                  </button>
                );
              })}
            </div>
          </Step>

          {/* --- 3. Services ----------------------------------------------- */}
          <Step
            id="step-services"
            n={3}
            title="Services"
            hint={
              p.category
                ? `${CATEGORIES[p.category].label} price sheet. Tick everything going into the proposal.`
                : "Choose a category first."
            }
            aside={
              <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {p.lines.length ? (
                  <span className="upf-label" style={{ color: "var(--ta)" }}>
                    {p.lines.length} selected
                  </span>
                ) : null}
                <Link href="/settings?tab=catalog" style={{ fontSize: 12 }}>
                  Edit defaults
                </Link>
              </span>
            }
          >
            {p.category ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span className="upf-label">Billed as</span>
                  <div role="radiogroup" aria-label="Billing" style={{ display: "flex", gap: 6 }}>
                    {(
                      [
                        ["monthly", "Monthly retainer"],
                        ["one-time", "One-time project"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        role="radio"
                        aria-checked={p.billing === id}
                        className="upf-pill upf-focus"
                        onClick={() => setBilling(id)}
                        style={{
                          padding: "5px 11px",
                          fontSize: 12.5,
                          color: p.billing === id ? "var(--ta)" : "var(--t37)",
                          background: p.billing === id ? "var(--t14)" : "var(--t6)",
                          borderColor: p.billing === id ? "var(--ta)" : "var(--t21)",
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <span style={{ fontSize: 11.5, color: "var(--t34)" }}>
                    {p.billing === "monthly"
                      ? "Quantities are per month, e.g. 12 edits a month."
                      : "Quantities are for the whole project."}
                  </span>
                </div>
                {groupedServices(catalog[p.category].filter((s) => !s.hidden)).map(({ group, services }) => (
                  <div key={group}>
                    <div className="upf-label" style={{ marginBottom: 6 }}>
                      {group}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {services.map((s) => {
                        const line = p.lines.find((l) => l.serviceId === s.id);
                        return (
                          <ServiceRow
                            key={s.id}
                            s={s}
                            line={line}
                            onChange={(on) => toggleService(s, on)}
                            onQty={(qty) => line && patchLine(line.key, { qty })}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  className="upf-btn upf-btn-ghost"
                  style={{ alignSelf: "flex-start" }}
                  onClick={() =>
                    setP((cur) => ({ ...cur, lines: [...cur.lines, customLine(cur.billing)] }))
                  }
                >
                  + Add custom service
                </button>
              </div>
            ) : (
              <Muted>Pick Gaming, Gambling or Business in step 2 to see its services.</Muted>
            )}
          </Step>

          {/* --- 4. Pricing ------------------------------------------------ */}
          <Step
            id="step-pricing"
            n={4}
            title="Pricing & margin"
            hint="Set a price or a margin on any line and the other is worked out. Blank uses the sheet price; use Offer a discount to take a % off."
          >
            {p.lines.length ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {p.lines.map((l) => (
                  <LineEditor
                    key={l.key}
                    line={l}
                    roundTo={p.roundToCents}
                    current={
                      p.category && l.serviceId
                        ? serviceById(catalog, p.category, l.serviceId)
                        : undefined
                    }
                    onChange={(next) => patchLine(l.key, next)}
                    onRemove={() => removeLine(l.key)}
                  />
                ))}
              </div>
            ) : (
              <Muted>Selected services show up here to adjust quantity and price.</Muted>
            )}

            <div className="upf-divider" style={{ margin: "16px 0 14px" }} />

            <PricingTools
              p={p}
              t={t}
              sheetTotal={sheetTotal}
              onPatch={patch}
              onApplyMargin={applyMargin}
              onSpread={spreadTotal}
            />

            <label
              style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13 }}
            >
              <input
                type="checkbox"
                className="upf-checkbox"
                checked={p.showLinePrices}
                onChange={(e) => patch({ showLinePrices: e.target.checked })}
              />
              Show line-item prices on the PDF
              <span style={{ color: "var(--t34)" }}>(off prints totals only)</span>
            </label>

            <InternalSummary t={t} />
          </Step>

          {/* --- 5. Terms & document -------------------------------------- */}
          <Step id="step-terms" n={5} title="Terms & details" hint="Header copy, dates and the terms page.">
            <div className="upf-form-grid">
              <Field label="Proposal title">
                <input
                  className="upf-input"
                  value={p.title}
                  onChange={(e) => patch({ title: e.target.value })}
                />
              </Field>
              <Field label="Header subtitle">
                <input
                  className="upf-input"
                  value={p.subtitle}
                  onChange={(e) => patch({ subtitle: e.target.value })}
                  placeholder="A streamlined YouTube + short form package…"
                />
              </Field>
            </div>
            <Field label="Intro paragraph" style={{ marginTop: 10 }}>
              <textarea
                className="upf-input"
                rows={3}
                value={p.intro}
                onChange={(e) => patch({ intro: e.target.value })}
                placeholder="Optional opening paragraph"
              />
            </Field>
            <div className="upf-form-grid upf-form-grid-3" style={{ marginTop: 10 }}>
              <Field label="Proposal date">
                <input
                  className="upf-input"
                  type="date"
                  value={p.date}
                  onChange={(e) => patch({ date: e.target.value })}
                />
              </Field>
              <Field label="Valid for (days)">
                <input
                  className="upf-input"
                  type="number"
                  min={1}
                  value={p.validDays}
                  onChange={(e) => patch({ validDays: Math.max(1, Number(e.target.value) || 1) })}
                />
              </Field>
              <Field label="UpForce signer">
                <input
                  className="upf-input"
                  placeholder="Name, title"
                  value={p.preparedBy}
                  onChange={(e) => patch({ preparedBy: e.target.value })}
                />
              </Field>
            </div>

            <div className="upf-divider" style={{ margin: "16px 0 12px" }} />

            <div className="upf-label" style={{ marginBottom: 8 }}>
              Terms preset
            </div>
            <div className="upf-cat-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
              {(Object.keys(TERMS_PRESETS) as (keyof typeof TERMS_PRESETS)[]).map((id) => {
                const on = p.termsPreset === id;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={on}
                    className="upf-focus"
                    onClick={() => {
                      if (
                        p.termsPreset === "custom" &&
                        !window.confirm("Replace your edited terms with this preset?")
                      )
                        return;
                      patch({ termsPreset: id, terms: presetTerms(id) });
                    }}
                    style={{
                      textAlign: "left",
                      padding: "10px 12px",
                      borderRadius: 10,
                      background: on ? "var(--t14)" : "var(--t6)",
                      border: `1px solid ${on ? "var(--ta)" : "var(--t21)"}`,
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 13, color: on ? "var(--ta)" : "var(--t40)" }}>
                      {TERMS_PRESETS[id].label}
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--t35)", marginTop: 2 }}>
                      {TERMS_PRESETS[id].blurb}
                    </div>
                  </button>
                );
              })}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
              {p.terms.map((term) => (
                <TermEditor
                  key={term.key}
                  term={term}
                  onChange={(next) =>
                    setP((cur) => ({
                      ...cur,
                      termsPreset: "custom",
                      terms: cur.terms.map((x) => (x.key === term.key ? { ...x, ...next } : x)),
                    }))
                  }
                  onRemove={() =>
                    setP((cur) => ({
                      ...cur,
                      termsPreset: "custom",
                      terms: cur.terms.filter((x) => x.key !== term.key),
                    }))
                  }
                />
              ))}
              <button
                type="button"
                className="upf-btn upf-btn-ghost"
                style={{ alignSelf: "flex-start" }}
                onClick={() =>
                  setP((cur) => ({
                    ...cur,
                    termsPreset: "custom",
                    terms: [...cur.terms, { key: newKey("term"), title: "", body: "" }],
                  }))
                }
              >
                + Add term
              </button>
              <Muted>
                Write <code className="upf-mono">{"{creator}"}</code> anywhere to insert the creator&apos;s name.
              </Muted>
            </div>

            <div className="upf-divider" style={{ margin: "16px 0 12px" }} />

            <div className="upf-form-grid" style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
              <Field label="Callout title">
                <input
                  className="upf-input"
                  value={p.notesTitle}
                  onChange={(e) => patch({ notesTitle: e.target.value })}
                />
              </Field>
              <Field label="Callout text (optional)">
                <textarea
                  className="upf-input"
                  rows={3}
                  value={p.notes}
                  onChange={(e) => patch({ notes: e.target.value })}
                  placeholder="e.g. Clipping is not included. {creator} will provide stream markers or VOD timestamps…"
                />
              </Field>
            </div>
          </Step>
        </div>

        {/* --- Preview --------------------------------------------------- */}
        <aside className="upf-proposal-preview" aria-label="PDF preview">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 10,
            }}
          >
            <span className="upf-label">Preview</span>
            <span style={{ fontSize: 12, color: pages > 2 ? "var(--ta)" : "var(--t35)" }}>
              US Letter · {pages} page{pages === 1 ? "" : "s"}
              {pages > 2 ? " (scope runs past page 1)" : ""}
            </span>
            <button
              type="button"
              className="upf-btn"
              style={{ marginLeft: "auto" }}
              onClick={download}
            >
              ↓ Download PDF
            </button>
          </div>
          <ScaledPreview onPages={setPages}>
            <ProposalDocument p={p} />
          </ScaledPreview>
        </aside>
      </div>

      {/* Full-size copy for the print dialog; invisible on screen. */}
      {mounted
        ? createPortal(
            <div id="upf-print-root">
              <ProposalDocument p={p} />
            </div>,
            document.body
          )
        : null}
    </>
  );
}

/* --- Building blocks ------------------------------------------------------ */

/** Where this proposal stands against the database, in one short line. */
function SaveState({
  savedId,
  dirty,
  saving,
  leadName,
}: {
  savedId: string | null;
  dirty: boolean;
  saving: boolean;
  leadName: string | null;
}) {
  const where = leadName ? `on ${leadName}'s profile` : "(no lead)";
  const [text, color] = saving
    ? ["Saving…", "var(--t36)"]
    : !savedId
      ? ["Not saved yet", "var(--t34)"]
      : dirty
        ? ["Unsaved changes", "var(--ta)"]
        : [`Saved ${where}`, "var(--tg)"];
  return (
    <span style={{ fontSize: 12, color, whiteSpace: "nowrap" }} role="status">
      {text}
    </span>
  );
}

function Step({
  id,
  n,
  title,
  hint,
  aside,
  children,
}: {
  id: string;
  n: number;
  title: string;
  hint?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="upf-card" style={{ scrollMarginTop: 16 }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "13px 16px",
          borderBottom: "1px solid var(--t16)",
        }}
      >
        <span
          aria-hidden
          className="upf-display"
          style={{
            width: 26,
            height: 26,
            flex: "0 0 auto",
            borderRadius: 8,
            display: "grid",
            placeItems: "center",
            fontSize: 13,
            fontWeight: 700,
            color: "var(--accent-ink)",
            background: "var(--ta)",
          }}
        >
          {n}
        </span>
        <div style={{ minWidth: 0 }}>
          <h2 className="upf-display" style={{ fontSize: 14.5, fontWeight: 600, margin: 0 }}>
            <span className="upf-label" style={{ marginRight: 6 }}>
              Step {n}
            </span>
            {title}
          </h2>
          {hint ? (
            <div style={{ fontSize: 12, color: "var(--t35)", marginTop: 2 }}>{hint}</div>
          ) : null}
        </div>
        {aside ? <div style={{ marginLeft: "auto" }}>{aside}</div> : null}
      </header>
      <div style={{ padding: 16 }}>{children}</div>
    </section>
  );
}

function Field({
  label,
  required,
  children,
  style,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0, ...style }}>
      <span className="upf-label">
        {label}
        {required ? <span style={{ color: "var(--ta)" }}> *</span> : null}
      </span>
      {children}
    </label>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 12.5, color: "var(--t35)" }}>{children}</div>;
}

function MoneyInput({
  value,
  placeholder,
  onChange,
  ariaLabel,
}: {
  value: number | null;
  placeholder?: string;
  onChange: (cents: number | null) => void;
  ariaLabel?: string;
}) {
  return (
    <div style={{ position: "relative" }}>
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: 10,
          top: "50%",
          transform: "translateY(-50%)",
          fontSize: 13,
          color: "var(--t34)",
        }}
      >
        $
      </span>
      <input
        className="upf-input"
        style={{ paddingLeft: 22 }}
        type="number"
        min={0}
        step="1"
        inputMode="decimal"
        aria-label={ariaLabel}
        value={value === null ? "" : value / 100}
        placeholder={placeholder?.replace(/^\$/, "")}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") return onChange(null);
          const n = Number.parseFloat(raw);
          onChange(Number.isFinite(n) ? Math.max(0, Math.round(n * 100)) : null);
        }}
      />
    </div>
  );
}

function priceLabel(cents: number, unit: string): string {
  return `${usd(cents)} / ${unit === "month" ? "mo" : unit}`;
}

/**
 * One catalog service in step 3. Ticking it adds a line; once ticked, the
 * quantity sits right here so a scope can be built without leaving the list.
 */
function ServiceRow({
  s,
  line,
  onChange,
  onQty,
}: {
  s: Service;
  line?: Line;
  onChange: (on: boolean) => void;
  onQty: (qty: number) => void;
}) {
  const checked = !!line;
  return (
    <div
      className="upf-table-row"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 11,
        padding: "9px 11px",
        borderRadius: 10,
        background: checked ? "var(--t14)" : "transparent",
        border: `1px solid ${checked ? "var(--t25)" : "var(--t16)"}`,
      }}
    >
      <label style={{ display: "flex", alignItems: "flex-start", gap: 11, flex: 1, minWidth: 0, cursor: "pointer" }}>
        <input
          type="checkbox"
          className="upf-checkbox"
          style={{ marginTop: 2 }}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: checked ? "var(--t40)" : "var(--t39)" }}>
            {s.name}
          </div>
          <div style={{ fontSize: 12, color: "var(--t35)", marginTop: 1 }}>
            {s.description}
            <span style={{ color: "var(--t33)" }}> · {s.turnaround}</span>
          </div>
        </div>
      </label>
      {line ? <QtyStepper value={line.qty} unit={line.unit} onChange={onQty} /> : null}
      <div style={{ textAlign: "right", flex: "0 0 auto", minWidth: 96 }}>
        <div className="upf-display" style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ta)" }}>
          {line && line.qty > 1 ? usd(lineTotal(line)) : priceLabel(s.priceCents, s.unit)}
        </div>
        {line && line.qty > 1 ? (
          <div style={{ fontSize: 11, color: "var(--t35)" }}>
            {line.qty} × {usd(unitPrice(line))}
            {line.billing === "monthly" ? " / mo" : ""}
          </div>
        ) : (
          <MarginChip price={s.priceCents} cost={s.costCents} />
        )}
      </div>
    </div>
  );
}

function QtyStepper({
  value,
  unit,
  onChange,
}: {
  value: number;
  unit: string;
  onChange: (qty: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const set = (n: number) => onChange(Math.max(1, Math.min(999, Math.round(n) || 1)));
  const btn = {
    width: 26,
    height: 30,
    border: "1px solid var(--t21)",
    background: "var(--t6)",
    color: "var(--t39)",
    fontSize: 14,
    lineHeight: 1,
  } as const;

  return (
    <div style={{ display: "flex", alignItems: "center", flex: "0 0 auto" }} role="group" aria-label={`Quantity (${unit})`}>
      <button type="button" aria-label="Fewer" style={{ ...btn, borderRadius: "8px 0 0 8px" }} onClick={() => set(value - 1)}>
        −
      </button>
      <input
        className="upf-input"
        style={{ width: 52, height: 30, borderRadius: 0, textAlign: "center", padding: 0 }}
        type="number"
        min={1}
        inputMode="numeric"
        aria-label={`Quantity of ${unit}s`}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number.parseInt(e.target.value, 10);
          if (n > 0) set(n);
        }}
        onBlur={() => setDraft(String(value))}
      />
      <button type="button" aria-label="More" style={{ ...btn, borderRadius: "0 8px 8px 0" }} onClick={() => set(value + 1)}>
        +
      </button>
    </div>
  );
}

function LineEditor({
  line,
  current,
  roundTo,
  onChange,
  onRemove,
}: {
  line: Line;
  /** The service as the catalog has it now, to spot a default changed since. */
  current?: Service;
  /** Rounding for prices worked out from a margin, in cents. */
  roundTo: number;
  onChange: (next: Partial<Line>) => void;
  onRemove: () => void;
}) {
  const price = unitPrice(line);
  const cost = line.costCents ?? line.listCostCents;
  const custom = line.serviceId === null;
  // The price field is the line's price before its discount. A custom line
  // has no sheet price to override, so its price is the list.
  const setPrice = (v: number | null) =>
    custom ? onChange({ listCents: v ?? 0, priceCents: null }) : onChange({ priceCents: v });
  const stale =
    current &&
    (current.priceCents !== line.listCents || current.costCents !== line.listCostCents);

  return (
    <div
      style={{
        padding: 12,
        borderRadius: 11,
        background: "var(--t6)",
        border: `1px solid ${line.optional ? "var(--t25)" : "var(--t19)"}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {custom ? (
          <input
            className="upf-input"
            style={{ fontWeight: 600 }}
            value={line.name}
            onChange={(e) => onChange({ name: e.target.value })}
            aria-label="Service name"
          />
        ) : (
          <div style={{ fontWeight: 600, fontSize: 13.5, minWidth: 0, flex: 1 }}>{line.name}</div>
        )}
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${line.name}`}
          className="upf-btn upf-btn-ghost"
          style={{ height: 26, padding: "0 8px" }}
        >
          ✕
        </button>
      </div>

      {/* Lines snapshot the default when added, so a default edited in
          Settings since then is offered here rather than applied silently. */}
      {stale && current ? (
        <div style={{ fontSize: 12, color: "var(--t36)", marginTop: 6 }}>
          Default is now {usd(current.priceCents)}, cost {usd(current.costCents)}.{" "}
          <button
            type="button"
            onClick={() =>
              onChange({ listCents: current.priceCents, listCostCents: current.costCents })
            }
            style={{ background: "none", border: "none", padding: 0, fontSize: 12, color: "var(--ta)" }}
          >
            Use current default
          </button>
        </div>
      ) : null}

      {/* Cost, margin and price are one relationship: price = cost / (1 -
          margin). Type any of price or margin and the other follows; change
          the cost and the price holds while the margin moves. */}
      <div className="upf-line-grid" style={{ marginTop: 10 }}>
        <Field label="Qty">
          <input
            className="upf-input"
            type="number"
            min={1}
            value={line.qty}
            onChange={(e) => onChange({ qty: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
          />
        </Field>
        <Field label="Billing">
          <select
            className="upf-input"
            value={line.billing}
            onChange={(e) => onChange({ billing: e.target.value as Billing })}
          >
            <option value="monthly">Monthly</option>
            <option value="one-time">One-time</option>
          </select>
        </Field>
        <Field label={custom ? "Cost / unit" : `Cost / unit (${usd(line.listCostCents)})`}>
          <MoneyInput
            value={custom ? (line.costCents ?? line.listCostCents) : line.costCents}
            placeholder={usd(line.listCostCents)}
            onChange={(v) =>
              custom ? onChange({ listCostCents: v ?? 0, costCents: null }) : onChange({ costCents: v })
            }
          />
        </Field>
        <Field label="Margin">
          <MarginInput
            priceCents={price}
            costCents={cost}
            roundTo={roundTo}
            height={38}
            label={`Margin for ${line.name}`}
            onPrice={(v) => onChange(chargeAt(line, v))}
          />
        </Field>
        <Field label={custom ? "Price / unit" : `Price / unit (${usd(line.listCents)})`}>
          <MoneyInput
            value={custom ? (line.priceCents ?? line.listCents) : line.priceCents}
            placeholder={usd(line.listCents)}
            onChange={setPrice}
          />
        </Field>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
          marginTop: 10,
          fontSize: 12.5,
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <input
            type="checkbox"
            className="upf-checkbox"
            checked={line.optional}
            onChange={(e) => onChange({ optional: e.target.checked })}
          />
          Recommended add-on
        </label>
        {basePrice(line) > 0 ? (
          <DiscountControl
            baseCents={basePrice(line)}
            discountPct={discountOf(line)}
            costCents={cost}
            onDiscount={(pct) => onChange({ discountPct: pct || undefined })}
          />
        ) : null}
        <span style={{ marginLeft: "auto", color: "var(--t36)" }}>
          {line.unit !== "month" ? `${line.qty} ${line.qty === 1 ? line.unit : `${line.unit}s`} · ` : ""}
          Line total{" "}
          <b className="upf-display" style={{ color: "var(--t40)" }}>
            {usd(lineTotal(line))}
            {line.billing === "monthly" ? " / mo" : ""}
          </b>
          <span style={{ color: "var(--t33)" }}> · cost {usd(lineCost(line))}</span>
        </span>
      </div>

      <details className="upf-collapse" style={{ marginTop: 8 }} open={custom && !line.description}>
        <summary style={{ fontSize: 12, color: "var(--t36)", cursor: "pointer", padding: "2px 0" }}>
          <span className="upf-collapse-marker" style={{ display: "inline-block", marginRight: 6, transition: "transform .16s" }}>
            ›
          </span>
          Edit wording on the PDF
        </summary>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          <Field label="Description">
            <textarea
              className="upf-input"
              rows={2}
              value={line.description}
              onChange={(e) => onChange({ description: e.target.value })}
            />
          </Field>
          <div className="upf-form-grid upf-form-grid-3">
            <Field label="Deliverables">
              <input
                className="upf-input"
                value={line.deliverables}
                onChange={(e) => onChange({ deliverables: e.target.value })}
              />
            </Field>
            <Field label="Turnaround">
              <input
                className="upf-input"
                value={line.turnaround}
                onChange={(e) => onChange({ turnaround: e.target.value })}
              />
            </Field>
            <Field label="Unit">
              <input
                className="upf-input"
                value={line.unit}
                onChange={(e) => onChange({ unit: e.target.value })}
                placeholder="video"
              />
            </Field>
          </div>
        </div>
      </details>
    </div>
  );
}

/** Given away: a 100% discount, or a price typed as 0. */
function isFree(l: Line): boolean {
  return discountOf(l) >= 100 || l.priceCents === 0;
}

/**
 * Sets a line so it charges `effective` per unit after its own discount. A
 * custom line has no sheet price to override, so its price is the list.
 */
function chargeAt(l: Line, effective: number): Line {
  const base = baseForEffective(l, effective);
  return l.serviceId === null ? { ...l, listCents: base, priceCents: null } : { ...l, priceCents: base };
}

const DISCOUNT_PRESETS = [10, 15, 25, 50];

/**
 * A per-line discount off the line's own price - whatever that price is now,
 * sheet or overridden. Stored as a percentage beside the price rather than
 * baked into it, so changing the price later keeps the same "25% off". The
 * PDF prints the pre-discount price struck through, "25% off" under it, or
 * "Included free" at 100%.
 */
function DiscountControl({
  baseCents,
  discountPct,
  costCents,
  onDiscount,
}: {
  baseCents: number;
  discountPct: number;
  costCents: number;
  onDiscount: (pct: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const pct = discountPct;
  const priceCents = Math.round(baseCents * (1 - pct / 100));

  const apply = (off: number) => onDiscount(Math.min(100, Math.max(0, Math.round(off * 10) / 10)));

  const link = { background: "none", border: "none", padding: 0, fontSize: 12.5, color: "var(--ta)" } as const;
  const margin = marginOf(priceCents, costCents);

  if (!open) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        {pct > 0 ? (
          <span
            className="upf-pill"
            style={{ color: "var(--ta)", background: "var(--t14)", borderColor: "var(--t25)", fontSize: 11.5 }}
          >
            {pct >= 100 ? "Free" : `${pct}% off`}
          </span>
        ) : null}
        <button type="button" style={link} onClick={() => setOpen(true)}>
          {pct > 0 ? "Change discount" : "Offer a discount"}
        </button>
        {pct > 0 ? (
          <button type="button" style={{ ...link, color: "var(--t36)" }} onClick={() => onDiscount(0)}>
            Remove
          </button>
        ) : null}
      </span>
    );
  }

  return (
    <span
      role="group"
      aria-label="Discount"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        flexWrap: "wrap",
        padding: "5px 8px",
        borderRadius: 9,
        background: "var(--t2)",
        border: "1px solid var(--t21)",
      }}
    >
      <span className="upf-label">Discount</span>
      {[...DISCOUNT_PRESETS, 100].map((off) => {
        const on = Math.abs(pct - off) < 0.05;
        return (
          <button
            key={off}
            type="button"
            className="upf-pill"
            aria-pressed={on}
            onClick={() => apply(off)}
            style={{
              fontSize: 11.5,
              padding: "2px 8px",
              color: on ? "var(--accent-ink)" : "var(--t39)",
              background: on ? "var(--ta)" : "var(--t6)",
              borderColor: on ? "var(--ta)" : "var(--t21)",
            }}
          >
            {off === 100 ? "Free" : `${off}%`}
          </button>
        );
      })}
      <span style={{ position: "relative" }}>
        <input
          className="upf-input"
          style={{ width: 84, height: 26, fontSize: 12, paddingRight: 20 }}
          type="number"
          min={0}
          max={100}
          step="1"
          placeholder="Other"
          aria-label="Custom discount percent"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && custom !== "") {
              apply(Number.parseFloat(custom) || 0);
              setCustom("");
            }
          }}
          onBlur={() => {
            if (custom !== "") apply(Number.parseFloat(custom) || 0);
            setCustom("");
          }}
        />
        <span aria-hidden style={{ position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)", fontSize: 11.5, color: "var(--t34)" }}>
          %
        </span>
      </span>
      <span style={{ fontSize: 11.5, color: "var(--t35)" }}>
        {pct > 0 ? (
          <>
            {usd(baseCents)} → <b style={{ color: "var(--t40)" }}>{usd(priceCents)}</b> ·{" "}
            <span style={{ color: marginTone(margin) }}>
              {margin === null ? "no" : `${Math.round(margin)}%`} margin
            </span>
          </>
        ) : (
          `Price ${usd(baseCents)}`
        )}
      </span>
      {pct > 0 ? (
        <button type="button" style={{ ...link, color: "var(--t36)", fontSize: 11.5 }} onClick={() => onDiscount(0)}>
          Remove
        </button>
      ) : null}
      <button type="button" style={{ ...link, fontSize: 11.5 }} onClick={() => setOpen(false)}>
        Done
      </button>
    </span>
  );
}

const ROUNDING: [number, string][] = [
  [1, "Exact cents"],
  [100, "Nearest $1"],
  [500, "Nearest $5"],
  [1000, "Nearest $10"],
  [2500, "Nearest $25"],
];

/**
 * Proposal-wide pricing: price everything to a target margin, or name the
 * total and see the margin it leaves. Both show the result before anything
 * changes, so the numbers can be tried without committing to them.
 */
function PricingTools({
  p,
  t,
  sheetTotal,
  onPatch,
  onApplyMargin,
  onSpread,
}: {
  p: Proposal;
  t: ReturnType<typeof totals>;
  sheetTotal: (subtotal: number) => number;
  onPatch: (next: Partial<Proposal>) => void;
  onApplyMargin: (marginPct: number) => void;
  onSpread: (billing: Billing) => void;
}) {
  const [target, setTarget] = useState("50");
  const targetPct = Number.parseFloat(target);
  const validTarget = Number.isFinite(targetPct) && targetPct > 0 && targetPct < 100;

  // What the core totals would be at the target margin, before applying it.
  const preview = useMemo(() => {
    if (!validTarget) return null;
    const out = { monthly: 0, oneTime: 0, cost: 0 };
    for (const l of p.lines) {
      if (l.optional) continue;
      const cost = l.costCents ?? l.listCostCents;
      const free = isFree(l);
      const price = free ? 0 : priceForMargin(cost, targetPct, p.roundToCents) ?? unitPrice(l);
      const total = price * l.qty;
      if (l.billing === "monthly") out.monthly += total;
      else out.oneTime += total;
      out.cost += cost * l.qty;
    }
    const revenue = out.monthly + out.oneTime;
    return { ...out, margin: marginOf(revenue, out.cost) };
  }, [p.lines, p.roundToCents, targetPct, validTarget]);

  const hasMonthly = p.lines.some((l) => !l.optional && l.billing === "monthly");
  const hasOneTime = p.lines.some((l) => !l.optional && l.billing === "one-time");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div className="upf-label" style={{ marginBottom: 8 }}>
          Price to a target margin
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <Field label="Target margin" style={{ width: 120 }}>
            <div style={{ position: "relative" }}>
              <input
                className="upf-input"
                style={{ paddingRight: 22 }}
                type="number"
                min={1}
                max={99}
                step="1"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
              <span aria-hidden style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", fontSize: 12.5, color: "var(--t34)" }}>
                %
              </span>
            </div>
          </Field>
          <Field label="Round prices" style={{ width: 150 }}>
            <select
              className="upf-input"
              value={p.roundToCents}
              onChange={(e) => onPatch({ roundToCents: Number(e.target.value) })}
            >
              {ROUNDING.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <button
            type="button"
            className="upf-btn"
            style={{ height: 38 }}
            disabled={!validTarget || !p.lines.length}
            onClick={() => onApplyMargin(targetPct)}
          >
            Apply to all lines
          </button>
        </div>
        <div style={{ fontSize: 12, color: "var(--t35)", marginTop: 7 }}>
          {!p.lines.length ? (
            "Add services to see what a margin works out to."
          ) : preview ? (
            <>
              At {targetPct}%:{" "}
              <b style={{ color: "var(--t40)" }}>
                {[
                  hasMonthly ? `${usd(preview.monthly)} / mo` : "",
                  hasOneTime ? `${usd(preview.oneTime)} one-time` : "",
                ]
                  .filter(Boolean)
                  .join(" + ")}
              </b>{" "}
              (currently{" "}
              {t.marginPct === null ? "-" : `${Math.round(t.marginPct)}%`} at{" "}
              {[hasMonthly ? `${usd(t.monthly.total)} / mo` : "", hasOneTime ? `${usd(t.oneTime.total)}` : ""]
                .filter(Boolean)
                .join(" + ")}
              ). Rounding is always up, so no line lands under the target. Lines with no editor cost keep
              their price.
            </>
          ) : (
            "Enter a margin between 1 and 99%."
          )}
        </div>
      </div>

      <div>
        <div className="upf-label" style={{ marginBottom: 8 }}>
          Or name the total
        </div>
        <div className="upf-form-grid upf-form-grid-3">
          {(
            [
              ["monthly", "Target monthly total", p.monthlyOverrideCents, t.monthly, "monthlyOverrideCents"],
              ["one-time", "Target one-time total", p.oneTimeOverrideCents, t.oneTime, "oneTimeOverrideCents"],
            ] as const
          ).map(([billing, label, value, bucket, key]) => {
            const implied = value !== null ? marginOf(value, bucket.cost) : null;
            return (
              <Field key={billing} label={label}>
                <MoneyInput
                  value={value}
                  placeholder={usd(sheetTotal(bucket.subtotal))}
                  onChange={(v) => onPatch({ [key]: v } as Partial<Proposal>)}
                />
                {value !== null ? (
                  <span style={{ fontSize: 11.5, color: "var(--t35)" }}>
                    <b style={{ color: marginTone(implied) }}>
                      {implied === null ? "-" : `${Math.round(implied)}%`} margin
                    </b>{" "}
                    on {usd(bucket.cost)} cost ·{" "}
                    <button
                      type="button"
                      onClick={() => onSpread(billing)}
                      style={{ background: "none", border: "none", padding: 0, fontSize: 11.5, color: "var(--ta)" }}
                      title="Scale the line prices so they add up to this total"
                    >
                      Spread across lines
                    </button>
                  </span>
                ) : null}
              </Field>
            );
          })}
          <Field label="Discount %">
            <input
              className="upf-input"
              type="number"
              min={0}
              max={100}
              step={1}
              value={p.discountPct || ""}
              placeholder="0"
              onChange={(e) => onPatch({ discountPct: Number(e.target.value) || 0 })}
            />
          </Field>
        </div>
        <div style={{ fontSize: 12, color: "var(--t35)", marginTop: 7 }}>
          A target total prints as the proposal total, with a &quot;Partnership pricing&quot; row
          reconciling it to the lines. Spread it across lines to reprice the lines instead.
        </div>
      </div>
    </div>
  );
}

function InternalSummary({ t }: { t: ReturnType<typeof totals> }) {
  const cells: { label: string; value: string; tone?: string }[] = [
    { label: "Monthly", value: `${usd(t.monthly.total)}` },
    { label: "One-time", value: usd(t.oneTime.total) },
    { label: "Editor cost", value: usd(t.cost) },
    {
      label: "Gross margin",
      value: t.marginPct === null ? "-" : `${Math.round(t.marginPct)}%`,
      tone:
        t.marginPct === null
          ? undefined
          : t.marginPct >= 45
            ? "var(--tg)"
            : t.marginPct >= 30
              ? "var(--ta)"
              : "var(--terr)",
    },
  ];
  return (
    <div
      style={{
        marginTop: 14,
        padding: "12px 14px",
        borderRadius: 11,
        background: "var(--t2)",
        border: "1px dashed var(--t22)",
      }}
    >
      <div className="upf-label" style={{ marginBottom: 8 }}>
        Internal only · not on the PDF
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 10 }}>
        {cells.map((c) => (
          <div key={c.label}>
            <div style={{ fontSize: 11.5, color: "var(--t35)" }}>{c.label}</div>
            <div className="upf-display" style={{ fontSize: 16, fontWeight: 600, color: c.tone ?? "var(--t40)" }}>
              {c.value}
            </div>
          </div>
        ))}
      </div>
      {t.addons.monthly + t.addons.oneTime > 0 ? (
        <div style={{ fontSize: 12, color: "var(--t35)", marginTop: 8 }}>
          Plus recommended add-ons: {usd(t.addons.monthly)} / mo, {usd(t.addons.oneTime)} one-time
          (cost {usd(t.addons.cost)})
        </div>
      ) : null}
    </div>
  );
}

function TermEditor({
  term,
  onChange,
  onRemove,
}: {
  term: Term;
  onChange: (next: Partial<Term>) => void;
  onRemove: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: 10,
        borderRadius: 10,
        background: "var(--t6)",
        border: "1px solid var(--t19)",
      }}
    >
      <div style={{ display: "flex", gap: 8 }}>
        <input
          className="upf-input"
          style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em", fontSize: 12.5 }}
          value={term.title}
          placeholder="Term title"
          onChange={(e) => onChange({ title: e.target.value })}
          aria-label="Term title"
        />
        <button
          type="button"
          className="upf-btn upf-btn-ghost"
          style={{ height: 38 }}
          onClick={onRemove}
          aria-label={`Remove ${term.title || "term"}`}
        >
          ✕
        </button>
      </div>
      <textarea
        className="upf-input"
        rows={2}
        value={term.body}
        placeholder="Term text"
        onChange={(e) => onChange({ body: e.target.value })}
        aria-label={`${term.title || "Term"} text`}
      />
    </div>
  );
}

function LogoField({
  value,
  onChange,
  onTooBig,
}: {
  value: string;
  onChange: (dataUrl: string) => void;
  onTooBig: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
      <span className="upf-label" style={{ flex: "0 0 auto" }}>
        Creator logo
      </span>
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element -- local data URL
        <img
          src={value}
          alt=""
          style={{ height: 32, maxWidth: 80, objectFit: "contain", borderRadius: 6, background: "#0D0D0D" }}
        />
      ) : null}
      <button type="button" className="upf-btn upf-btn-ghost" onClick={() => input.current?.click()}>
        {value ? "Replace" : "Upload"}
      </button>
      {value ? (
        <button type="button" className="upf-btn upf-btn-ghost" onClick={() => onChange("")}>
          Remove
        </button>
      ) : null}
      <span style={{ fontSize: 11.5, color: "var(--t34)" }}>Optional · shows beside the UpForce logo</span>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          if (file.size > 1.5 * 1024 * 1024) return onTooBig();
          const reader = new FileReader();
          reader.onload = () => typeof reader.result === "string" && onChange(reader.result);
          reader.readAsDataURL(file);
        }}
      />
    </div>
  );
}

/**
 * Shows the letter-size document at whatever width the column allows.
 *
 * CSS zoom rather than transform: zoom scales layout too, so the wrapper
 * takes the document's real scaled height and nothing below it overlaps.
 */
function ScaledPreview({
  children,
  onPages,
}: {
  children: ReactNode;
  /** Reports how many printed Letter pages the document will take. */
  onPages?: (pages: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(0.6);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      if (el.clientWidth > 0) setZoom(Math.min(1, el.clientWidth / 816));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Runs after every render: the page count follows each edit.
  useEffect(() => {
    // A hidden or collapsed column measures zero wide: nothing to count then.
    if (!onPages || !ref.current || !(zoom > 0)) return;
    const pages = countPrintedPages(ref.current, zoom);
    if (Number.isFinite(pages)) onPages(pages);
  });

  return (
    <div ref={ref} style={{ width: "100%" }}>
      <div style={{ zoom }}>{children}</div>
    </div>
  );
}

/** Letter less the 0.42in top and bottom print margins, in CSS px. */
const PRINTABLE_HEIGHT = (11 - 0.84) * 96;

/**
 * Each sheet prints as at least one page and spills onto more when its
 * content is taller than the printable area. A sheet's own height says
 * nothing - it is stretched to a full page so a footer sits at the bottom -
 * so this measures the content itself, without the stretch before the footer.
 */
function countPrintedPages(root: HTMLElement, zoom: number): number {
  let pages = 0;
  root.querySelectorAll<HTMLElement>(".pdoc-sheet").forEach((sheet) => {
    const first = sheet.firstElementChild;
    const foot = sheet.querySelector<HTMLElement>(".pdoc-foot");
    const last = foot ? foot.previousElementSibling : sheet.lastElementChild;
    if (!first || !last) return void (pages += 1);
    let natural = (last.getBoundingClientRect().bottom - first.getBoundingClientRect().top) / zoom;
    if (foot) natural += (foot.firstElementChild?.getBoundingClientRect().height ?? 0) / zoom + 14;
    pages += Math.max(1, Math.ceil((natural - 2) / PRINTABLE_HEIGHT));
  });
  return pages;
}
