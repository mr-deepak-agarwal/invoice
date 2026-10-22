-- =========================================================
-- Invoice App: Multi-tenant Supabase Schema
-- Run this in Supabase SQL editor (or via CLI migration)
-- =========================================================

-- Extensions
create extension if not exists "uuid-ossp";

-- =========================================================
-- 1. BUSINESSES (tenant root — one row per registered company/user)
-- =========================================================
create table businesses (
  id uuid primary key default uuid_generate_v4(),
  owner_auth_id uuid references auth.users(id) on delete cascade, -- Supabase Auth user (web login)
  name text not null,
  address text,
  gstin text,
  pan text,
  phone text,
  email text,
  bank_name text,
  account_number text,
  ifsc text,
  logo_url text,
  invoice_prefix text default 'INV',
  created_at timestamptz default now()
);

-- =========================================================
-- 2. IDENTITIES (maps external channel identity -> business)
-- Lets the same business be reached via Telegram, WhatsApp, or Web login
-- =========================================================
create table identities (
  id uuid primary key default uuid_generate_v4(),
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
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  address text,
  gstin text,
  created_at timestamptz default now()
);

create index idx_clients_business on clients (business_id);

-- =========================================================
-- 4. INVOICES
-- =========================================================
create table invoices (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references businesses(id) on delete cascade,
  client_id uuid not null references clients(id) on delete restrict,
  invoice_number text not null,
  description text default 'Professional Services',
  sac_code text default '998311',
  taxable_value numeric(12,2) not null,
  cgst_rate numeric(5,2) default 9.00,
  sgst_rate numeric(5,2) default 9.00,
  igst_rate numeric(5,2) default 0.00,
  total_value numeric(12,2) not null,
  place_of_supply text,
  due_date date not null,
  status text not null default 'unpaid' check (status in ('draft','sent','paid','overdue','cancelled')),
  pdf_url text,
  created_at timestamptz default now(),
  unique (business_id, invoice_number)
);

create index idx_invoices_business on invoices (business_id);
create index idx_invoices_status on invoices (business_id, status);
create index idx_invoices_due_date on invoices (due_date);

-- =========================================================
-- 5. PAYMENTS (supports partial payments / reconciliation)
-- =========================================================
create table payments (
  id uuid primary key default uuid_generate_v4(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  amount numeric(12,2) not null,
  method text, -- upi, bank_transfer, cash, razorpay
  reference text,
  paid_at timestamptz default now()
);

create index idx_payments_invoice on payments (invoice_id);

-- =========================================================
-- 6. MESSAGES_LOG (avoid duplicate reminders, audit trail)
-- =========================================================
create table messages_log (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references businesses(id) on delete cascade,
  invoice_id uuid references invoices(id) on delete set null,
  channel text not null check (channel in ('telegram','whatsapp','email')),
  message_type text not null, -- reminder_upcoming, reminder_due, reminder_overdue, invoice_sent
  sent_at timestamptz default now()
);

create index idx_messages_log_invoice on messages_log (invoice_id, message_type);

-- =========================================================
-- ROW LEVEL SECURITY
-- =========================================================
alter table businesses enable row level security;
alter table identities enable row level security;
alter table clients enable row level security;
alter table invoices enable row level security;
alter table payments enable row level security;
alter table messages_log enable row level security;

-- Businesses: owner can only see/edit their own business row
create policy "Owners can view their business"
  on businesses for select
  using (owner_auth_id = auth.uid());

create policy "Owners can update their business"
  on businesses for update
  using (owner_auth_id = auth.uid());

-- Helper: a user's business_id(s) via identities/owner mapping
-- (Used inline in policies below through a subquery for simplicity)

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

create policy "Tenant can insert own invoices"
  on invoices for insert
  with check (business_id in (select id from businesses where owner_auth_id = auth.uid()));

create policy "Tenant can update own invoices"
  on invoices for update
  using (business_id in (select id from businesses where owner_auth_id = auth.uid()));

create policy "Tenant can view own payments"
  on payments for select
  using (business_id in (select id from businesses where owner_auth_id = auth.uid()));

create policy "Tenant can view own messages_log"
  on messages_log for select
  using (business_id in (select id from businesses where owner_auth_id = auth.uid()));

-- NOTE: The FastAPI backend uses the Supabase SERVICE ROLE key for
-- Telegram/WhatsApp-triggered writes (bots have no auth.uid()), which
-- bypasses RLS by design. RLS above protects the WEB DASHBOARD's direct
-- Supabase client access. Never expose the service role key to the frontend.
