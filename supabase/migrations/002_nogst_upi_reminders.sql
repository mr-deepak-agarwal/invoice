-- =========================================================
-- Migration 002 — no-GST mode, UPI ID, public payment links
-- Run AFTER 001_hardening.sql. Safe to re-run.
--
--   * businesses.gst_registered (default true — nothing changes for
--     existing users) and businesses.upi_id
--   * invoices.public_token: unguessable key for /pay/<token>;
--     backfilled for existing invoices
-- =========================================================
begin;

alter table businesses add column if not exists gst_registered boolean not null default true;
alter table businesses add column if not exists upi_id text;

-- (Re)create the format check. Dropped first so a re-run always ends up
-- with the current definition.
alter table businesses drop constraint if exists businesses_upi_id_check;
alter table businesses add constraint businesses_upi_id_check
  check (upi_id ~ '^[a-zA-Z0-9._-]{2,255}@[a-zA-Z]{2,64}$') not valid;

-- The immutability trigger doesn't cover public_token, but drop/recreate
-- is not needed: this only touches a column the trigger ignores.
alter table invoices add column if not exists public_token text;
update invoices
   set public_token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
 where public_token is null;
alter table invoices alter column public_token
  set default (replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));
alter table invoices alter column public_token set not null;

create unique index if not exists uq_invoices_public_token on invoices (public_token);

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'invoices_public_token_check'
                    and conrelid = 'public.invoices'::regclass) then
    alter table invoices add constraint invoices_public_token_check
      check (public_token ~ '^[a-f0-9]{64}$');
  end if;
end $$;

commit;
