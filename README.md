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
2. Add it as `GEMINI_API_KEY` (no `NEXT_PUBLIC_` prefix) — `lib/gemini.ts` is only called when regex leaves fields
   missing, so you're not spending a call on every invoice. If you skip
   this, the app still works, just regex-only.

**Note:** Google retires and renames models often. `gemini-2.5-flash` is now
limited to existing users, so new API keys get "model not found" for it.
`lib/gemini.ts` therefore tries a built-in list of current models
(`gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-3.5-flash`) and, if
all fail, the new-invoice form shows the exact reason. Only set
`GEMINI_MODEL` if you want to force one; check
https://ai.google.dev/gemini-api/docs/models for current names.

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
# GEMINI_MODEL is optional; leave it unset (see note below)
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
Telegram ──→ POST /api/telegram (secret header) ─┐
Web form ──→ POST /api/parse-invoice-request ────┼─→ lib/parseFlow ─→ lib/invoices ─→ Supabase
                                                 │   (regex → saved client → Gemini)
Dashboard (server components, RLS) ←─────────────┘
```

- **One parser**: web form and Telegram both use `lib/parseFlow.ts`
  (regex first, then saved-client backfill, then Gemini only if fields
  are still missing) and `lib/invoices.ts` to create the invoice.
- **Login required**: `/api/parse-invoice-request`, `/api/create-invoice`,
  `/api/clients/...` and `/api/telegram/link-code|disconnect` all read the
  signed-in user's business from the session cookie and ignore any
  business id sent by the browser. The two old unauthenticated routes
  (`/api/invoices/...`, `/api/resolve-business`) were removed.
- **Service role key** (`lib/supabaseAdmin.ts`) is server-only. The
  dashboard pages use the anon key + user session, so RLS isolates tenants.

## Connect Telegram

1. Supabase → SQL Editor → run `supabase/telegram.sql` (once).
2. In Telegram, talk to @BotFather: `/newbot` (or reuse your bot) and copy
   the token and username.
3. Vercel → Settings → Environment Variables, add:
   `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (any long random
   string), `TELEGRAM_BOT_USERNAME` (without @), and optionally `APP_URL`.
   Redeploy.
4. Register the webhook (run once, from any terminal or browser-capable tool):

   ```
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d "url=https://<your-app>.vercel.app/api/telegram" \
     -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
   ```

   **Warning:** a bot has only one webhook. This replaces the old n8n
   trigger, so the n8n flow stops receiving messages.
5. Dashboard → **Telegram** → *Get connection link* → open it in Telegram
   and tap Start (or send `/link CODE`). Then send an invoice message, check
   the summary, tap **Create invoice**.

Safety: unconfirmed requests are stored in `telegram_pending` and expire
after 1 hour; a button tap can create only one invoice; only private chats
are accepted; every webhook call must carry the secret header.

## Frontend dashboard

Pages:
- `/login` — sign in / create account (creates the `businesses` row on signup)
- `/dashboard` — outstanding / paid / overdue stats + recent entries
- `/dashboard/invoices` — full invoice list; click a row for the detail page
  (`/dashboard/invoices/[id]`: GST breakdown, mark as paid, print)
- `/dashboard/telegram` — connect / disconnect your Telegram chat
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
1. PDF generation (HTML template + a serverless-friendly renderer),
   triggered after `/api/create-invoice`, writing `pdf_url` back to the
   invoice row
2. Reminder cron job — use [Vercel Cron](https://vercel.com/docs/cron-jobs)
   (a `vercel.json` entry hitting a scheduled API route). Hobby plan caps
   this at once per day, which is genuinely enough for "check what's due
   today/in 3 days/overdue" — log each send to `messages_log` to avoid
   duplicates
3. Business profile page (GSTIN, bank details), client list, edit-invoice flow
4. IGST for out-of-state clients
5. Client list page + edit-invoice flow in the dashboard
