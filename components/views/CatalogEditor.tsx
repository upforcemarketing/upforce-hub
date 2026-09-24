"use client";

import { useEffect, useState, type ReactNode } from "react";

import { useHub } from "@/components/HubStore";
import { MarginInput } from "@/components/ui";
import { useCatalog } from "@/components/useCatalog";
import {
  CATEGORIES,
  CATEGORY_ORDER,
  groupNames,
  groupedServices,
  overrideFromService,
  sheetService,
  type Billing,
  type CategoryId,
  type Service,
} from "@/lib/catalog";
import { usd } from "@/lib/proposal";

/**
 * The back end for the proposal price sheet.
 *
 * What is set here is the default a service carries into a new proposal; each
 * proposal can still override price and cost per line. The spreadsheet stays
 * underneath as the baseline, so any edited service can go back to it.
 *
 * Fields save on blur, not per keystroke: one write per decision, and a
 * half-typed "1" never lands as a price.
 */
export function CatalogEditor() {
  const { ws, settings } = useHub();
  const catalog = useCatalog();
  const [category, setCategory] = useState<CategoryId>("gaming");
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const services = catalog[category];
  const q = query.trim().toLowerCase();
  const shown = q
    ? services.filter((s) => `${s.name} ${s.group} ${s.description}`.toLowerCase().includes(q))
    : services;

  const edited = services.filter((s) => s.edited).length;
  const added = services.filter((s) => s.custom).length;
  const hidden = services.filter((s) => s.hidden).length;

  const save = (s: Service) =>
    settings.saveService(overrideFromService(category, s, services.indexOf(s)));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {!ws.catalogReady ? (
        <div className="upf-error">
          Editing defaults needs the <code className="upf-mono">service_catalog</code> table. Run{" "}
          <code className="upf-mono">supabase/migrations/0005_service_catalog.sql</code> in the
          Supabase SQL Editor, then reload. Until then proposals use the spreadsheet prices below.
        </div>
      ) : null}

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div role="tablist" aria-label="Category" style={{ display: "flex", gap: 6 }}>
          {CATEGORY_ORDER.map((id) => {
            const on = id === category;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={on}
                className="upf-pill upf-focus"
                onClick={() => {
                  setCategory(id);
                  setOpen(null);
                }}
                style={{
                  padding: "6px 13px",
                  fontSize: 13,
                  fontWeight: on ? 600 : 500,
                  color: on ? "var(--ta)" : "var(--t37)",
                  background: on ? "var(--t14)" : "var(--t6)",
                  borderColor: on ? "var(--ta)" : "var(--t21)",
                }}
              >
                {CATEGORIES[id].label}
              </button>
            );
          })}
        </div>
        <span className="upf-label" style={{ marginLeft: 4 }}>
          {services.length} services · {edited} edited · {added} added · {hidden} hidden
        </span>
        <input
          className="upf-input"
          type="search"
          placeholder="Filter services"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ width: 220, marginLeft: "auto" }}
          aria-label="Filter services"
        />
      </div>

      <p style={{ margin: 0, fontSize: 12.5, color: "var(--t35)" }}>
        These are the defaults a service brings into a new proposal. Proposals can still override
        price and cost line by line. Changing a default here does not touch proposals already
        drafted.
      </p>

      {groupedServices(shown).map(({ group, services: list }) => (
        <section key={group} className="upf-card">
          <header
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) 110px 110px 96px 150px",
              gap: 10,
              padding: "11px 14px",
              borderBottom: "1px solid var(--t16)",
            }}
            className="upf-catalog-row"
          >
            <span className="upf-display" style={{ fontSize: 13.5, fontWeight: 600 }}>
              {group}
            </span>
            <span className="upf-label">Price</span>
            <span className="upf-label">Editor cost</span>
            <span className="upf-label">Margin</span>
            <span />
          </header>
          <div>
            {list.map((s) => (
              <ServiceEditor
                key={s.id}
                category={category}
                s={s}
                groups={groupNames(catalog, category)}
                disabled={!ws.catalogReady}
                open={open === s.id}
                onToggle={() => setOpen(open === s.id ? null : s.id)}
                onSave={(next) => save({ ...s, ...next })}
                onReset={() => {
                  const msg = s.custom
                    ? `Delete "${s.name}" from ${CATEGORIES[category].label}?`
                    : `Reset "${s.name}" to the spreadsheet default?`;
                  if (window.confirm(msg)) settings.resetService(category, s.id);
                }}
              />
            ))}
          </div>
        </section>
      ))}

      {shown.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--t35)" }}>No services match that filter.</p>
      ) : null}

      <AddService
        category={category}
        groups={groupNames(catalog, category)}
        disabled={!ws.catalogReady}
        onAdd={(s) =>
          settings.saveService(overrideFromService(category, s, services.length))
        }
      />
    </div>
  );
}

/* --- One service ---------------------------------------------------------- */

function ServiceEditor({
  category,
  s,
  groups,
  disabled,
  open,
  onToggle,
  onSave,
  onReset,
}: {
  category: CategoryId;
  s: Service;
  groups: string[];
  disabled: boolean;
  open: boolean;
  onToggle: () => void;
  onSave: (next: Partial<Service>) => void;
  onReset: () => void;
}) {
  const sheet = sheetService(category, s.id);

  // Only write when something actually changed.
  const saveIf = <K extends keyof Service>(key: K, value: Service[K]) => {
    if (JSON.stringify(s[key]) !== JSON.stringify(value)) onSave({ [key]: value } as Partial<Service>);
  };

  return (
    <div style={{ borderTop: "1px solid var(--t16)", opacity: s.hidden ? 0.6 : 1 }}>
      <div
        className="upf-catalog-row"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) 110px 110px 96px 150px",
          gap: 10,
          alignItems: "center",
          padding: "9px 14px",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{s.name}</span>
            {s.edited ? <Badge tone="var(--ta)">Edited</Badge> : null}
            {s.custom ? <Badge tone="var(--t48)">Added</Badge> : null}
            {s.hidden ? <Badge tone="var(--t36)">Hidden</Badge> : null}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--t35)", marginTop: 1 }}>
            {s.billing === "monthly" ? "Monthly" : `Per ${s.unit}`} · {s.turnaround || "no turnaround set"}
            {s.edited && sheet && (sheet.priceCents !== s.priceCents || sheet.costCents !== s.costCents) ? (
              <span style={{ color: "var(--t33)" }}>
                {" "}
                · sheet {usd(sheet.priceCents)} / cost {usd(sheet.costCents)}
              </span>
            ) : null}
          </div>
        </div>
        <MoneyField
          value={s.priceCents}
          disabled={disabled}
          label={`Default price for ${s.name}`}
          onCommit={(v) => saveIf("priceCents", v)}
        />
        <MoneyField
          value={s.costCents}
          disabled={disabled}
          label={`Default editor cost for ${s.name}`}
          onCommit={(v) => saveIf("costCents", v)}
        />
        <MarginInput
          priceCents={s.priceCents}
          costCents={s.costCents}
          disabled={disabled}
          label={`Default margin for ${s.name}`}
          onPrice={(v) => saveIf("priceCents", v)}
        />
        <div style={{ display: "flex", gap: 5, justifyContent: "flex-end" }}>
          <button
            type="button"
            className="upf-btn upf-btn-ghost"
            style={{ height: 28, padding: "0 9px" }}
            aria-expanded={open}
            onClick={onToggle}
          >
            {open ? "Close" : "Details"}
          </button>
          <button
            type="button"
            className="upf-btn upf-btn-ghost"
            style={{ height: 28, padding: "0 9px" }}
            disabled={disabled}
            onClick={() => onSave({ hidden: !s.hidden })}
            title={s.hidden ? "Offer this service on new proposals" : "Keep this service off new proposals"}
          >
            {s.hidden ? "Show" : "Hide"}
          </button>
        </div>
      </div>

      {open ? (
        <div
          className="upf-in"
          style={{
            padding: "4px 14px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div className="upf-form-grid">
            <TextField label="Name" value={s.name} disabled={disabled} onCommit={(v) => v.trim() && saveIf("name", v.trim())} />
            <TextField
              label="Group"
              value={s.group}
              disabled={disabled}
              list={`groups-${category}`}
              onCommit={(v) => v.trim() && saveIf("group", v.trim())}
            />
          </div>
          <datalist id={`groups-${category}`}>
            {groups.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
          <TextField
            label="Description (printed on the proposal)"
            value={s.description}
            disabled={disabled}
            multiline
            onCommit={(v) => saveIf("description", v)}
          />
          <div className="upf-form-grid upf-form-grid-3">
            <TextField label="Deliverables" value={s.deliverables} disabled={disabled} onCommit={(v) => saveIf("deliverables", v)} />
            <TextField label="Turnaround" value={s.turnaround} disabled={disabled} onCommit={(v) => saveIf("turnaround", v)} />
            <TextField label="Unit (video, thumbnail…)" value={s.unit} disabled={disabled} onCommit={(v) => v.trim() && saveIf("unit", v.trim())} />
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span className="upf-label">Billing</span>
              <select
                className="upf-input"
                style={{ width: 150 }}
                value={s.billing}
                disabled={disabled}
                onChange={(e) => saveIf("billing", e.target.value as Billing)}
              >
                <option value="monthly">Monthly</option>
                <option value="one-time">One-time / per unit</option>
              </select>
            </label>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {s.edited || s.custom ? (
              <button
                type="button"
                className="upf-btn upf-btn-ghost"
                disabled={disabled}
                onClick={onReset}
                style={s.custom ? { color: "var(--terr)" } : undefined}
              >
                {s.custom ? "Delete service" : "Reset to spreadsheet default"}
              </button>
            ) : (
              <span style={{ fontSize: 12, color: "var(--t34)" }}>Spreadsheet default, unedited.</span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* --- Add a service --------------------------------------------------------- */

function AddService({
  category,
  groups,
  disabled,
  onAdd,
}: {
  category: CategoryId;
  groups: string[];
  disabled: boolean;
  onAdd: (s: Service) => void;
}) {
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [billing, setBilling] = useState<Billing>("one-time");

  const dollars = (v: string) => Math.max(0, Math.round((Number.parseFloat(v) || 0) * 100));

  const submit = () => {
    if (!name.trim()) return;
    onAdd({
      id: `custom-${Date.now().toString(36)}`,
      group: group.trim() || "Other",
      name: name.trim(),
      description: "",
      deliverables: "",
      turnaround: "",
      priceCents: dollars(price),
      costCents: dollars(cost),
      billing,
      unit: billing === "monthly" ? "month" : "unit",
    });
    setName("");
    setPrice("");
    setCost("");
  };

  return (
    <section className="upf-card" style={{ padding: 14 }}>
      <div className="upf-display" style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 10 }}>
        Add a service to {CATEGORIES[category].label}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,2fr) minmax(0,1.3fr) 110px 110px 150px auto",
          gap: 8,
          alignItems: "end",
        }}
        className="upf-catalog-add"
      >
        <Labeled label="Name">
          <input className="upf-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Stream highlights reel" disabled={disabled} />
        </Labeled>
        <Labeled label="Group">
          <input className="upf-input" list={`add-groups-${category}`} value={group} onChange={(e) => setGroup(e.target.value)} placeholder={groups[0] ?? "Other"} disabled={disabled} />
          <datalist id={`add-groups-${category}`}>
            {groups.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </Labeled>
        <Labeled label="Price $">
          <input className="upf-input" type="number" min={0} step="1" value={price} onChange={(e) => setPrice(e.target.value)} disabled={disabled} />
        </Labeled>
        <Labeled label="Cost $">
          <input className="upf-input" type="number" min={0} step="1" value={cost} onChange={(e) => setCost(e.target.value)} disabled={disabled} />
        </Labeled>
        <Labeled label="Billing">
          <select className="upf-input" value={billing} onChange={(e) => setBilling(e.target.value as Billing)} disabled={disabled}>
            <option value="one-time">One-time / per unit</option>
            <option value="monthly">Monthly</option>
          </select>
        </Labeled>
        <button type="button" className="upf-btn" style={{ height: 38 }} disabled={disabled || !name.trim()} onClick={submit}>
          Add service
        </button>
      </div>
      <p style={{ margin: "8px 0 0", fontSize: 11.5, color: "var(--t34)" }}>
        Open Details on the new service to add its description, turnaround and deliverables.
      </p>
    </section>
  );
}

/* --- Fields ------------------------------------------------------------------ */

/**
 * An input that holds its own draft and commits on blur (or Enter). It
 * re-syncs from the saved value whenever that changes underneath it - a reset,
 * a rollback after a failed save - so it never shows a stale number.
 */
function MoneyField({
  value,
  disabled,
  label,
  onCommit,
}: {
  value: number;
  disabled: boolean;
  label: string;
  onCommit: (cents: number) => void;
}) {
  const [draft, setDraft] = useState(String(value / 100));
  useEffect(() => setDraft(String(value / 100)), [value]);

  const commit = () => {
    const n = Number.parseFloat(draft);
    if (!Number.isFinite(n) || n < 0) return setDraft(String(value / 100));
    onCommit(Math.round(n * 100));
  };

  return (
    <div style={{ position: "relative" }}>
      <span
        aria-hidden
        style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", fontSize: 12.5, color: "var(--t34)" }}
      >
        $
      </span>
      <input
        className="upf-input"
        style={{ height: 32, paddingLeft: 19 }}
        type="number"
        min={0}
        step="1"
        inputMode="decimal"
        aria-label={label}
        disabled={disabled}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </div>
  );
}

function TextField({
  label,
  value,
  disabled,
  multiline,
  list,
  onCommit,
}: {
  label: string;
  value: string;
  disabled: boolean;
  multiline?: boolean;
  list?: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <Labeled label={label}>
      {multiline ? (
        <textarea
          className="upf-input"
          rows={3}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onCommit(draft)}
        />
      ) : (
        <input
          className="upf-input"
          value={draft}
          list={list}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onCommit(draft)}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      )}
    </Labeled>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
      <span className="upf-label">{label}</span>
      {children}
    </label>
  );
}

function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span
      className="upf-mono"
      style={{
        fontSize: 9.5,
        letterSpacing: ".08em",
        textTransform: "uppercase",
        padding: "1px 6px",
        borderRadius: 5,
        color: tone,
        border: `1px solid ${tone}`,
      }}
    >
      {children}
    </span>
  );
}
