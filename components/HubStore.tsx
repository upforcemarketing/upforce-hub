"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import * as api from "@/app/(app)/actions";
import type { ActionResult } from "@/app/(app)/actions";
import { STAGES, type Channel, type StageId } from "@/lib/stages";
import type { Theme } from "@/lib/engine";
import type { Lead, Workspace } from "@/lib/types";

/* ---------------------------------------------------------------------------
   The single store the whole app reads from.

   The server hands over one consistent snapshot of the workspace; from there
   every view reads the same client-side copy, so the stat cards, the board and
   the table can never disagree about what is in the pipeline.

   Mutations are optimistic: apply locally, persist, and roll back with a toast
   if the write fails. The alternative - awaiting a round trip before the chip
   toggles - makes a CRM that is used all day feel broken.

   The discipline that keeps this honest: a mutator closes over stable ids only
   and resolves the target INSIDE the updater. Reading a lead out of `state`
   before calling `setState` returns whatever was there at render time, which
   during a burst of clicks is not what is there now.
   --------------------------------------------------------------------------- */

type Store = {
  ws: Workspace;
  theme: Theme;
  toast: string;
  selectedId: string | null;

  setTheme: (theme: Theme) => void;
  select: (leadId: string | null) => void;
  notify: (message: string) => void;

  /** Read a lead by id. Returns undefined once it has been deleted. */
  lead: (id: string) => Lead | undefined;

  logTouch: (leadId: string, channel: Channel, detail: string) => void;
  undoTouch: (leadId: string, touchId: string) => void;
  moveStage: (leadId: string, stage: StageId, reason?: string) => void;
  applyDemotion: (leadId: string, reason?: string) => void;
  snooze: (leadId: string) => void;
  patchLead: (leadId: string, patch: api.LeadPatch) => void;
  addLead: (input: api.NewLead) => Promise<string | null>;
  removeLead: (leadId: string) => void;

  setTag: (leadId: string, tagId: string, on: boolean) => void;
  setAddon: (leadId: string, addonId: string, on: boolean) => void;

  addSocial: (leadId: string) => void;
  patchSocial: (
    leadId: string,
    socialId: string,
    patch: { platform?: string; handle?: string }
  ) => void;
  removeSocial: (leadId: string, socialId: string) => void;

  /** Settings-side mutations. Each mirrors one server action. */
  settings: {
    addTag: (name: string, color: string) => void;
    patchTag: (id: string, patch: { name?: string; color?: string }) => void;
    removeTag: (id: string) => void;

    addListItem: (table: "platforms" | "sources", name: string) => void;
    removeListItem: (table: "platforms" | "sources", id: string) => void;

    addPriced: (
      table: "packages" | "addons",
      name: string,
      priceCents: number
    ) => void;
    patchPriced: (
      table: "packages" | "addons",
      id: string,
      patch: { name?: string; priceCents?: number }
    ) => void;
    removePriced: (table: "packages" | "addons", id: string) => void;

    patchStep: (
      stage: StageId,
      stepId: string,
      patch: { day?: number; label?: string }
    ) => void;
    addStep: (stage: StageId) => void;
    removeStep: (stage: StageId, stepId: string) => void;
    setDemoteDay: (stage: StageId, day: number) => void;
  };

  calendar: {
    book: (input: {
      day: number;
      time: string;
      title: string;
      kind: "meeting" | "internal";
      leadId: string | null;
    }) => void;
    remove: (id: string) => void;
    setAccount: (id: string, connected: boolean) => void;
    setShared: (shared: boolean) => void;
  };
};

const HubContext = createContext<Store | null>(null);

export function useHub(): Store {
  const store = useContext(HubContext);
  if (!store) throw new Error("useHub must be used inside <HubProvider>.");
  return store;
}

/** Client-side ids for optimistic rows, replaced by the real id on success. */
let tempCounter = 0;
const tempId = () => `temp-${++tempCounter}`;

export function HubProvider({
  initial,
  initialTheme,
  children,
}: {
  initial: Workspace;
  initialTheme: Theme;
  children: ReactNode;
}) {
  const [ws, setWs] = useState<Workspace>(initial);
  const [theme, setThemeState] = useState<Theme>(initialTheme);
  const [toast, setToast] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2200);
  }, []);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  /**
   * Stored in a cookie rather than localStorage so the server can read it and
   * paint the first frame in the right palette. localStorage is only visible
   * after hydration, which is one flash of the wrong theme per navigation.
   */
  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    document.documentElement.setAttribute("data-theme", next);
    document.cookie = `upf-theme=${next}; path=/; max-age=31536000; samesite=lax`;
  }, []);

  /**
   * Runs a persisted mutation.
   *
   * `apply` mutates local state immediately. If the server rejects it, the
   * snapshot taken before the change is restored wholesale rather than the
   * change being inverted - inverting is where partially-applied rollbacks
   * come from.
   */
  const commit = useCallback(
    (
      apply: (current: Workspace) => Workspace,
      persist: () => Promise<ActionResult<unknown>>,
      message?: string
    ) => {
      let rollback: Workspace | null = null;

      setWs((current) => {
        rollback = current;
        return apply(current);
      });

      if (message) notify(message);

      void persist().then((result) => {
        if (result.ok) return;
        if (rollback) setWs(rollback);
        notify(result.error || "That did not save.");
      });
    },
    [notify]
  );

  /* --- Lead mutations ----------------------------------------------------- */

  const mapLead = (
    current: Workspace,
    leadId: string,
    fn: (lead: Lead) => Lead
  ): Workspace => ({
    ...current,
    leads: current.leads.map((l) => (l.id === leadId ? fn(l) : l)),
  });

  const logTouch = useCallback(
    (leadId: string, channel: Channel, detail: string) => {
      const now = new Date().toISOString();
      const placeholder = tempId();

      commit(
        (current) =>
          mapLead(current, leadId, (lead) => ({
            ...lead,
            touches: lead.touches + 1,
            history: [
              { id: placeholder, channel, detail, createdAt: now },
              ...lead.history,
            ],
          })),
        async () => {
          const result = await api.logTouch(leadId, channel, detail);
          /* Swap in the real id. Until this lands the row carries a temporary
             one, which is why Undo stays disabled for the half-second it
             takes - it would otherwise ask the database for a row it has
             never heard of. */
          if (result.ok) {
            setWs((current) =>
              mapLead(current, leadId, (lead) => ({
                ...lead,
                history: lead.history.map((h) =>
                  h.id === placeholder ? { ...h, id: result.data.id } : h
                ),
              }))
            );
          }
          return result;
        },
        `${channel} logged · next touch scheduled`
      );
    },
    [commit]
  );

  /**
   * Takes back the most recent touch.
   *
   * The server re-checks that it is still the latest before deleting, so a
   * stale drawer - or two people looking at the same lead - cannot undo the
   * wrong thing. If it refuses, the rollback restores the row and the toast
   * says why.
   */
  const undoTouch = useCallback(
    (leadId: string, touchId: string) => {
      commit(
        (current) =>
          mapLead(current, leadId, (lead) => ({
            ...lead,
            touches: Math.max(0, lead.touches - 1),
            history: lead.history.filter((h) => h.id !== touchId),
          })),
        () => api.undoTouch(leadId, touchId),
        "Touch undone · ladder stepped back"
      );
    },
    [commit]
  );

  const moveStage = useCallback(
    (leadId: string, stage: StageId, reason?: string) => {
      const now = new Date().toISOString();
      commit(
        (current) =>
          mapLead(current, leadId, (lead) => ({
            ...lead,
            stage,
            stageEnteredAt: now,
            touches: 0,
            ...(reason !== undefined ? { lostReason: reason } : {}),
          })),
        () => api.moveStage(leadId, stage, reason),
        `Moved to ${STAGES[stage].label} · clock reset`
      );
    },
    [commit]
  );

  /**
   * Approves a pending demotion.
   *
   * The successor is resolved inside the updater from the lead's stage as it
   * is now, not as it was when the row rendered - two clicks on a stale row
   * would otherwise demote twice down the wrong chain.
   */
  const applyDemotion = useCallback(
    (leadId: string, reason?: string) => {
      const lead = ws.leads.find((l) => l.id === leadId);
      const next = lead ? STAGES[lead.stage].next : null;
      if (!next) return;
      moveStage(leadId, next, reason);
    },
    [ws.leads, moveStage]
  );

  const snooze = useCallback(
    (leadId: string) => {
      const now = Date.now();
      commit(
        (current) =>
          mapLead(current, leadId, (lead) => {
            const pushed = Date.parse(lead.stageEnteredAt) + 3 * 86_400_000;
            return {
              ...lead,
              stageEnteredAt: new Date(Math.min(pushed, now)).toISOString(),
            };
          }),
        () => api.snoozeLead(leadId, 3),
        "Snoozed 3 days"
      );
    },
    [commit]
  );

  const patchLead = useCallback(
    (leadId: string, patch: api.LeadPatch) => {
      commit(
        (current) =>
          mapLead(current, leadId, (lead) => ({
            ...lead,
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.audience !== undefined
              ? { audience: patch.audience }
              : {}),
            ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
            ...(patch.email !== undefined ? { email: patch.email } : {}),
            ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
            ...(patch.sourceId !== undefined
              ? { sourceId: patch.sourceId }
              : {}),
            ...(patch.packageId !== undefined
              ? { packageId: patch.packageId }
              : {}),
            ...(patch.quotedValueCents !== undefined
              ? { quotedValueCents: patch.quotedValueCents }
              : {}),
          })),
        () => api.updateLead(leadId, patch)
      );
    },
    [commit]
  );

  const addLead = useCallback(
    async (input: api.NewLead): Promise<string | null> => {
      const result = await api.createLead(input);
      if (!result.ok) {
        notify(result.error);
        return null;
      }

      const now = new Date().toISOString();
      const accounts = input.accounts.filter((a) => a.handle.trim());

      setWs((current) => ({
        ...current,
        leads: [
          ...current.leads,
          {
            id: result.data.id,
            name: input.name.trim(),
            handle: accounts[0]?.handle.trim() ?? "",
            platform: accounts[0]?.platform ?? "",
            audience: "",
            stage: input.stage as StageId,
            stageEnteredAt: now,
            touches: 0,
            quotedValueCents: null,
            notes: "",
            email: "",
            phone: "",
            sourceId: input.sourceId ?? null,
            lostReason: null,
            packageId: null,
            addonIds: [],
            tagIds: [],
            socials: accounts.map((a, i) => ({
              id: tempId(),
              platform: a.platform,
              handle: a.handle.trim(),
              sort: i,
            })),
            history: [],
            createdAt: now,
          },
        ],
      }));

      notify("Lead added · clock started");
      return result.data.id;
    },
    [notify]
  );

  /**
   * Deletes a lead outright.
   *
   * Everything hanging off it goes too - socials, tags, add-ons, touch history
   * and its stage-transition events - because the database cascades. That last
   * one is why this is for mistakes and duplicates, not for leads that went
   * nowhere: moving one to Dead Lead keeps the record of what happened, and
   * deleting it removes that lead from every month it ever contributed to.
   */
  const removeLead = useCallback(
    (leadId: string) => {
      // Close the drawer first - it renders from selectedId, and holding a
      // deleted id open would leave it blank until something else moved.
      setSelectedId((current) => (current === leadId ? null : current));

      commit(
        (current) => ({
          ...current,
          leads: current.leads.filter((l) => l.id !== leadId),
        }),
        () => api.deleteLead(leadId),
        "Lead deleted"
      );
    },
    [commit]
  );

  const setTag = useCallback(
    (leadId: string, tagId: string, on: boolean) => {
      commit(
        (current) =>
          mapLead(current, leadId, (lead) => ({
            ...lead,
            // Idempotent both ways: setting an already-set tag is a no-op.
            tagIds: on
              ? Array.from(new Set([...lead.tagIds, tagId]))
              : lead.tagIds.filter((id) => id !== tagId),
          })),
        () => api.setLeadTag(leadId, tagId, on)
      );
    },
    [commit]
  );

  const setAddon = useCallback(
    (leadId: string, addonId: string, on: boolean) => {
      commit(
        (current) =>
          mapLead(current, leadId, (lead) => ({
            ...lead,
            addonIds: on
              ? Array.from(new Set([...lead.addonIds, addonId]))
              : lead.addonIds.filter((id) => id !== addonId),
          })),
        () => api.setLeadAddon(leadId, addonId, on)
      );
    },
    [commit]
  );

  const addSocial = useCallback(
    (leadId: string) => {
      const lead = ws.leads.find((l) => l.id === leadId);
      if (!lead) return;

      const platform = ws.platforms[0]?.name ?? "YouTube";
      const sort = lead.socials.length;
      const placeholder = tempId();

      setWs((current) =>
        mapLead(current, leadId, (l) => ({
          ...l,
          socials: [...l.socials, { id: placeholder, platform, handle: "", sort }],
        }))
      );

      void api.addSocial(leadId, platform, "", sort).then((result) => {
        if (!result.ok) {
          setWs((current) =>
            mapLead(current, leadId, (l) => ({
              ...l,
              socials: l.socials.filter((s) => s.id !== placeholder),
            }))
          );
          notify(result.error);
          return;
        }
        // Swap the placeholder for the real id so later edits address the row
        // that actually exists in the database.
        setWs((current) =>
          mapLead(current, leadId, (l) => ({
            ...l,
            socials: l.socials.map((s) =>
              s.id === placeholder ? { ...s, id: result.data.id } : s
            ),
          }))
        );
      });
    },
    [ws.leads, ws.platforms, notify]
  );

  const patchSocial = useCallback(
    (
      leadId: string,
      socialId: string,
      patch: { platform?: string; handle?: string }
    ) => {
      commit(
        (current) => {
          const next = mapLead(current, leadId, (lead) => {
            const socials = lead.socials.map((s) =>
              s.id === socialId ? { ...s, ...patch } : s
            );
            const primary = socials.find((s) => s.sort === 0) ?? socials[0];
            return {
              ...lead,
              socials,
              // The list views read handle/platform off the lead, so the
              // primary account has to stay mirrored onto it.
              handle: primary?.handle ?? "",
              platform: primary?.platform ?? "",
            };
          });
          return next;
        },
        () => api.updateSocial(socialId, patch)
      );
    },
    [commit]
  );

  const removeSocial = useCallback(
    (leadId: string, socialId: string) => {
      commit(
        (current) =>
          mapLead(current, leadId, (lead) => {
            const socials = lead.socials.filter((s) => s.id !== socialId);
            const primary = socials[0];
            return {
              ...lead,
              socials,
              handle: primary?.handle ?? "",
              platform: primary?.platform ?? "",
            };
          }),
        () => api.removeSocial(socialId)
      );
    },
    [commit]
  );

  /* --- Settings ----------------------------------------------------------- */

  const settings = useMemo<Store["settings"]>(
    () => ({
      addTag: (name, color) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        void api.createTag(trimmed, color).then((result) => {
          if (!result.ok) return notify(result.error);
          setWs((current) => ({
            ...current,
            tags: [
              ...current.tags,
              {
                id: result.data.id,
                name: trimmed,
                color,
                sort: current.tags.length,
              },
            ],
          }));
        });
      },

      patchTag: (id, patch) =>
        commit(
          (current) => ({
            ...current,
            tags: current.tags.map((t) =>
              t.id === id ? { ...t, ...patch } : t
            ),
          }),
          () => api.updateTag(id, patch)
        ),

      removeTag: (id) =>
        commit(
          (current) => ({
            ...current,
            tags: current.tags.filter((t) => t.id !== id),
            // Deleting a tag strips it from every lead, matching the cascade
            // the database performs.
            leads: current.leads.map((l) => ({
              ...l,
              tagIds: l.tagIds.filter((t) => t !== id),
            })),
          }),
          () => api.deleteTag(id),
          "Tag deleted"
        ),

      addListItem: (table, name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        const sort = ws[table].length;
        void api.addListItem(table, trimmed, sort).then((result) => {
          if (!result.ok) return notify(result.error);
          setWs((current) => ({
            ...current,
            [table]: [
              ...current[table],
              { id: result.data.id, name: trimmed, sort },
            ],
          }));
        });
      },

      removeListItem: (table, id) =>
        commit(
          (current) => ({
            ...current,
            [table]: current[table].filter((x) => x.id !== id),
          }),
          () => api.removeListItem(table, id)
        ),

      addPriced: (table, name, priceCents) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        const sort = ws[table].length;
        void api.addPriced(table, trimmed, priceCents, sort).then((result) => {
          if (!result.ok) return notify(result.error);
          setWs((current) => ({
            ...current,
            [table]: [
              ...current[table],
              { id: result.data.id, name: trimmed, priceCents, sort },
            ],
          }));
        });
      },

      patchPriced: (table, id, patch) =>
        commit(
          (current) => ({
            ...current,
            [table]: current[table].map((x) =>
              x.id === id ? { ...x, ...patch } : x
            ),
          }),
          () => api.updatePriced(table, id, patch)
        ),

      removePriced: (table, id) =>
        commit(
          (current) => ({
            ...current,
            [table]: current[table].filter((x) => x.id !== id),
            leads: current.leads.map((l) => ({
              ...l,
              ...(table === "packages" && l.packageId === id
                ? { packageId: null }
                : {}),
              ...(table === "addons"
                ? { addonIds: l.addonIds.filter((a) => a !== id) }
                : {}),
            })),
          }),
          () => api.removePriced(table, id)
        ),

      patchStep: (stage, stepId, patch) =>
        commit(
          (current) => ({
            ...current,
            cadences: {
              ...current.cadences,
              [stage]: {
                ...current.cadences[stage],
                steps: current.cadences[stage].steps.map((s) =>
                  s.id === stepId ? { ...s, ...patch } : s
                ),
              },
            },
          }),
          () => api.updateCadenceStep(stepId, patch)
        ),

      addStep: (stage) => {
        const steps = ws.cadences[stage].steps;
        const day = steps.length ? steps[steps.length - 1].day + 7 : 7;
        const label = "New touch";
        void api.addCadenceStep(stage, day, label, steps.length).then((r) => {
          if (!r.ok) return notify(r.error);
          setWs((current) => ({
            ...current,
            cadences: {
              ...current.cadences,
              [stage]: {
                ...current.cadences[stage],
                steps: [
                  ...current.cadences[stage].steps,
                  { id: r.data.id, day, label },
                ],
              },
            },
          }));
        });
      },

      removeStep: (stage, stepId) =>
        commit(
          (current) => ({
            ...current,
            cadences: {
              ...current.cadences,
              [stage]: {
                ...current.cadences[stage],
                steps: current.cadences[stage].steps.filter(
                  (s) => s.id !== stepId
                ),
              },
            },
          }),
          () => api.removeCadenceStep(stepId)
        ),

      setDemoteDay: (stage, day) =>
        commit(
          (current) => ({
            ...current,
            cadences: {
              ...current.cadences,
              [stage]: { ...current.cadences[stage], demoteDay: day },
            },
          }),
          () => api.setDemoteDay(stage, day)
        ),
    }),
    [commit, notify, ws]
  );

  /* --- Calendar ----------------------------------------------------------- */

  const calendar = useMemo<Store["calendar"]>(
    () => ({
      book: (input) => {
        void api.createMeeting(input).then((result) => {
          if (!result.ok) return notify(result.error);
          setWs((current) => ({
            ...current,
            meetings: [
              ...current.meetings,
              { id: result.data.id, ...input },
            ],
          }));
          notify("Booked · pushed to CadenceDock");
        });
      },

      remove: (id) =>
        commit(
          (current) => ({
            ...current,
            meetings: current.meetings.filter((m) => m.id !== id),
          }),
          () => api.deleteMeeting(id),
          "Meeting removed"
        ),

      setAccount: (id, connected) =>
        commit(
          (current) => ({
            ...current,
            calendarAccounts: current.calendarAccounts.map((a) =>
              a.id === id ? { ...a, connected } : a
            ),
          }),
          () => api.setCalendarAccount(id, connected)
        ),

      setShared: (shared) =>
        commit(
          (current) => ({
            ...current,
            teamShare: { ...current.teamShare, shared },
          }),
          () => api.setTeamShare(shared),
          shared ? "Calendar shared with the team" : "Calendar set to private"
        ),
    }),
    [commit, notify]
  );

  const lead = useCallback(
    (id: string) => ws.leads.find((l) => l.id === id),
    [ws.leads]
  );

  const value = useMemo<Store>(
    () => ({
      ws,
      theme,
      toast,
      selectedId,
      setTheme,
      select: setSelectedId,
      notify,
      lead,
      logTouch,
      undoTouch,
      moveStage,
      applyDemotion,
      snooze,
      patchLead,
      addLead,
      removeLead,
      setTag,
      setAddon,
      addSocial,
      patchSocial,
      removeSocial,
      settings,
      calendar,
    }),
    [
      ws,
      theme,
      toast,
      selectedId,
      setTheme,
      notify,
      lead,
      logTouch,
      undoTouch,
      moveStage,
      applyDemotion,
      snooze,
      patchLead,
      addLead,
      removeLead,
      setTag,
      setAddon,
      addSocial,
      patchSocial,
      removeSocial,
      settings,
      calendar,
    ]
  );

  return <HubContext.Provider value={value}>{children}</HubContext.Provider>;
}
