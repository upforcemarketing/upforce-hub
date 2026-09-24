"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

import { useHub } from "@/components/HubStore";
import { ALPHA, ink, initials, type DueMeta } from "@/lib/engine";
import { marginOf, priceForMargin } from "@/lib/proposal";
import { STAGES, type StageId } from "@/lib/stages";

/* ---------------------------------------------------------------------------
   The handful of pieces every view rebuilds.

   Each one takes a hue and derives its wash, border and ink from it, so a new
   stage colour or a user-chosen tag colour needs no other change to look
   right in both themes.
   --------------------------------------------------------------------------- */

const AVATAR_SIZES = {
  sm: { box: 32, radius: 10, font: 12.5 },
  md: { box: 34, radius: 11, font: 12 },
  table: { box: 36, radius: 11, font: 12.5 },
  lg: { box: 42, radius: 13, font: 14 },
  xl: { box: 46, radius: 13, font: 17 },
} as const;

export function Avatar({
  name,
  color,
  size = "md",
}: {
  name: string;
  color: string;
  size?: keyof typeof AVATAR_SIZES;
}) {
  const { theme } = useHub();
  const s = AVATAR_SIZES[size];

  return (
    <span
      aria-hidden
      style={{
        width: s.box,
        height: s.box,
        flex: "0 0 auto",
        borderRadius: s.radius,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: s.font,
        fontWeight: 700,
        color: ink(color, theme),
        background: `${color}${ALPHA.avatar}`,
        border: `1px solid ${color}${ALPHA.borderStrong}`,
      }}
    >
      {initials(name)}
    </span>
  );
}

export function StagePill({ stage }: { stage: StageId }) {
  const { theme } = useHub();
  const { color, label } = STAGES[stage];

  return (
    <span
      className="upf-pill"
      style={{
        flex: "0 0 auto",
        color: ink(color, theme),
        background: `${color}${ALPHA.wash}`,
        borderColor: `${color}${ALPHA.border}`,
      }}
    >
      {label}
    </span>
  );
}

export function StageDot({ stage, size = 7 }: { stage: StageId; size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        flex: "0 0 auto",
        borderRadius: "50%",
        background: STAGES[stage].color,
      }}
    />
  );
}

/**
 * The due chip.
 *
 * Overdue and due-today are the only two states that get a filled background -
 * a queue where every row is highlighted highlights nothing.
 */
export function DueChip({ due }: { due: DueMeta }) {
  const { theme } = useHub();
  const style = dueStyle(due, theme);

  return (
    <span
      style={{
        fontSize: 13,
        fontWeight: 700,
        padding: "3px 8px",
        borderRadius: 6,
        display: "inline-block",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {due.text}
    </span>
  );
}

export function dueStyle(
  due: DueMeta,
  theme: "dark" | "light"
): CSSProperties {
  switch (due.tone) {
    case "over":
      return { color: ink("#F2683C", theme), background: "rgba(242,104,60,.12)" };
    case "today":
      return {
        color: theme === "light" ? "#FFFFFF" : "#1A1207",
        background: theme === "light" ? ink("#E9A83B", theme) : "#E9A83B",
      };
    case "soon":
      return { color: ink("#E9A83B", theme), background: "rgba(233,168,59,.12)" };
    case "later":
      return { color: "var(--t37)", background: "transparent" };
    default:
      return { color: "var(--t34)", background: "transparent" };
  }
}

export function dueTextColor(due: DueMeta, theme: "dark" | "light"): string {
  switch (due.tone) {
    case "over":
      return ink("#F2683C", theme);
    case "today":
      return ink("#E9A83B", theme);
    case "soon":
      return ink("#E9A83B", theme);
    case "later":
      return "var(--t37)";
    default:
      return "var(--t34)";
  }
}

export function DueDot({ due }: { due: DueMeta }) {
  const { theme } = useHub();

  return (
    <span
      aria-hidden
      className={due.urgent ? "upf-pulse" : undefined}
      style={{
        width: 5,
        height: 5,
        flex: "0 0 auto",
        borderRadius: "50%",
        background: dueTextColor(due, theme),
      }}
    />
  );
}

export function TagChip({ name, color }: { name: string; color: string }) {
  const { theme } = useHub();

  return (
    <span
      style={{
        fontSize: 11.5,
        fontWeight: 500,
        whiteSpace: "nowrap",
        padding: "2px 7px",
        borderRadius: 5,
        color: ink(color, theme),
        background: `${color}${ALPHA.wash}`,
        border: `1px solid ${color}${ALPHA.border}`,
      }}
    >
      {name}
    </span>
  );
}

/** Renders a lead's tags from ids, skipping any the user has since deleted. */
export function TagChips({ tagIds }: { tagIds: string[] }) {
  const { ws } = useHub();
  if (tagIds.length === 0) return null;

  return (
    <>
      {tagIds.map((id) => {
        const tag = ws.tags.find((t) => t.id === id);
        if (!tag) return null;
        return <TagChip key={id} name={tag.name} color={tag.color} />;
      })}
    </>
  );
}

export function StatCard({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: string;
}) {
  const { theme } = useHub();

  return (
    <div className="upf-card" style={{ padding: "15px 16px" }}>
      <div className="upf-label">{label}</div>
      <div
        className="upf-display"
        style={{
          fontSize: 28,
          fontWeight: 600,
          lineHeight: 1.15,
          marginTop: 6,
          color: tone ? ink(tone, theme) : "var(--t40)",
        }}
      >
        {value}
      </div>
      {note ? (
        <div style={{ fontSize: 12.5, color: "var(--t36)", marginTop: 4 }}>
          {note}
        </div>
      ) : null}
    </div>
  );
}

export function SectionCard({
  title,
  aside,
  children,
  bodyStyle,
}: {
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  bodyStyle?: CSSProperties;
}) {
  return (
    <section className="upf-card" style={{ display: "flex", flexDirection: "column" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "13px 16px",
          borderBottom: "1px solid var(--t16)",
        }}
      >
        <h2
          className="upf-display"
          style={{ fontSize: 14, fontWeight: 600, margin: 0 }}
        >
          {title}
        </h2>
        {aside ? <div style={{ marginLeft: "auto" }}>{aside}</div> : null}
      </header>
      <div style={{ padding: 12, ...bodyStyle }}>{children}</div>
    </section>
  );
}

/**
 * A card that opens and closes.
 *
 * Built on <details>/<summary> rather than a useState toggle: the browser
 * handles the keyboard, the ARIA and find-in-page (Chrome expands a closed
 * section to reveal a match) for free, and it works before hydration.
 *
 * Settings is a page of long lists that are read rarely and edited rarer
 * still. Collapsed by default, the whole taxonomy fits on one screen and you
 * open only the list you came for.
 */
export function CollapsibleCard({
  title,
  count,
  children,
  defaultOpen = false,
}: {
  title: ReactNode;
  /** Shown next to the title, so a closed section still says how big it is. */
  count?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="upf-card upf-collapse" open={defaultOpen}>
      <summary
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "13px 16px",
          cursor: "pointer",
          listStyle: "none",
        }}
      >
        <span
          aria-hidden
          className="upf-collapse-marker"
          style={{
            fontSize: 10,
            color: "var(--t34)",
            transition: "transform .16s ease",
          }}
        >
          ▶
        </span>
        <h2
          className="upf-display"
          style={{ fontSize: 14, fontWeight: 600, margin: 0 }}
        >
          {title}
        </h2>
        {count !== undefined ? (
          <span
            className="upf-mono"
            style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--t35)" }}
          >
            {count}
          </span>
        ) : null}
      </summary>
      <div style={{ padding: 12, borderTop: "1px solid var(--t16)" }}>
        {children}
      </div>
    </details>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        margin: 0,
        padding: "18px 6px",
        fontSize: 13,
        color: "var(--t35)",
        textAlign: "center",
      }}
    >
      {children}
    </p>
  );
}

/** Stagger helper. Capped so a long table does not animate for four seconds. */
export function riseDelay(index: number, step = 55, cap = 14): CSSProperties {
  return { animationDelay: `${Math.min(index, cap) * step}ms` };
}

/**
 * Gross margin after editor cost, coloured by how healthy it is: green from
 * 45%, amber from 30%, red below. Internal - never printed on a proposal.
 */
export function MarginChip({ price, cost }: { price: number; cost: number }) {
  const m = marginOf(price, cost);
  if (m === null) return null;
  const color = m >= 45 ? "var(--tg)" : m >= 30 ? "var(--ta)" : "var(--terr)";
  return (
    <span
      className="upf-mono"
      title="Gross margin after editor cost (internal, not printed)"
      style={{ fontSize: 10.5, color, whiteSpace: "nowrap" }}
    >
      {Math.round(m)}% GM
    </span>
  );
}

export function marginTone(m: number | null): string {
  if (m === null) return "var(--t35)";
  return m >= 45 ? "var(--tg)" : m >= 30 ? "var(--ta)" : "var(--terr)";
}

/** "33.3" - one decimal, dropped when whole. */
function fmtPct(m: number): string {
  return String(Math.round(m * 10) / 10);
}

/**
 * Gross margin as an editable field. Typing a margin works the price out from
 * the cost (price = cost / (1 - margin)) and hands it to `onPrice`; typing a
 * price elsewhere simply moves the number shown here.
 *
 * With no cost there is nothing to mark up - the margin is 100% at any price -
 * so the field shows that and stays read-only rather than inventing a price.
 */
export function MarginInput({
  priceCents,
  costCents,
  onPrice,
  roundTo = 100,
  disabled,
  label,
  height = 32,
}: {
  priceCents: number;
  costCents: number;
  onPrice: (cents: number) => void;
  roundTo?: number;
  disabled?: boolean;
  label: string;
  height?: number;
}) {
  const m = marginOf(priceCents, costCents);
  const shown = m === null ? "" : fmtPct(m);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);

  const noCost = !(costCents > 0);

  const commit = () => {
    if (draft.trim() === shown) return;
    const target = Number.parseFloat(draft);
    const price = priceForMargin(costCents, target, roundTo);
    if (price === null) return setDraft(shown);
    onPrice(price);
  };

  return (
    <div style={{ position: "relative" }}>
      <input
        className="upf-input"
        style={{ height, paddingRight: 22, color: marginTone(m), fontWeight: 600 }}
        type="number"
        step="1"
        max={99.9}
        inputMode="decimal"
        aria-label={label}
        title={
          noCost
            ? "No editor cost, so the margin is 100% at any price"
            : "Type a target margin and the price is worked out from the cost"
        }
        disabled={disabled || noCost}
        value={noCost ? (priceCents > 0 ? "100" : "") : draft}
        placeholder="-"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      <span
        aria-hidden
        style={{
          position: "absolute",
          right: 9,
          top: "50%",
          transform: "translateY(-50%)",
          fontSize: 12.5,
          color: "var(--t34)",
        }}
      >
        %
      </span>
    </div>
  );
}
