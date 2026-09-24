/* eslint-disable @next/next/no-img-element -- printed page: plain <img> so the
   logos are in the DOM, unoptimised, the moment the print dialog opens. */
import { Lato } from "next/font/google";

import { CATEGORIES } from "@/lib/catalog";
import {
  addDays,
  discountOf,
  fillCreator,
  formatDate,
  lineValueTotal,
  lineTotal,
  totals,
  unitPrice,
  usd,
  wasUnitPrice,
  type Line,
  type Proposal,
  type Totals,
} from "@/lib/proposal";

import "./proposal.css";

/* Lato is the face the signed PatrckStatic agreement is set in. */
const lato = Lato({
  subsets: ["latin"],
  weight: ["400", "700", "900"],
  variable: "--font-proposal",
  display: "swap",
});

/**
 * The client-facing proposal: page one is the offer, page two the terms.
 *
 * Pure render of a Proposal. The builder shows it scaled in the preview pane
 * and portals a second, full-size copy to <body> for printing, so what is
 * previewed is exactly what lands in the PDF.
 */
export function ProposalDocument({ p }: { p: Proposal }) {
  const t = totals(p);
  const creator = p.creator.name.trim() || "Creator";
  const fill = (s: string) => fillCreator(s, creator);

  const core = p.lines.filter((l) => !l.optional);
  const addons = p.lines.filter((l) => l.optional);
  const free = core.filter((l) => unitPrice(l) === 0 && freeValue(l) > 0);

  const hasMonthly = core.some((l) => l.billing === "monthly") || t.monthly.overridden;
  const hasOneTime = core.some((l) => l.billing === "one-time") || t.oneTime.overridden;

  const coreValue = t.monthly.list + t.oneTime.list;
  const coreCharged = t.monthly.total + t.oneTime.total;
  const savings = coreValue - coreCharged;

  const Header = ({ subtitle }: { subtitle: string }) => (
    <header className="pdoc-band">
      <div style={{ minWidth: 0 }}>
        <div className="pdoc-kicker">
          UpForce<span className="x">x</span>
          {creator}
        </div>
        <h1 className="pdoc-title">{p.title || "Content Proposal"}</h1>
        {subtitle ? <p className="pdoc-sub">{subtitle}</p> : null}
      </div>
      <div className="pdoc-logos">
        <img className="pdoc-logo-up" src="/upforce-logo.png" alt="UpForce Marketing" />
        {p.creator.logo ? (
          <>
            <span className="pdoc-logo-x">x</span>
            <img className="pdoc-logo-client" src={p.creator.logo} alt={creator} />
          </>
        ) : null}
      </div>
    </header>
  );

  const Footer = () => (
    <footer className="pdoc-foot">
      <div className="pdoc-foot-inner">
        <span>UpForce Marketing</span>
        <span>
          Proposal for {creator} · Terms + acceptance
        </span>
      </div>
    </footer>
  );

  const subtitle = p.subtitle.trim()
    ? fill(p.subtitle)
    : p.category
      ? `${CATEGORIES[p.category].label} content services, prepared for ${creator}.`
      : `Prepared for ${creator}.`;
  const longIntro = fill(p.intro.trim());

  return (
    <div className={`pdoc ${lato.variable}`}>
      {/* --- Page 1: the offer ------------------------------------------- */}
      <section className="pdoc-sheet">
        <Header subtitle={subtitle} />

        <dl className="pdoc-meta" style={{ margin: 0 }}>
          <div>
            <dt>Prepared for</dt>
            <dd>
              {p.creator.contactName || creator}
              {p.creator.handle || p.creator.platform ? (
                <small>
                  {[p.creator.handle, p.creator.platform].filter(Boolean).join(" · ")}
                </small>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>Category</dt>
            <dd>
              {p.category ? CATEGORIES[p.category].label : "-"}
              {p.creator.audience ? <small>{p.creator.audience}</small> : null}
            </dd>
          </div>
          <div>
            <dt>Date</dt>
            <dd>{formatDate(p.date)}</dd>
          </div>
          <div>
            <dt>Valid until</dt>
            <dd>{formatDate(addDays(p.date, p.validDays))}</dd>
          </div>
        </dl>

        {longIntro ? <p className="pdoc-intro">{longIntro}</p> : null}

        {core.length ? (
          <div className="pdoc-invest">
            <div className="pdoc-invest-main">
              {hasMonthly ? (
                <div>
                  <div className="pdoc-label">Monthly investment</div>
                  <div className="pdoc-amount">
                    {usd(t.monthly.total)}
                    <small>PER MONTH</small>
                  </div>
                  <BucketNote b={t.monthly} pct={p.discountPct} suffix=" / month" />
                </div>
              ) : null}
              {hasOneTime ? (
                <div>
                  <div className="pdoc-label">{hasMonthly ? "One-time" : "Project investment"}</div>
                  <div className="pdoc-amount">
                    {usd(t.oneTime.total)}
                    <small>{hasMonthly ? "ONE-TIME" : "TOTAL"}</small>
                  </div>
                  <BucketNote b={t.oneTime} pct={p.discountPct} suffix="" />
                </div>
              ) : null}
            </div>
            {free.length || savings > 0 || addons.length ? (
              <div className="pdoc-invest-side">
                {free.slice(0, 2).map((l) => (
                  <div key={l.key} className="pdoc-perk">
                    <b>Free {l.name}</b>
                    <span>
                      {usd(freeValue(l))} {l.billing === "monthly" ? "monthly " : ""}value
                    </span>
                  </div>
                ))}
                {!free.length && savings > 0 ? (
                  <div className="pdoc-perk">
                    <b>You save {usd(savings)}</b>
                    <span>{Math.round((savings / coreValue) * 100)}% off</span>
                  </div>
                ) : null}
                {addons.length ? (
                  <div className="pdoc-perk">
                    <b>With recommended add-on{addons.length > 1 ? "s" : ""}</b>
                    <span>
                      {[
                        hasMonthly || t.addons.monthly
                          ? `${usd(t.monthly.total + t.addons.monthly)} / mo`
                          : "",
                        hasOneTime || t.addons.oneTime ? usd(t.oneTime.total + t.addons.oneTime) : "",
                      ]
                        .filter(Boolean)
                        .join(" + ")}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <h2 className="pdoc-h2">
          <span className="pdoc-label">What&apos;s included</span>
          Scope of work
        </h2>

        {core.length === 0 ? (
          <div className="pdoc-empty">Select services in step 3 and they will appear here.</div>
        ) : null}

        {core.length ? (
          <div className={`pdoc-scope${p.showLinePrices ? "" : " no-prices"}`}>
            {core.map((l) => (
              <ScopeRow key={l.key} line={l} showPrice={p.showLinePrices} />
            ))}
          </div>
        ) : null}

        {addons.length ? (
          <div className="pdoc-addons">
            <h2 className="pdoc-h2" style={{ fontSize: 12, marginTop: 20 }}>
              <span className="pdoc-label" style={{ marginBottom: 0 }}>
                Highly recommended add-on{addons.length > 1 ? "s" : ""}
              </span>
            </h2>
            {addons.map((l) => (
              <AddonCard key={l.key} line={l} />
            ))}
          </div>
        ) : null}

        {/* No footer on the offer page. It is pinned to the page bottom, so a
            scope that fills the page pushed it onto a blank page of its own. */}
      </section>

      {/* --- Page 2: terms and acceptance -------------------------------- */}
      <section className="pdoc-sheet">
        <Header subtitle={subtitle} />

        <h2 className="pdoc-h2">
          <span className="pdoc-label">How we work together</span>
          Terms + billing
        </h2>

        <dl className="pdoc-terms" style={{ margin: 0 }}>
          {p.terms
            .filter((term) => term.title.trim() || term.body.trim())
            .map((term) => (
              <div key={term.key} className="pdoc-term">
                <dt>{term.title}</dt>
                <dd>{fill(term.body)}</dd>
              </div>
            ))}
        </dl>

        {p.notes.trim() ? (
          <div className="pdoc-note">
            <div className="pdoc-label">{p.notesTitle || "Notes"}</div>
            <p>{fill(p.notes)}</p>
          </div>
        ) : null}

        <h2 className="pdoc-h2" style={{ marginTop: 26 }}>
          Acceptance
        </h2>
        <div className="pdoc-accept">
          By signing below, both parties acknowledge and accept the scope, pricing, billing terms and other
          terms contained in this proposal.
        </div>

        <div className="pdoc-sign">
          <div>
            <div className="pdoc-sign-line">
              <b>{creator} / Creator</b>
              <span>Signature / Date</span>
            </div>
            <div className="pdoc-sign-line">
              <b>&nbsp;</b>
              <span>Printed name / Title</span>
            </div>
          </div>
          <div>
            <div className="pdoc-sign-line">
              <b>UpForce representative</b>
              <span>Signature / Date</span>
            </div>
            <div className="pdoc-sign-line">
              <b>{p.preparedBy.trim() || " "}</b>
              <span>Printed name / Title</span>
            </div>
          </div>
        </div>

        <Footer />
      </section>
    </div>
  );
}

/**
 * The small line under a price. A monthly line with a per-unit quantity (12
 * videos a month) needs both facts: what one unit costs, and that it recurs.
 */
function priceNote(line: Line, price: number): string {
  const monthly = line.billing === "monthly";
  if (line.unit === "month")
    return line.qty > 1 ? `${usd(price)} / month` : monthly ? "per month" : "one-time";
  if (line.qty > 1) return `${usd(price)} / ${line.unit}${monthly ? " · per month" : ""}`;
  return monthly ? "per month" : "one-time";
}

/**
 * The price to strike through above a line's charge, and how much is off it.
 * A line discount strikes the line's own price - the one it was going to
 * charge. With no discount but a price typed under the sheet, the sheet price
 * is what gets struck.
 */
function struck(line: Line): { total: number; off: number } | null {
  const price = unitPrice(line);
  const was = wasUnitPrice(line);
  if (price <= 0 || was <= price) return null;
  const d = discountOf(line);
  return {
    total: lineValueTotal(line),
    off: d > 0 ? Math.round(d * 10) / 10 : Math.round((1 - price / was) * 100),
  };
}

/** What a free line would have cost - the same "before" price as a strike. */
function freeValue(line: Line): number {
  return lineValueTotal(line);
}

function PriceBlock({ line }: { line: Line }) {
  const price = unitPrice(line);
  if (price === 0) {
    const value = freeValue(line);
    return (
      <>
        <b className="free">Included free</b>
        {value > 0 ? <span>{usd(value)} value</span> : null}
      </>
    );
  }
  const was = struck(line);
  return (
    <>
      {was ? <span className="was">{usd(was.total)}</span> : null}
      <b>{usd(lineTotal(line))}</b>
      <span>{priceNote(line, price)}</span>
      {was ? <span className="off">{was.off}% off</span> : null}
    </>
  );
}

function ScopeRow({ line, showPrice }: { line: Line; showPrice: boolean }) {
  const meta = [line.deliverables, line.turnaround ? `${line.turnaround} turnaround` : ""]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="pdoc-row">
      <div className="pdoc-qty">
        <b>{line.qty}</b>
        <span>
          {line.unit === "month"
            ? line.billing === "monthly"
              ? "Monthly"
              : plural("month", line.qty)
            : `${plural(line.unit, line.qty)}${line.billing === "monthly" ? " / mo" : ""}`}
        </span>
      </div>
      <div className="pdoc-what">
        <b>{line.name}</b>
        {/* Description and the deliverables/turnaround detail share a line
            and wrap together: one line saved per service adds up fast. */}
        {line.description || meta ? (
          <p>
            {line.description}
            {line.description && meta ? " " : ""}
            {meta ? <span className="meta">{line.description ? `· ${meta}` : meta}</span> : null}
          </p>
        ) : null}
      </div>
      {showPrice ? (
        <div className="pdoc-price">
          <PriceBlock line={line} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The one line under an investment figure that squares it with the scope
 * table: the discount or partnership pricing that got it there, or else the
 * list value it undercuts. Totals live here rather than in a table at the
 * bottom of the page, which repeated every line and pushed longer scopes
 * onto a page of their own.
 */
function BucketNote({ b, pct, suffix }: { b: Totals["monthly"]; pct: number; suffix: string }) {
  if (b.discount > 0)
    return (
      <div className="pdoc-note-line">
        {usd(b.subtotal)}
        {suffix} less {pct}% partnership discount
      </div>
    );
  if (b.overridden && b.total < b.subtotal)
    return (
      <div className="pdoc-note-line">
        <s>{usd(b.subtotal)}</s>
        {suffix} · partnership pricing
      </div>
    );
  if (b.list > b.total)
    return (
      <div className="pdoc-was">
        {usd(b.list)}
        {suffix} value
      </div>
    );
  return null;
}

function AddonCard({ line }: { line: Line }) {
  const price = unitPrice(line);
  const was = struck(line);
  return (
    <div className="pdoc-addon">
      <div className="pdoc-addon-body">
        <b>
          {line.qty > 1 ? `${line.qty} ` : ""}
          {line.name}
        </b>
        {line.description ? <p>{line.description}</p> : null}
      </div>
      <div className="pdoc-addon-price">
        {was ? <span className="was">{usd(was.total)}</span> : null}
        {was ? <span className="off">{was.off}% OFF</span> : null}
        <span className="big">{price === 0 ? "FREE" : usd(lineTotal(line))}</span>
        <span className="per">{line.billing === "monthly" ? "Per month" : "One-time"}</span>
      </div>
    </div>
  );
}

function plural(unit: string, n: number): string {
  if (n === 1) return unit;
  return unit.endsWith("s") ? unit : `${unit}s`;
}
