-- =========================================================
-- Migration 001 — hardening pass
--
-- For databases created from the ORIGINAL schema.sql. Safe to re-run.
-- (Fresh project? Run schema.sql instead — it already contains all this.)
--
-- What it does:
--   * businesses: adds state_code + default_sac_code (needed for IGST vs
--     CGST+SGST), one business per login, format checks on GSTIN/PAN/IFSC
--   * clients: adds state_code, one client per name per business
--   * invoices: adds invoice_date, place_of_supply_code and stored
--     CGST/SGST/IGST amounts (backfilled), removes the browser's ability
--     to INSERT invoices, makes issued invoices immutable
--   * adds create_invoice() (atomic, gap-free numbering per financial
--     year), invoice_counters, rate_limits + check_rate_limit()
--
-- Existing invoice numbers (e.g. INV-2026-0001) are left untouched. New
-- invoices use PREFIX/FY/SEQ (INV/2627/0001), counted from 0001.
--
-- AFTER RUNNING: open Dashboard → Settings and set your business state or
-- GSTIN. Until then new invoices are refused (on purpose).
-- =========================================================

begin;

-- Drop the immutability trigger first so the backfills below can write.
drop trigger if exists trg_protect_issued_invoice on invoices;

-- ---------------------------------------------------------
-- businesses
-- ---------------------------------------------------------
alter table businesses add column if not exists state_code text;
alter table businesses add column if not exists default_sac_code text not null default '998311';

-- Make legacy prefixes fit the new ≤5-char rule.
update businesses
   set invoice_prefix = coalesce(
         nullif(left(regexp_replace(coalesce(invoice_prefix, ''), '[^A-Za-z0-9-]', '', 'g'), 5), ''),
         'INV')
 where invoice_prefix is null
    or invoice_prefix !~ '^[A-Za-z0-9-]{1,5}$';
alter table businesses alter column invoice_prefix set default 'INV';
alter table businesses alter column invoice_prefix set not null;

-- Derive state from an already-saved GSTIN.
update businesses
   set state_code = substr(gstin, 1, 2)
 where state_code is null
   and gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$';

-- One business per login. If this fails you have duplicate owners:
--   select owner_auth_id, count(*) from businesses group by 1 having count(*) > 1;
create unique index if not exists uq_businesses_owner on businesses (owner_auth_id);

-- ---------------------------------------------------------
-- clients
-- ---------------------------------------------------------
alter table clients add column if not exists state_code text;
alter table clients add column if not exists gstin text;

do $$
begin
  if exists (select 1 from clients group by business_id, lower(name) having count(*) > 1) then
    raise exception 'Duplicate client names exist (same name, different capitalisation, same business). Merge them, then re-run. Find them with: select business_id, lower(name), count(*) from clients group by 1,2 having count(*) > 1;';
  end if;
end $$;
create unique index if not exists uq_clients_business_name on clients (business_id, lower(name));

-- ---------------------------------------------------------
-- invoices
-- ---------------------------------------------------------
alter table invoices add column if not exists invoice_date date;
alter table invoices add column if not exists place_of_supply_code text;
alter table invoices add column if not exists cgst_amount numeric(12,2);
alter table invoices add column if not exists sgst_amount numeric(12,2);
alter table invoices add column if not exists igst_amount numeric(12,2);

update invoices
   set invoice_date = (created_at at time zone 'Asia/Kolkata')::date
 where invoice_date is null;
alter table invoices alter column invoice_date set default ((now() at time zone 'Asia/Kolkata')::date);
alter table invoices alter column invoice_date set not null;

-- Backfill stored tax amounts from the saved totals, so that
-- total = taxable + cgst + sgst + igst holds exactly for old rows too.
update invoices i
   set igst_amount = v.igst,
       cgst_amount = v.cgst,
       sgst_amount = v.rest - v.cgst
  from (
    select id,
           round(taxable_value * coalesce(igst_rate, 0) / 100, 2) as igst,
           (total_value - taxable_value
              - round(taxable_value * coalesce(igst_rate, 0) / 100, 2)) as rest,
           case when coalesce(cgst_rate, 0) + coalesce(sgst_rate, 0) = 0 then 0
                else round(
                  (total_value - taxable_value
                     - round(taxable_value * coalesce(igst_rate, 0) / 100, 2))
                  * coalesce(cgst_rate, 0)
                  / (coalesce(cgst_rate, 0) + coalesce(sgst_rate, 0)), 2)
           end as cgst
      from invoices
     where cgst_amount is null
  ) v
 where i.id = v.id;

alter table invoices alter column cgst_amount set default 0;
alter table invoices alter column sgst_amount set default 0;
alter table invoices alter column igst_amount set default 0;
alter table invoices alter column cgst_amount set not null;
alter table invoices alter column sgst_amount set not null;
alter table invoices alter column igst_amount set not null;

update invoices set cgst_rate = coalesce(cgst_rate, 0), sgst_rate = coalesce(sgst_rate, 0), igst_rate = coalesce(igst_rate, 0);
alter table invoices alter column cgst_rate set default 0;
alter table invoices alter column sgst_rate set default 0;
alter table invoices alter column igst_rate set default 0;
alter table invoices alter column cgst_rate set not null;
alter table invoices alter column sgst_rate set not null;
alter table invoices alter column igst_rate set not null;

-- The old default 'unpaid' wasn't even allowed by the status check.
alter table invoices alter column status set default 'draft';

create index if not exists idx_invoices_business_created on invoices (business_id, created_at desc);

-- Format / consistency checks. NOT VALID = enforced for new and updated
-- rows, without failing on messy legacy data. Once your data is clean:
--   alter table <t> validate constraint <name>;
do $$
declare c record;
begin
  for c in select * from (values
    ('businesses', 'businesses_state_code_check', 'check (state_code ~ ''^[0-9]{2}$'')'),
    ('businesses', 'businesses_gstin_check',      'check (gstin ~ ''^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'')'),
    ('businesses', 'businesses_pan_check',        'check (pan ~ ''^[A-Z]{5}[0-9]{4}[A-Z]$'')'),
    ('businesses', 'businesses_ifsc_check',       'check (ifsc ~ ''^[A-Z]{4}0[A-Z0-9]{6}$'')'),
    ('businesses', 'businesses_invoice_prefix_check', 'check (invoice_prefix ~ ''^[A-Za-z0-9-]{1,5}$'')'),
    ('businesses', 'businesses_default_sac_code_check', 'check (default_sac_code ~ ''^[0-9]{4,8}$'')'),
    ('clients',    'clients_state_code_check',    'check (state_code ~ ''^[0-9]{2}$'')'),
    ('clients',    'clients_gstin_check',         'check (gstin ~ ''^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'')'),
    ('invoices',   'invoices_total_matches_check','check (total_value = taxable_value + cgst_amount + sgst_amount + igst_amount)')
  ) as t(tbl, cname, def)
  loop
    if not exists (
      select 1 from pg_constraint
       where conname = c.cname and conrelid = ('public.' || c.tbl)::regclass
    ) then
      execute format('alter table public.%I add constraint %I %s not valid', c.tbl, c.cname, c.def);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------
-- new tables
-- ---------------------------------------------------------
create table if not exists invoice_counters (
  business_id uuid not null references businesses(id) on delete cascade,
  fy text not null,
  last_number integer not null default 0,
  primary key (business_id, fy)
);

create table if not exists rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);

alter table invoice_counters enable row level security;
alter table rate_limits enable row level security;
alter table telegram_link_codes enable row level security;
alter table telegram_pending enable row level security;

-- ---------------------------------------------------------
-- policies
-- ---------------------------------------------------------
-- Browsers must not insert invoices: only create_invoice() may.
drop policy if exists "Tenant can insert own invoices" on invoices;

drop policy if exists "Tenant can insert own payments" on payments;
create policy "Tenant can insert own payments"
  on payments for insert
  with check (
    business_id in (select id from businesses where owner_auth_id = auth.uid())
    and exists (
      select 1 from invoices i
      where i.id = payments.invoice_id and i.business_id = payments.business_id
    )
  );

-- =========================================================
-- AUTO-CREATE A BUSINESS ON SIGN-UP
-- SECURITY DEFINER lets it work even before the user has a session
-- (e.g. when email confirmation is on).
-- =========================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.businesses (owner_auth_id, name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'business_name', ''), 'My Business')
  )
  on conflict (owner_auth_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================================
-- ISSUED INVOICES ARE IMMUTABLE
-- Once an invoice leaves 'draft', its numbers and parties can't be
-- changed — not even by the owner through the browser. Allowed: status,
-- due_date, pdf_url. A mistake means cancel + re-issue (or, later, a
-- credit note), which is what GST expects.
-- =========================================================
create or replace function public.protect_issued_invoice()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'draft' then
    return new;
  end if;
  if new.business_id          is distinct from old.business_id
  or new.client_id            is distinct from old.client_id
  or new.invoice_number       is distinct from old.invoice_number
  or new.invoice_date         is distinct from old.invoice_date
  or new.description          is distinct from old.description
  or new.sac_code             is distinct from old.sac_code
  or new.taxable_value        is distinct from old.taxable_value
  or new.cgst_rate            is distinct from old.cgst_rate
  or new.sgst_rate            is distinct from old.sgst_rate
  or new.igst_rate            is distinct from old.igst_rate
  or new.cgst_amount          is distinct from old.cgst_amount
  or new.sgst_amount          is distinct from old.sgst_amount
  or new.igst_amount          is distinct from old.igst_amount
  or new.total_value          is distinct from old.total_value
  or new.place_of_supply      is distinct from old.place_of_supply
  or new.place_of_supply_code is distinct from old.place_of_supply_code
  then
    raise exception 'Issued invoices cannot be edited. Cancel it and issue a new one.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_issued_invoice on invoices;
create trigger trg_protect_issued_invoice
  before update on invoices
  for each row execute function public.protect_issued_invoice();

-- =========================================================
-- create_invoice(): allocate the number AND insert, atomically
-- Number format: PREFIX/FY/SEQ, e.g. INV/2627/0001 (≤ 16 chars, as GST
-- requires). The counter row is locked by the upsert, so concurrent
-- requests queue up; if the insert fails the counter rolls back too, so
-- there are no gaps from failed attempts.
-- Callable only with the service-role key.
-- =========================================================
create or replace function public.create_invoice(
  p_business_id uuid,
  p_client_id uuid,
  p_description text,
  p_sac_code text,
  p_taxable numeric,
  p_cgst_rate numeric,
  p_sgst_rate numeric,
  p_igst_rate numeric,
  p_cgst numeric,
  p_sgst numeric,
  p_igst numeric,
  p_total numeric,
  p_pos_code text,
  p_pos_name text,
  p_due_date date
)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_today date;
  v_fy text;
  v_n integer;
  v_number text;
  v_row public.invoices;
begin
  select invoice_prefix into v_prefix from businesses where id = p_business_id;
  if not found then
    raise exception 'business not found' using errcode = 'P0002';
  end if;

  perform 1 from clients where id = p_client_id and business_id = p_business_id;
  if not found then
    raise exception 'client does not belong to this business' using errcode = 'P0002';
  end if;

  if p_taxable <= 0
     or abs((p_taxable + p_cgst + p_sgst + p_igst) - p_total) > 0.005 then
    raise exception 'invoice totals do not add up' using errcode = '22023';
  end if;

  v_today := (now() at time zone 'Asia/Kolkata')::date;
  v_fy := case
    when extract(month from v_today) >= 4
      then to_char(v_today, 'YY') || to_char(v_today + interval '1 year', 'YY')
    else to_char(v_today - interval '1 year', 'YY') || to_char(v_today, 'YY')
  end;

  insert into invoice_counters (business_id, fy, last_number)
  values (p_business_id, v_fy, 1)
  on conflict (business_id, fy)
    do update set last_number = invoice_counters.last_number + 1
  returning last_number into v_n;

  v_number := v_prefix || '/' || v_fy || '/' ||
    case when v_n < 10000 then lpad(v_n::text, 4, '0') else v_n::text end;

  insert into invoices (
    business_id, client_id, invoice_number, invoice_date, description, sac_code,
    taxable_value, cgst_rate, sgst_rate, igst_rate,
    cgst_amount, sgst_amount, igst_amount, total_value,
    place_of_supply, place_of_supply_code, due_date, status
  ) values (
    p_business_id, p_client_id, v_number, v_today, p_description, p_sac_code,
    p_taxable, p_cgst_rate, p_sgst_rate, p_igst_rate,
    p_cgst, p_sgst, p_igst, p_total,
    p_pos_name, p_pos_code, p_due_date, 'sent'
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.create_invoice(uuid, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, text, date)
  from public, anon, authenticated;
grant execute on function public.create_invoice(uuid, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, text, date)
  to service_role;

-- =========================================================
-- check_rate_limit(): fixed-window counter. Returns true while the
-- caller is still under p_max hits in the current window.
-- =========================================================
create or replace function public.check_rate_limit(
  p_key text,
  p_max integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz;
  v_hits integer;
begin
  if p_window_seconds is null or p_window_seconds <= 0 then
    raise exception 'window must be positive' using errcode = '22023';
  end if;

  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into rate_limits (key, window_start, hits)
  values (p_key, v_window, 1)
  on conflict (key, window_start)
    do update set hits = rate_limits.hits + 1
  returning hits into v_hits;

  -- Occasional housekeeping so the table doesn't grow forever.
  if random() < 0.01 then
    delete from rate_limits where window_start < now() - interval '2 days';
  end if;

  return v_hits <= p_max;
end;
$$;

revoke all on function public.check_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer)
  to service_role;

commit;
