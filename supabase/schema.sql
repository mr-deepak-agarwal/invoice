-- =========================================================
-- Bahi — multi-tenant Supabase schema (FRESH INSTALL)
--
-- Run this once in the Supabase SQL editor on a new project.
-- Already have a database from an earlier version? Don't run this —
-- run supabase/migrations/001_hardening.sql instead.
-- =========================================================

-- =========================================================
-- 1. BUSINESSES (tenant root — one row per registered company/user)
-- =========================================================
create table businesses (
  id uuid primary key default gen_random_uuid(),
  owner_auth_id uuid unique references auth.users(id) on delete cascade, -- Supabase Auth user (web login)
  name text not null,
  address text,
  -- GST state code (first two digits of a GSTIN, e.g. 08 = Rajasthan).
  -- Decides CGST+SGST vs IGST, so invoices can't be created without it.
  state_code text check (state_code ~ '^[0-9]{2}$'),
  gstin text check (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  pan text check (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  phone text,
  email text,
  bank_name text,
  account_number text,
  ifsc text check (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  logo_url text,
  -- GST rules cap an invoice number at 16 characters: PREFIX/2627/0001
  invoice_prefix text not null default 'INV' check (invoice_prefix ~ '^[A-Za-z0-9-]{1,5}$'),
  default_sac_code text not null default '998311' check (default_sac_code ~ '^[0-9]{4,8}$'),
  -- false = not registered for GST: invoices carry no tax and need no state.
  gst_registered boolean not null default true,
  -- Defaults that save typing. NULL / false = always ask (the safe default).
  -- default_due_days: 0 = due on receipt, 7 = one week, ...
  default_due_days integer check (default_due_days between 0 and 365),
  -- true = if a message doesn't say where the client is, assume the
  -- client is in the same state as you (the review screen says so).
  assume_local_supply boolean not null default false,
  -- UPI ID (VPA) shown on the public payment page and in reminders.
  upi_id text check (upi_id ~ '^[a-zA-Z0-9._-]{2,255}@[a-zA-Z]{2,64}$'),
  created_at timestamptz default now()
);

-- =========================================================
-- 2. IDENTITIES (maps external channel identity -> business)
-- Lets the same business be reached via Telegram, WhatsApp, or Web login
-- =========================================================
create table identities (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  channel text not null check (channel in ('telegram', 'whatsapp', 'web')),
  channel_identifier text not null, -- telegram chat_id, whatsapp phone number, or auth_id
  created_at timestamptz default now(),
  unique (channel, channel_identifier)
);

create index idx_identities_lookup on identities (channel, channel_identifier);

-- =========================================================
-- 3. CLIENTS (customers of a business, scoped per tenant)
-- =========================================================
create table clients (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  address text,
  gstin text check (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  state_code text check (state_code ~ '^[0-9]{2}$'),
  created_at timestamptz default now()
);

create index idx_clients_business on clients (business_id);
-- One client per name per business (case-insensitive). Stops duplicates
-- when two requests create the same new client at once.
create unique index uq_clients_business_name on clients (business_id, lower(name));

-- =========================================================
-- 4. INVOICES
-- =========================================================
create table invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  client_id uuid not null references clients(id) on delete restrict,
  invoice_number text not null,
  invoice_date date not null default ((now() at time zone 'Asia/Kolkata')::date),
  description text default 'Professional Services',
  sac_code text default '998311',
  taxable_value numeric(12,2) not null,
  cgst_rate numeric(5,2) not null default 0,
  sgst_rate numeric(5,2) not null default 0,
  igst_rate numeric(5,2) not null default 0,
  cgst_amount numeric(12,2) not null default 0,
  sgst_amount numeric(12,2) not null default 0,
  igst_amount numeric(12,2) not null default 0,
  total_value numeric(12,2) not null,
  place_of_supply text,       -- e.g. "Goa"
  place_of_supply_code text,  -- e.g. "30"
  due_date date not null,
  status text not null default 'draft' check (status in ('draft','sent','paid','overdue','cancelled')),
  pdf_url text,
  -- Unguessable key for the public /pay/<token> page (64 hex chars).
  public_token text not null unique
    default (replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
    check (public_token ~ '^[a-f0-9]{64}$'),
  created_at timestamptz default now(),
  unique (business_id, invoice_number),
  check (total_value = taxable_value + cgst_amount + sgst_amount + igst_amount)
);

create index idx_invoices_business on invoices (business_id, created_at desc);
create index idx_invoices_status on invoices (business_id, status);
create index idx_invoices_due_date on invoices (due_date);

-- =========================================================
-- 5. INVOICE_COUNTERS (gap-free numbering per business per financial year)
-- =========================================================
create table invoice_counters (
  business_id uuid not null references businesses(id) on delete cascade,
  fy text not null,                 -- '2627' = April 2026 .. March 2027
  last_number integer not null default 0,
  primary key (business_id, fy)
);

-- =========================================================
-- 6. PAYMENTS (supports partial payments / reconciliation)
-- =========================================================
create table payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  amount numeric(12,2) not null,
  method text, -- upi, bank_transfer, cash, razorpay
  reference text,
  paid_at timestamptz default now()
);

create index idx_payments_invoice on payments (invoice_id);

-- =========================================================
-- 7. MESSAGES_LOG (avoid duplicate reminders, audit trail)
-- =========================================================
create table messages_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  invoice_id uuid references invoices(id) on delete set null,
  channel text not null check (channel in ('telegram','whatsapp','email')),
  message_type text not null, -- reminder_upcoming, reminder_due, reminder_overdue, invoice_sent
  sent_at timestamptz default now()
);

create index idx_messages_log_invoice on messages_log (invoice_id, message_type);

-- =========================================================
-- 8. TELEGRAM BOT TABLES
-- =========================================================

-- One-time codes that connect a Telegram chat to a business.
-- Created from the dashboard's Telegram page; valid for 15 minutes.
create table telegram_link_codes (
  code text primary key,
  business_id uuid not null references businesses(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);
create index idx_telegram_link_codes_business on telegram_link_codes (business_id);

-- Invoices waiting for the "Create invoice" button in Telegram.
create table telegram_pending (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  chat_id text not null,
  payload jsonb not null,
  created_at timestamptz default now()
);

-- =========================================================
-- 9. RATE LIMITS (caps paid work such as Gemini calls per business)
-- =========================================================
create table rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);

-- =========================================================
-- ROW LEVEL SECURITY
-- =========================================================
alter table businesses enable row level security;
alter table identities enable row level security;
alter table clients enable row level security;
alter table invoices enable row level security;
alter table invoice_counters enable row level security;
alter table payments enable row level security;
alter table messages_log enable row level security;
alter table telegram_link_codes enable row level security;
alter table telegram_pending enable row level security;
alter table rate_limits enable row level security;
-- (The last four tables and invoice_counters have NO policies on purpose:
--  browsers get no access at all; only the server's service-role key.)

create policy "Owners can view their business"
  on businesses for select
  using (owner_auth_id = auth.uid());

create policy "Owners can update their business"
  on businesses for update
  using (owner_auth_id = auth.uid());

create policy "Tenant can view own identities"
  on identities for select
  using (business_id in (select id from businesses where owner_auth_id = auth.uid()));

create policy "Tenant can view own clients"
  on clients for select
  using (business_id in (select id from businesses where owner_auth_id = auth.uid()));

create policy "Tenant can insert own clients"
  on clients for insert
  with check (business_id in (select id from businesses where owner_auth_id = auth.uid()));

create policy "Tenant can update own clients"
  on clients for update
  using (business_id in (select id from businesses where owner_auth_id = auth.uid()));

create policy "Tenant can view own invoices"
  on invoices for select
  using (business_id in (select id from businesses where owner_auth_id = auth.uid()));

-- NOTE: there is intentionally NO insert policy on invoices. Invoices are
-- created only by the server through create_invoice(), which assigns the
-- number and checks the tax maths. Browsers can read and update (status /
-- due date only — see the trigger below) but never insert.

create policy "Tenant can update own invoices"
  on invoices for update
  using (business_id in (select id from businesses where owner_auth_id = auth.uid()));

create policy "Tenant can view own payments"
  on payments for select
  using (business_id in (select id from businesses where owner_auth_id = auth.uid()));

create policy "Tenant can insert own payments"
  on payments for insert
  with check (
    business_id in (select id from businesses where owner_auth_id = auth.uid())
    and exists (
      select 1 from invoices i
      where i.id = payments.invoice_id and i.business_id = payments.business_id
    )
  );

create policy "Tenant can view own messages_log"
  on messages_log for select
  using (business_id in (select id from businesses where owner_auth_id = auth.uid()));

-- NOTE: the Next.js API routes use the Supabase SERVICE ROLE key for
-- Telegram/WhatsApp-triggered writes (bots have no auth.uid()), which
-- bypasses RLS by design. RLS above protects the WEB DASHBOARD's direct
-- Supabase client access. Never expose the service role key to the browser.

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
