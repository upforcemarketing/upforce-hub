-- Adds a plain contact record (email, phone) and a captured reason for why a
-- lead was marked Dead. Neither is used by any automation - email/phone are
-- for reference only, and lost_reason is set once, at the moment a lead moves
-- to Dead Lead, by whoever approves the move.

alter table leads add column if not exists email text;
alter table leads add column if not exists phone text;
alter table leads add column if not exists lost_reason text;
