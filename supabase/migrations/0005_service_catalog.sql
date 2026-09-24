-- Upforce Hub - service catalog defaults
--
-- The proposal builder's price sheet (Gaming, Gambling, Business) ships in
-- code, transcribed from the pricing spreadsheet. This table holds the team's
-- edits to it, and nothing else.
--
-- One row per (category, service) that differs from the sheet:
--
--   * a row whose service_id exists in code replaces that service outright -
--     price, cost, wording, the lot. Deleting the row is "reset to sheet".
--   * a row whose service_id does not exist in code is a service added from
--     Settings (is_custom). Deleting it removes the service.
--   * hidden keeps a service off new proposals without losing its price.
--
-- Storing only the differences means a sheet default nobody has touched is
-- never frozen into the database, and "what did we change" is one select.
--
-- Proposals snapshot prices when a service is added, so editing a default
-- here never rewrites a proposal that has already been drafted.

create table if not exists service_catalog (
  category      text not null check (category in ('gaming', 'gambling', 'business')),
  service_id    text not null,
  group_name    text not null default '',
  name          text not null,
  description   text not null default '',
  deliverables  text not null default '',
  turnaround    text not null default '',
  price_cents   integer not null default 0 check (price_cents >= 0),
  cost_cents    integer not null default 0 check (cost_cents >= 0),
  billing       text not null default 'one-time' check (billing in ('monthly', 'one-time')),
  unit          text not null default 'unit',
  is_custom     boolean not null default false,
  hidden        boolean not null default false,
  sort          integer not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (category, service_id)
);

alter table service_catalog enable row level security;

-- Same rule as every other table: the workspace is shared.
create policy service_catalog_member_all on service_catalog
  for all to authenticated using (true) with check (true);
