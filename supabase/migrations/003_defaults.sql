-- =========================================================
-- Migration 003 — saved defaults (due date, local place of supply)
-- Run AFTER 001 and 002. Safe to re-run. Changes nothing for existing
-- users until they switch the defaults on in Settings.
-- =========================================================
begin;
alter table businesses add column if not exists default_due_days integer
  check (default_due_days between 0 and 365);
alter table businesses add column if not exists assume_local_supply boolean not null default false;
commit;
