"use client";

import { useEffect, useMemo, useState } from "react";

import { useHub } from "@/components/HubStore";
import { CatalogEditor } from "@/components/views/CatalogEditor";
import { CollapsibleCard, SectionCard } from "@/components/ui";
import { ink } from "@/lib/engine";
import { STAGES, STAGE_ORDER, SWATCHES, type StageId } from "@/lib/stages";

/**
 * The back-end for the whole taxonomy.
 *
 * Everything on this screen is data the rest of the app reads at render time,
 * so an edit here lands everywhere immediately - renaming a tag rewrites it on
 * every lead, and moving a ladder day reschedules every lead in that stage.
 * That is the point of keeping cadences in a table rather than in code.
 */
export function SettingsView() {
  const [tab, setTab] = useState<"taxonomy" | "automations" | "catalog">("taxonomy");

  // ?tab=catalog lands on the price sheet - the proposal builder links here.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("tab");
    if (wanted === "catalog" || wanted === "automations") setTab(wanted);
  }, []);

  return (
    <>
      <div
        style={{
          display: "flex",
          gap: 6,
          marginBottom: 18,
          borderBottom: "1px solid var(--t18)",
        }}
      >
        {(
          [
            ["taxonomy", "Tags, platforms & pricing"],
            ["automations", "Automations"],
            ["catalog", "Service catalog"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-current={tab === id ? "true" : undefined}
            className="upf-focus"
            style={{
              padding: "9px 14px",
              marginBottom: -1,
              fontSize: 13.5,
              fontWeight: tab === id ? 600 : 500,
              color: tab === id ? "var(--t40)" : "var(--t35)",
              background: "none",
              border: "none",
              borderBottom: `2px solid ${tab === id ? "var(--ta)" : "transparent"}`,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "taxonomy" ? <Taxonomy /> : tab === "automations" ? <Automations /> : <CatalogEditor />}
    </>
  );
}

/* --- Taxonomy -------------------------------------------------------------- */

function Taxonomy() {
  const { ws, settings, theme } = useHub();

  const [newTag, setNewTag] = useState("");
  const [newTagColor, setNewTagColor] = useState(SWATCHES[0]);

  // Usage counts come from the leads already in memory - no extra query, and
  // it updates the moment a tag is added to a lead in the drawer.
  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const lead of ws.leads) {
      for (const id of lead.tagIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [ws.leads]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <CollapsibleCard
        title="Tags"
        count={`${ws.tags.length} ${ws.tags.length === 1 ? "tag" : "tags"}`}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {ws.tags.map((tag) => (
            <div
              key={tag.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
                padding: "9px 11px",
                borderRadius: 11,
                background: "var(--t6)",
                border: "1px solid var(--t19)",
              }}
            >
              <input
                className="upf-input"
                style={{
                  flex: "1 1 180px",
                  color: ink(tag.color, theme),
                  fontWeight: 600,
                }}
                defaultValue={tag.name}
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (name && name !== tag.name)
                    settings.patchTag(tag.id, { name });
                  else e.target.value = tag.name;
                }}
                aria-label={`Rename ${tag.name}`}
              />

              <div style={{ display: "flex", gap: 4 }} role="group" aria-label="Colour">
                {SWATCHES.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    onClick={() => settings.patchTag(tag.id, { color: swatch })}
                    aria-label={`Set ${tag.name} to ${swatch}`}
                    aria-pressed={tag.color === swatch}
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 5,
                      background: swatch,
                      border: `2px solid ${
                        tag.color === swatch ? "var(--t40)" : "transparent"
                      }`,
                    }}
                  />
                ))}
              </div>

              <span
                className="upf-mono"
                style={{ fontSize: 11.5, color: "var(--t34)" }}
              >
                {usage.get(tag.id) ?? 0} leads
              </span>

              <button
                className="upf-btn upf-btn-ghost"
                type="button"
                onClick={() => settings.removeTag(tag.id)}
              >
                Delete
              </button>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 7, marginTop: 10 }}>
          <input
            className="upf-input"
            placeholder="New tag"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            aria-label="New tag name"
          />
          <select
            className="upf-input"
            style={{ flex: "0 0 120px" }}
            value={newTagColor}
            onChange={(e) => setNewTagColor(e.target.value)}
            aria-label="New tag colour"
          >
            {SWATCHES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            className="upf-btn"
            type="button"
            style={{ flex: "0 0 auto" }}
            onClick={() => {
              settings.addTag(newTag, newTagColor);
              setNewTag("");
            }}
          >
            Add tag
          </button>
        </div>

        <p style={{ margin: "10px 0 0", fontSize: 11.5, color: "var(--t34)" }}>
          Renaming a tag rewrites it on every lead. Deleting one strips it.
        </p>
      </CollapsibleCard>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
          <NameList table="platforms" title="Platforms" />
        </div>
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
          <NameList table="sources" title="Sources" />
        </div>
      </div>

      <PriceList
        table="packages"
        title="Packages"
        hint="One package per lead. This is the retainer the deal sits on."
      />

      <PriceList
        table="addons"
        title="Add-ons"
        hint="Stack on top of a package. Priced at zero until someone sets a rate."
      />
    </div>
  );
}

function NameList({
  table,
  title,
}: {
  table: "platforms" | "sources";
  title: string;
}) {
  const { ws, settings } = useHub();
  const [value, setValue] = useState("");

  return (
    <SectionCard title={title}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {ws[table].map((item) => (
          <div
            key={item.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 11px",
              borderRadius: 10,
              background: "var(--t6)",
              border: "1px solid var(--t19)",
              fontSize: 13,
            }}
          >
            {item.name}
            <button
              className="upf-btn upf-btn-ghost"
              type="button"
              style={{ marginLeft: "auto", height: 26, fontSize: 11.5 }}
              onClick={() => settings.removeListItem(table, item.id)}
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 7, marginTop: 10 }}>
        <input
          className="upf-input"
          placeholder={`New ${title.toLowerCase().replace(/s$/, "")}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label={`New ${title}`}
        />
        <button
          className="upf-btn"
          type="button"
          style={{ flex: "0 0 auto" }}
          onClick={() => {
            settings.addListItem(table, value);
            setValue("");
          }}
        >
          Add
        </button>
      </div>
    </SectionCard>
  );
}

function PriceList({
  table,
  title,
  hint,
}: {
  table: "packages" | "addons";
  title: string;
  hint: string;
}) {
  const { ws, settings } = useHub();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");

  return (
    <SectionCard title={title}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {ws[table].map((item) => (
          <div key={item.id} style={{ display: "flex", gap: 7 }}>
            <input
              className="upf-input"
              defaultValue={item.name}
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next && next !== item.name)
                  settings.patchPriced(table, item.id, { name: next });
                else e.target.value = item.name;
              }}
              aria-label={`Rename ${item.name}`}
            />
            <input
              className="upf-input"
              style={{ flex: "0 0 120px" }}
              type="number"
              min={0}
              step={50}
              defaultValue={item.priceCents / 100}
              onBlur={(e) =>
                settings.patchPriced(table, item.id, {
                  priceCents: Math.round(Number(e.target.value) * 100),
                })
              }
              aria-label={`Monthly price for ${item.name}`}
            />
            <button
              className="upf-btn upf-btn-ghost"
              type="button"
              style={{ flex: "0 0 auto" }}
              onClick={() => settings.removePriced(table, item.id)}
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 7, marginTop: 10 }}>
        <input
          className="upf-input"
          placeholder={`New ${title.toLowerCase().replace(/s$/, "")}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label={`New ${title} name`}
        />
        <input
          className="upf-input"
          style={{ flex: "0 0 120px" }}
          type="number"
          min={0}
          step={50}
          placeholder="0"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          aria-label={`New ${title} monthly price`}
        />
        <button
          className="upf-btn"
          type="button"
          style={{ flex: "0 0 auto" }}
          onClick={() => {
            settings.addPriced(table, name, Math.round(Number(price || 0) * 100));
            setName("");
            setPrice("");
          }}
        >
          Add
        </button>
      </div>

      <p style={{ margin: "10px 0 0", fontSize: 11.5, color: "var(--t34)" }}>
        {hint} Prices are per month, in dollars.
      </p>
    </SectionCard>
  );
}

/* --- Automations ----------------------------------------------------------- */

function Automations() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {STAGE_ORDER.map((stage) => (
        <Ladder key={stage} stage={stage} />
      ))}
    </div>
  );
}

function Ladder({ stage }: { stage: StageId }) {
  const { ws, settings, theme } = useHub();
  const config = STAGES[stage];
  const cadence = ws.cadences[stage];

  const inStage = ws.leads.filter((l) => l.stage === stage).length;

  return (
    <SectionCard
      title={
        <span
          style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
        >
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: config.color,
            }}
          />
          <span style={{ color: ink(config.color, theme) }}>{config.label}</span>
        </span>
      }
      aside={
        <span
          className="upf-mono"
          style={{ fontSize: 11.5, color: "var(--t35)" }}
        >
          {inStage} {inStage === 1 ? "lead" : "leads"}
        </span>
      }
    >
      <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--t35)" }}>
        {config.definition}
      </p>

      {cadence.steps.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--t34)" }}>
          No retarget clock on this stage.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {cadence.steps.map((step, i) => (
            <div key={step.id} style={{ display: "flex", gap: 7 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  flex: "0 0 auto",
                }}
              >
                <span className="upf-label" style={{ width: 30 }}>
                  Day
                </span>
                <input
                  className="upf-input"
                  style={{ width: 74 }}
                  type="number"
                  min={0}
                  defaultValue={step.day}
                  onBlur={(e) =>
                    settings.patchStep(stage, step.id, {
                      day: Number(e.target.value),
                    })
                  }
                  aria-label={`Day for touch ${i + 1}`}
                />
              </div>

              <input
                className="upf-input"
                defaultValue={step.label}
                onBlur={(e) =>
                  settings.patchStep(stage, step.id, { label: e.target.value })
                }
                aria-label={`Label for touch ${i + 1}`}
              />

              <button
                className="upf-btn upf-btn-ghost"
                type="button"
                style={{ flex: "0 0 32px", padding: 0 }}
                onClick={() => settings.removeStep(stage, step.id)}
                aria-label={`Remove touch ${i + 1}`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        className="upf-btn upf-btn-ghost"
        type="button"
        style={{ marginTop: 8 }}
        onClick={() => settings.addStep(stage)}
      >
        + Add touch
      </button>

      {config.next ? (
        <div
          className="upf-divider"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            marginTop: 14,
            paddingTop: 12,
            fontSize: 13,
            color: "var(--t38)",
          }}
        >
          {config.demote} on day
          <input
            className="upf-input"
            style={{ width: 84 }}
            type="number"
            min={0}
            defaultValue={cadence.demoteDay}
            onBlur={(e) =>
              settings.setDemoteDay(stage, Number(e.target.value))
            }
            aria-label={`Demote day for ${config.label}`}
          />
          <span style={{ fontSize: 11.5, color: "var(--t34)" }}>
            Surfaced for approval on Today — never applied automatically.
          </span>
        </div>
      ) : null}
    </SectionCard>
  );
}
