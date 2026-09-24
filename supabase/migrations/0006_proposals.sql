-- Upforce Hub - saved proposals
--
-- A proposal built in the proposal builder, kept under the lead (creator) it
-- was written for. The whole proposal - creator details, lines, overrides,
-- terms - is one jsonb document, because it is only ever read and written
-- whole by the builder and its shape changes with the builder, not with
-- anything a query needs to filter on.
--
-- What lists and reports do need is pulled out into real columns: the title,
-- where it stands (status) and what it is worth (monthly and one-time totals).
-- Those are written from the same save, so they can never disagree with the
-- document they summarise.
--
-- lead_id is `on delete set null`, not cascade: deleting a lead should not
-- silently take a signed proposal with it.

create table if not exists proposals (
  id               uuid primary key default gen_random_uuid(),
  lead_id          uuid references leads on delete set null,
  title            text not null default '',
  status           text not null default 'draft'
                   check (status in ('draft', 'sent', 'signed', 'declined')),
  data             jsonb not null,
  monthly_cents    integer not null default 0,
  one_time_cents   integer not null default 0,
  created_by       uuid references auth.users on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists proposals_lead_id_idx on proposals (lead_id);

alter table proposals enable row level security;

-- Same rule as every other table: the workspace is shared.
create policy proposals_member_all on proposals
  for all to authenticated using (true) with check (true);
