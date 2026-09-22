"use client";

import { useEffect, useMemo, useState } from "react";

import { useHub } from "@/components/HubStore";
import { ink } from "@/lib/engine";
import { STAGES } from "@/lib/stages";
import type { StageId } from "@/lib/stages";

/** Only the stages a lead can legitimately start in. */
const STARTING_STAGES: StageId[] = ["cold", "warm", "hot", "reactivation"];

export function AddLeadModal({ onClose }: { onClose: () => void }) {
  const { ws, addLead, select, theme, notify } = useHub();

  const defaultPlatform = ws.platforms[0]?.name ?? "YouTube";
  const [name, setName] = useState("");
  const [stage, setStage] = useState<StageId>("cold");
  const [accounts, setAccounts] = useState([
    { platform: defaultPlatform, handle: "" },
  ]);
  const [sourceId, setSourceId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* Warn rather than block: two creators can legitimately share a handle
     across platforms, and the rep is better placed to judge than we are. */
  const duplicate = useMemo(() => {
    const handles = accounts
      .map((a) => a.handle.trim().toLowerCase())
      .filter(Boolean);
    if (handles.length === 0) return null;

    return (
      ws.leads.find((lead) =>
        lead.socials.some((s) => handles.includes(s.handle.toLowerCase()))
      ) ?? null
    );
  }, [accounts, ws.leads]);

  async function submit() {
    if (!name.trim()) {
      notify("Give the lead a name first.");
      return;
    }

    setBusy(true);
    const id = await addLead({
      name,
      stage,
      accounts,
      sourceId: sourceId || null,
    });
    setBusy(false);

    if (!id) return;
    onClose();
    // Drop straight into the drawer - a new lead almost always needs a package
    // and tags before it is any use in the queue.
    select(id);
  }

  return (
    <div
      className="upf-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Add lead"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="upf-card upf-pop"
        style={{ width: "100%", maxWidth: 480, boxShadow: "var(--shadow)" }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            padding: "14px 18px",
            borderBottom: "1px solid var(--t16)",
          }}
        >
          <h2
            className="upf-display"
            style={{ fontSize: 15, fontWeight: 600, margin: 0 }}
          >
            Add lead
          </h2>
          <button
            className="upf-btn upf-btn-ghost"
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ marginLeft: "auto", width: 32, padding: 0 }}
          >
            ✕
          </button>
        </header>

        <div style={{ padding: 18 }}>
          <label className="upf-label" style={{ display: "block", marginBottom: 6 }}>
            Name
          </label>
          <input
            className="upf-input"
            value={name}
            autoFocus
            placeholder="Nappyboy Gaming"
            onChange={(e) => setName(e.target.value)}
          />

          <label
            className="upf-label"
            style={{ display: "block", margin: "14px 0 6px" }}
          >
            Social accounts
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {accounts.map((account, i) => (
              <div key={i} style={{ display: "flex", gap: 6 }}>
                <select
                  className="upf-input"
                  style={{ flex: "0 0 116px" }}
                  value={account.platform}
                  onChange={(e) =>
                    setAccounts((current) =>
                      current.map((a, idx) =>
                        idx === i ? { ...a, platform: e.target.value } : a
                      )
                    )
                  }
                  aria-label={`Platform for account ${i + 1}`}
                >
                  {ws.platforms.map((p) => (
                    <option key={p.id} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>

                <input
                  className="upf-input"
                  value={account.handle}
                  placeholder="@handle"
                  onChange={(e) =>
                    setAccounts((current) =>
                      current.map((a, idx) =>
                        idx === i ? { ...a, handle: e.target.value } : a
                      )
                    )
                  }
                  aria-label={`Handle for account ${i + 1}`}
                />

                <button
                  className="upf-btn upf-btn-ghost"
                  type="button"
                  style={{ flex: "0 0 32px", padding: 0 }}
                  disabled={accounts.length === 1}
                  onClick={() =>
                    setAccounts((current) =>
                      current.filter((_, idx) => idx !== i)
                    )
                  }
                  aria-label={`Remove account ${i + 1}`}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <button
            className="upf-btn upf-btn-ghost"
            type="button"
            style={{ marginTop: 8 }}
            onClick={() =>
              setAccounts((current) => [
                ...current,
                { platform: defaultPlatform, handle: "" },
              ])
            }
          >
            + Add another account
          </button>

          {duplicate ? (
            <p
              style={{
                margin: "12px 0 0",
                fontSize: 12.5,
                color: "var(--ta)",
                background: "var(--t14)",
                border: "1px solid var(--t25)",
                borderRadius: 9,
                padding: "9px 11px",
              }}
            >
              {duplicate.name} already has one of these handles. Add anyway if
              they are different people.
            </p>
          ) : null}

          <label
            className="upf-label"
            style={{ display: "block", margin: "16px 0 6px" }}
          >
            Source
          </label>
          <select
            className="upf-input"
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            aria-label="Source"
          >
            <option value="">Unknown</option>
            {ws.sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          <label
            className="upf-label"
            style={{ display: "block", margin: "16px 0 6px" }}
          >
            Starting stage
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
            {STARTING_STAGES.map((id) => {
              const active = stage === id;
              const color = STAGES[id].color;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setStage(id)}
                  aria-pressed={active}
                  className="upf-focus"
                  style={{
                    padding: "6px 12px",
                    fontSize: 12.5,
                    fontWeight: 600,
                    borderRadius: 18,
                    color: ink(color, theme),
                    background: `${color}${active ? "2E" : "14"}`,
                    border: `1px solid ${color}${active ? "55" : "2E"}`,
                    transition: "background .16s ease, border-color .16s ease",
                  }}
                >
                  {STAGES[id].label}
                </button>
              );
            })}
          </div>
          <p style={{ margin: "9px 0 0", fontSize: 11.5, color: "var(--t34)" }}>
            The clock starts now — the first touch is due on day{" "}
            {ws.cadences[stage].steps[0]?.day ?? ws.cadences[stage].demoteDay}.
          </p>
        </div>

        <footer
          style={{
            display: "flex",
            gap: 8,
            padding: "0 18px 18px",
            justifyContent: "flex-end",
          }}
        >
          <button
            className="upf-btn upf-btn-ghost"
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="upf-btn"
            type="button"
            onClick={submit}
            disabled={busy}
          >
            {busy ? "Adding…" : "Add lead"}
          </button>
        </footer>
      </div>
    </div>
  );
}
