# Upforce Hub

Internal CRM for Upforce Marketing. Tracks creator and business leads through a
six-stage pipeline where **every lead sits on a retarget clock**.

The idea the whole app is built around: when a lead enters a stage, that
stage's ladder schedules its retarget touches. When the ladder runs out, the
lead becomes due to demote — and Hub surfaces it for one-click approval rather
than moving it silently. A pipeline that empties itself quietly is worse than
no pipeline.

Next.js 14 (App Router) · Supabase (Postgres + Auth + RLS) · TypeScript ·
deployed on Vercel.

---

## Getting it running

### 1. Supabase

Create a project, then run the migrations in order from the SQL editor (or
`supabase db push` if you use the CLI):

```
supabase/migrations/0001_initial_schema.sql
supabase/migrations/0002_seed.sql
supabase/migrations/0003_history.sql
supabase/migrations/0004_contact_and_lost_reason.sql
supabase/migrations/0005_service_catalog.sql
supabase/migrations/0006_proposals.sql
```

`0005` holds edits to the proposal price sheet (Settings → Service catalog).
Without it the proposal builder still works on the built-in spreadsheet
prices; only saving new defaults needs it.

`0006` stores saved proposals under each lead. Without it the builder still
works, but only as a single draft in the browser.

`supabase/demo_data.sql` sits deliberately **outside** `migrations/`, so a fresh
migration run never plants sample leads into a real workspace. Run it by hand
when you want a populated environment to click around in.

`0001` is the schema, the trigger that creates a profile on signup, and RLS.
`0002` is the production taxonomy — cadences, packages, add-ons, platforms,
sources, tags — all of it required. `0003` adds pipeline history and needs the **pg_cron** extension — enable it first under
Database → Extensions, or let the `create extension` line in that file do it.

Then, in the Supabase dashboard:

- **Authentication → Providers** — enable Email, and enable Google if you want
  the "Continue with Google" button to work.
- **Authentication → URL Configuration** — add `<your-domain>/auth/callback`
  and `http://localhost:3000/auth/callback` as redirect URLs.
- **Authentication → Users** — invite the team. There is no public signup;
  everyone with an account sees the whole pipeline (see *Access model* below).

### 2. Environment

Copy `.env.example` to `.env.local` and fill in:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

Both are the publishable values — RLS is what protects the data, not the key.
`SUPABASE_SERVICE_ROLE_KEY` is listed in `.env.example` for future server-side
jobs; nothing currently reads it, so leave it unset until something does.

### 3. Local

```bash
npm install && npm run dev
```

### 4. Vercel

Import the repo, then add both `NEXT_PUBLIC_*` variables under **Settings →
Environment Variables** for Production *and* Preview. They are baked in at
build time, so adding one to an existing deployment does nothing until it
rebuilds. Middleware returns a plain-English 503 naming the missing variable
rather than a blank 500, so a misconfigured deploy tells you what it wants.

### Or: your own server

`HANDOVER.md` walks through running it on a VPS instead — Node, systemd,
nginx and HTTPS, plus the proxy headers without which every save fails.

---

## How it fits together

```
app/
  (app)/                  the signed-in app
    layout.tsx            loads the workspace once, hands it to the store
    actions.ts            every mutation, as server actions
    today|pipeline|leads|calendar|revenue|settings/
  sign-in/                password + Google
  auth/                   OAuth callback, sign-out, password reset

components/
  HubStore.tsx            the client store: optimistic state + persistence
  Shell.tsx               sidebar, header, search, drawer/modal hosts
  LeadDrawer.tsx          everything about one lead
  views/                  one file per screen

lib/
  stages.ts               the six stages: colour, definition, successor
  engine.ts               the retarget engine — pure, no I/O
  queries.ts              the single workspace read
  types.ts
  supabase/               server, browser and middleware clients
```

### The retarget engine

`lib/engine.ts` is the part worth reading first. It is pure, so the queue, the
board, the table and the drawer all compute "what does this lead owe next" the
same way — two screens disagreeing about when a touch is due is how a CRM
stops being trusted.

```
STAGE          COLOR     LADDER (days from stage entry)                    THEN
Cold Lead      #5B9BD5   7 · 37 · 67                                       → Dead (day 67)
Warm Lead      #E9A83B   7 · 14 · 21                                       → Cold (day 30)
Hot Lead       #F2683C   3 · 10                                            → Warm (day 30)
Converted      #3FBF7F   no clock
Reactivation   #C9A227   90 · 180 · 365 · 545                              → Dead (day 545)
Dead Lead      #6B6560   180 · 365                                         → closed
```

Two decisions hold this together:

**The clock is derived, never stored.** `leads.stage_entered_at` is the only
fact; days-in-stage, the next scheduled touch and whether a demotion is due are
computed at read time. A stored day counter would need a nightly job that can
silently stop running and leave every clock frozen at whatever it last wrote.

**Cadences are data.** They live in `cadences` / `cadence_steps` and are edited
in Settings → Automations. Because the next touch is computed from the ladder
rather than materialised, moving day 7 to day 5 reschedules every Warm lead the
moment you save — no backfill.

**Demotions are never automatic.** When a ladder is exhausted the lead appears
under "Stage transitions pending" on Today with an Apply button. This is a
deliberate product choice carried over from the design; if the client would
rather it fire automatically, `applyDemotion` in `HubStore.tsx` is the hook.

### Pricing

Leads carry **one package plus any number of add-ons**:

| Package | Monthly |
| --- | --- |
| Gaming & Content Creators | $600 |
| Business & Podcast | $750 |
| Gambling Creators | $1,250 |

Add-ons (animated graphics, stream overlays, branding, in-person events,
affiliate funnels, website development, affiliate cross-checker, sponsorship
offers) seed at **$0** because their rates have not been set. They still attach
to leads and show on the Revenue page's attach table — set the prices in
Settings and every MRR figure updates.

A lead's MRR is package + add-ons, unless **Quoted value override** is set in
the drawer, in which case that wins. Clearing the override hands the number
back to the rate card.

Revenue reports value at face, with no probability weighting — Active MRR is
what converted clients pay, Pipeline MRR is what everything still live would
pay. Judging how much of the pipeline will actually land is left to the team
rather than baked into a number.

### History

Everything else in the app is computed from current state, which answers
today's question and no other. Two tables record the past instead.

**`stage_events`** is an append-only log of every stage change, written by a
trigger on `leads` as it happens. It carries the lead's MRR *at the moment it
moved*, so a September transition keeps September's price rather than being
silently repriced by a later edit in Settings. It has a read policy and no
write policy — the trigger is `SECURITY DEFINER`, and nothing can write to the
log by hand. This is the part that cannot be backfilled: it only ever knows
what happened after it existed.

**`monthly_snapshots`** holds one row per closed month, written by `pg_cron` at
00:05 UTC on the 1st via `capture_month()`. Re-running a capture corrects that
month rather than duplicating it.

One honest limitation: a snapshot's MRR figures are state as it stood *when the
capture ran*, attributed to the month named. Run on the 1st, that is a faithful
picture of how the month ended; run against a month from a year ago and you get
today's numbers under an old label. Reconstructing historical MRR exactly would
need package price history, which is deliberately out of scope. The `won_count`
and `lost_count` columns carry no such caveat — they are counted from
`stage_events` inside the month and are exact.

To close a month by hand, or check the schedule:

```sql
select capture_month();                    -- close last month
select capture_month(date '2026-09-01');   -- close a named month
select * from cron.job where jobname = 'upforce-close-month';
```

### State and the stale-read trap

The server sends one consistent snapshot of the workspace; the client store
holds it for the session and mutations are optimistic — apply locally, persist,
roll back with a toast on failure.

Two rules keep that honest, both carried over from the prototype where toggles
derived from stale reads were the single largest source of bugs:

1. A mutator closes over **stable identifiers only** and resolves its target
   *inside* the state updater. Reading a lead out of state before calling
   `setState` returns render-time data, which during a burst of clicks is not
   what is there now.
2. Writes are **idempotent**. Tag and add-on chips are real checkboxes, so the
   desired boolean arrives on the event rather than being derived from a
   snapshot that may already be wrong.

### Access model

Everyone signed in sees and edits the whole pipeline. Upforce is a small team
working a shared funnel, and partitioning leads per rep would make the daily
queue useless. RLS therefore gates on *is authenticated*, not on ownership —
`leads.owner_id` exists in the schema for when assignment is added, but nothing
reads it yet.

### Design system

All colour is CSS custom properties in `app/globals.css` — a single ramp
(`--t0` darkest surface through `--t40` brightest ink) plus semantic hues. Light
mode redefines the same names, which is why the theme toggle is one attribute on
`<html>` and a 300ms cross-fade. The theme is stored in a cookie so the server
paints the first frame in the right palette.

Brand hues stay constant across themes; only their *ink* darkens
(`ink()` in `lib/engine.ts`). Known hues get hand-picked light values, anything
else — a tag the user coloured themselves — falls back to a 52% darkener.

Fonts are self-hosted via `next/font`: Poppins (headings, numerals), DM Sans
(body), JetBrains Mono (micro-labels, metrics).

---

## What is not built

Carried forward from the design handoff, plus what this port did not cover:

- **CadenceDock is UI-only.** The connect toggles, share link and "Book & sync"
  write to our own tables. No API is wired, and no provider tokens are stored —
  `calendar_accounts` deliberately holds connection state only.
- **Nothing is actually sent.** The compose sheet records outreach; it does not
  deliver it. The button says "Mark sent" for that reason.
- **Add-on prices are unset** (see above).
- **Not started:** lead owner assignment, contact details (email/phone), bulk
  actions, do-not-contact flag, churn and lost-MRR tracking.
- **Duplicate detection** is a warning on the Add lead modal only — it checks
  handles against existing leads and lets you proceed, since two creators can
  legitimately share a handle across platforms.

