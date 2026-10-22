# Invoice App — All-Vercel Edition

Multi-tenant invoicing app: one parser, many front doors (Telegram bot,
WhatsApp bot, web app textbox all call the same logic). Everything —
dashboard **and** backend logic — now deploys as a **single Vercel
project**. No separate Railway/Render/Fly service required.

## Architecture
There is no separate backend. The parser, Gemini fallback and Supabase
queries all run as Next.js API routes under `frontend/app/api/`, which
Vercel deploys as serverless functions alongside the dashboard.
Supabase (database + auth) is the only other service.

## What's included
- `supabase/schema.sql` — full multi-tenant schema + Row Level Security policies
- `frontend/lib/parser.ts` — regex-based free-text → structured invoice data
- `frontend/lib/gemini.ts` — Gemini fallback for messy/casual/Hinglish phrasing
- `frontend/lib/db.ts` + `lib/supabaseAdmin.ts` — server-side Supabase queries
- `frontend/app/api/*/route.ts` — the API routes (parse, create, list, search, resolve)
- `frontend/app/dashboard/*` — the dashboard UI (overview, invoice list, new invoice)
- `frontend/app/login` — auth

## Setup

### 1. Supabase
1. Create a project at supabase.com
2. Open SQL Editor, paste and run `supabase/schema.sql`
3. Grab your `Project URL`, `anon` key, and `service_role` key
   (Settings → API)

### 2. Gemini fallback (optional but recommended)
1. Get a free key at https://aistudio.google.com/apikey (no card needed
   on the free tier as of writing)
2. That's it — `lib/gemini.ts` is only called when regex leaves fields
   missing, so you're not spending a call on every invoice. If you skip
   this, the app still works, just regex-only.

**Note:** Google's model names change fairly often. Pinned to
`gemini-2.5-flash` via the `GEMINI_MODEL` env var — if extraction starts
failing, check https://ai.google.dev/gemini-api/docs/models for the
current free-tier model name and update the env var (no code change).

### 3. Run locally
```bash
cd frontend
npm install
cp .env.local.example .env.local   # fill in your Supabase + Gemini values
npm run dev
```

`.env.local` needs:
```
# Public (safe to expose to the browser)
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Server-only — never prefix these with NEXT_PUBLIC_
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-2.5-flash
```

### 4. Deploy to Vercel
1. Push this repo to GitHub
2. Import it in Vercel, set the **root directory to `frontend/`**
3. Add the same env vars as above in Vercel's project settings
   (Settings → Environment Variables)
4. Deploy — dashboard and API routes ship together, same domain, no CORS

## Important: Hobby plan is non-commercial only
Vercel's free Hobby tier is licensed for personal/non-commercial use. The
moment you take payment (your flat-tier pricing), you're expected to be
on **Vercel Pro ($20/month)**. Realistic comparison isn't "free Vercel vs
paid Railway" — it's Vercel Pro (hosts everything, one bill) vs Railway +
Vercel Hobby (two bills, two dashboards). You may not save money, but you
do simplify to one platform.

## How the pieces connect

```
Telegram bot  ─┐
WhatsApp bot  ─┼─→ POST /api/parse-invoice-request ─→ POST /api/create-invoice ─→ Supabase
Next.js web   ─┘                                                                      │
                                                                                        ▼
                                                          Next.js dashboard ← GET /api/invoices/{business_id}
```

- **One parser, one source of truth, three tiers**: whatever channel a
  message comes from, it hits the same `/api/parse-invoice-request`
  route, which tries regex first (free, instant), then backfills from a
  saved client record if the name matches someone billed before (free),
  and only falls back to Gemini (costs a call) if fields are still
  missing — so messy phrasing gets handled without spending API quota on
  the common, already-structured case.
- **Identity resolution**: before creating an invoice from a bot message,
  call `GET /api/resolve-business?channel=telegram&channel_identifier=<chat_id>`
  to find which `business_id` owns that chat. If it returns `null`, that
  Telegram user hasn't linked their account yet — prompt them to link via
  the web app.
- **RLS split**: API routes use `lib/supabaseAdmin.ts` (service role key,
  bypasses RLS) because bots have no Supabase session — this file must
  only ever be imported from `app/api/` route handlers, never from a
  client component. The dashboard UI uses `lib/supabase/client.ts` (anon
  key + real user session), so RLS enforces tenant isolation there.

## Frontend dashboard

Pages:
- `/login` — sign in / create account (creates the `businesses` row on signup)
- `/dashboard` — outstanding / paid / overdue stats + recent entries
- `/dashboard/invoices` — full invoice list
- `/dashboard/invoices/new` — paste a message like your Telegram bot gets,
  with live autocomplete on client names (backed by
  `/api/clients/{business_id}/search`), an editable review form, then
  creates the invoice

**Design note:** the visual language is built around the Indian
"bahi-khata" ledger book — pale ledger-paper background with faint ruled
lines, ledger-row invoice list instead of boxed cards, and a circular
seal-style status badge (echoing the round company stamp on your own MARC
invoice). Palette and type tokens live in `tailwind.config.ts`.

**Auth flow:** `middleware.ts` protects everything under `/dashboard` by
refreshing the Supabase session on each request and redirecting to
`/login` if there's no user.

## Next steps (not yet in this scaffold)
1. Telegram webhook handler — also just becomes an API route
   (`app/api/telegram-webhook/route.ts`); Telegram pushes messages to a
   webhook URL, so this is serverless-friendly with no changes needed
2. PDF generation (HTML template + a serverless-friendly renderer),
   triggered after `/api/create-invoice`, writing `pdf_url` back to the
   invoice row
3. Reminder cron job — use [Vercel Cron](https://vercel.com/docs/cron-jobs)
   (a `vercel.json` entry hitting a scheduled API route). Hobby plan caps
   this at once per day, which is genuinely enough for "check what's due
   today/in 3 days/overdue" — log each send to `messages_log` to avoid
   duplicates
4. Client list page + edit-invoice flow in the dashboard
