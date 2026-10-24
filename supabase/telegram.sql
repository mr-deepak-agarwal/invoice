-- =========================================================
-- TELEGRAM BOT TABLES
-- Run ONCE in Supabase → SQL Editor (safe to re-run).
-- =========================================================

-- One-time codes that connect a Telegram chat to a business.
-- Created from the dashboard's Telegram page; valid for 15 minutes.
create table if not exists telegram_link_codes (
  code text primary key,
  business_id uuid not null references businesses(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);
create index if not exists idx_telegram_link_codes_business
  on telegram_link_codes (business_id);

-- Invoices waiting for the "Create invoice" button in Telegram.
create table if not exists telegram_pending (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  chat_id text not null,
  payload jsonb not null,
  created_at timestamptz default now()
);

-- Only the server (service role key) may touch these tables.
-- RLS is on with NO policies on purpose: browsers get no access at all.
alter table telegram_link_codes enable row level security;
alter table telegram_pending enable row level security;
