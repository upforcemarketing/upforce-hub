"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { AddLeadModal } from "@/components/AddLeadModal";
import { ComposeSheet } from "@/components/ComposeSheet";
import { useHub } from "@/components/HubStore";
import { LeadDrawer } from "@/components/LeadDrawer";
import { LostReasonModal } from "@/components/LostReasonModal";
import type { Channel } from "@/lib/stages";

/* ---------------------------------------------------------------------------
   The frame every view sits inside: sidebar, header, drawer, modals, toast.

   Search and the two overlays are UI state, not workspace data, so they live
   here rather than in the store - nothing about them needs to survive a
   navigation or be persisted.
   --------------------------------------------------------------------------- */

type Ui = {
  query: string;
  setQuery: (q: string) => void;
  openAdd: () => void;
  /** Opens the compose sheet for a lead on a given channel. */
  compose: (leadId: string, channel: Channel) => void;
  /** Asks why, then hands the answer (or none, if skipped) to `onConfirm`. */
  confirmLostReason: (leadId: string, onConfirm: (reason?: string) => void) => void;
};

const UiContext = createContext<Ui | null>(null);

export function useUi(): Ui {
  const ui = useContext(UiContext);
  if (!ui) throw new Error("useUi must be used inside <Shell>.");
  return ui;
}

const NAV = [
  { href: "/today", label: "Today", icon: "◎" },
  { href: "/pipeline", label: "Pipeline", icon: "▦" },
  { href: "/leads", label: "All leads", icon: "☰" },
  { href: "/revenue", label: "Revenue", icon: "◧" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

/* Calendar is built but not wired - CadenceDock and the calendar providers are
   UI only. Grouped separately so the sidebar says so before anyone clicks,
   rather than letting them find out by booking a meeting that syncs nowhere. */
const NAV_SOON = [{ href: "/calendar", label: "Calendar", icon: "▤" }];

const TITLES: Record<string, string> = {
  "/today": "Today",
  "/pipeline": "Pipeline",
  "/leads": "All leads",
  "/calendar": "Calendar",
  "/revenue": "Revenue",
  "/settings": "Settings",
};

function NavLink({
  item,
  active,
  muted,
}: {
  item: { href: string; label: string; icon: string };
  active: boolean;
  muted?: boolean;
}) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className="upf-focus"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 11px",
        borderRadius: 9,
        fontSize: 13.5,
        fontWeight: active ? 600 : 500,
        color: active ? "var(--ta)" : muted ? "var(--t34)" : "var(--t37)",
        background: active ? "var(--t14)" : "transparent",
        border: `1px solid ${active ? "var(--t25)" : "transparent"}`,
        transition: "background .16s ease, color .16s ease",
      }}
    >
      <span aria-hidden style={{ fontSize: 14, width: 16 }}>
        {item.icon}
      </span>
      {item.label}
    </Link>
  );
}

export function Shell({
  profile,
  children,
}: {
  profile: { email: string; full_name: string };
  children: ReactNode;
}) {
  const { theme, setTheme, toast, selectedId } = useHub();
  const pathname = usePathname();

  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [composeState, setComposeState] = useState<{
    leadId: string;
    channel: Channel;
  } | null>(null);
  const [lostReasonState, setLostReasonState] = useState<{
    leadId: string;
    onConfirm: (reason?: string) => void;
  } | null>(null);

  const ui = useMemo<Ui>(
    () => ({
      query,
      setQuery,
      openAdd: () => setAddOpen(true),
      compose: (leadId, channel) => setComposeState({ leadId, channel }),
      confirmLostReason: (leadId, onConfirm) =>
        setLostReasonState({ leadId, onConfirm }),
    }),
    [query]
  );

  const title = TITLES[pathname] ?? "Hub";

  return (
    <UiContext.Provider value={ui}>
      <div style={{ display: "flex", minHeight: "100vh" }}>
        <nav
          aria-label="Sections"
          style={{
            flex: "0 0 208px",
            display: "flex",
            flexDirection: "column",
            gap: 2,
            padding: "18px 12px",
            background: "var(--t2)",
            borderRight: "1px solid var(--t18)",
          }}
        >
          <Link
            href="/today"
            style={{ display: "inline-flex", margin: "0 4px 22px" }}
          >
            <Image
              className="upf-logo"
              src="/upforce-logo.png"
              alt="Upforce Hub"
              width={126}
              height={30}
              priority
            />
          </Link>

          {NAV.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={pathname === item.href}
            />
          ))}

          <p
            className="upf-label"
            style={{ margin: "18px 0 6px", padding: "0 11px" }}
          >
            Coming soon
          </p>

          {NAV_SOON.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={pathname === item.href}
              muted
            />
          ))}

          <div style={{ marginTop: "auto", padding: "12px 4px 0" }}>
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: "var(--t39)",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {profile.full_name || profile.email}
            </div>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                style={{
                  marginTop: 4,
                  padding: 0,
                  border: "none",
                  background: "none",
                  fontSize: 12.5,
                  color: "var(--t35)",
                }}
              >
                Sign out
              </button>
            </form>
          </div>
        </nav>

        {/* The drawer pins itself to the viewport and is narrow enough to
            clear this column's left edge, so it never covers the nav. */}
        <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
          <header
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "14px 22px",
              background: "var(--t1)",
              borderBottom: "1px solid var(--t18)",
            }}
          >
            <h1
              className="upf-display"
              style={{ fontSize: 17, fontWeight: 600, margin: 0 }}
            >
              {title}
            </h1>

            <div style={{ marginLeft: "auto", position: "relative" }}>
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  left: 11,
                  top: "50%",
                  transform: "translateY(-50%)",
                  fontSize: 13,
                  color: "var(--t34)",
                }}
              >
                ⌕
              </span>
              <input
                className="upf-input"
                style={{ width: 260, paddingLeft: 30 }}
                type="search"
                placeholder="Search leads, handles, tags"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search leads"
              />
            </div>

            <button
              className="upf-btn upf-btn-ghost"
              type="button"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            >
              {theme === "dark" ? "☀" : "☾"}
            </button>

            <button
              className="upf-btn"
              type="button"
              onClick={() => setAddOpen(true)}
            >
              + Add lead
            </button>
          </header>

          <main
            key={pathname}
            className="upf-in"
            style={{ padding: 22, minWidth: 0 }}
          >
            {children}
          </main>

          {selectedId ? <LeadDrawer key={selectedId} /> : null}
        </div>
      </div>

      {addOpen ? <AddLeadModal onClose={() => setAddOpen(false)} /> : null}

      {composeState ? (
        <ComposeSheet
          leadId={composeState.leadId}
          channel={composeState.channel}
          onClose={() => setComposeState(null)}
        />
      ) : null}

      {lostReasonState ? (
        <LostReasonModal
          leadId={lostReasonState.leadId}
          onConfirm={lostReasonState.onConfirm}
          onClose={() => setLostReasonState(null)}
        />
      ) : null}

      {toast ? (
        <div className="upf-toast" role="status">
          {toast}
        </div>
      ) : null}
    </UiContext.Provider>
  );
}
