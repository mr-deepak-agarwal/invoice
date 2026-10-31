# Bahi — chat-to-invoice for Indian small businesses

Multi-tenant GST invoicing. You write (or send on Telegram) a message like
*"make invoice for Marc, panjim goa, 25000, web development, due 1 nov 2026"*;
Bahi reads it, shows you a summary with the correct tax, and creates the invoice.

Everything — dashboard **and** backend logic — deploys as a **single Vercel
project**. Supabase (database + auth) is the only other service.

## What it does today (and what it doesn't)

| Works | Not built yet |
|---|---|
| Message → invoice fields (regex + saved clients + Gemini) | PDF generation / emailing / WhatsApp delivery |
| Correct **IGST vs CGST+SGST** from the business state and the client's place of supply | Payment reminders and UPI collect links |
| GSTIN validation (format + checksum), state auto-derived from GSTIN | e-invoicing (IRN/QR) for turnover above ₹5 Cr |
| Gap-free invoice numbers per financial year (`INV/2627/0001`) | Credit/debit notes (issued invoices are locked; cancel + re-issue for now) |
| Issued invoices are immutable (enforced in the database) | TDS handling, reverse charge, exports/SEZ, composition/unregistered suppliers |
| **No-GST mode** for unregistered businesses (freelancers under the limit): no tax, no state needed | Automatic WhatsApp sending to clients (see "Reminders") |
| **UPI payment link + QR** on every invoice and a public `/pay/<token>` page | **Auto-reconcile** when a customer pays (needs a payment gateway webhook) |
| **Mic button** on the new-invoice page (Hindi or English, browser speech recognition; best in Chrome) | Speech in browsers without Web Speech support; Telegram voice notes |
| **Reminders** in English / हिन्दी / Hinglish: daily Telegram digest + one-tap WhatsApp from your own number | Buyer acceptance link, interest calculator, claim pack, days-to-pay dashboard |
| Telegram bot with confirm-before-create | WhatsApp channel, client list page, partial-payment UI |
| Per-business rate limit on AI parsing | Multi-user teams / roles |

**Be straight about the parser.** Regex handles structured phrasing for free
(`lib/parser.ts`). Casual, reordered and Hinglish messages fall through to
Gemini, so Gemini is a real dependency, not a rare fallback. Grow
`frontend/tests/evals/messages.json` into a ~100-message eval set and score
whichever model you use against it.

## Architecture

```
Telegram ──→ POST /api/telegram (secret header) ─┐
Web form ──→ POST /api/parse-invoice-request ────┼─→ lib/parseFlow ─→ lib/invoices ─→ Supabase
                                                 │   (regex → saved client → Gemini)   └─ create_invoice() (atomic)
Dashboard (server components, RLS) ←─────────────┘
```

- **One reader, one creator.** Web and Telegram share `lib/parseFlow.ts` and
  `lib/invoices.ts`.
- **GST logic is pure and tested:** `lib/gst.ts` (states, GSTIN, tax maths in
  whole paise).
- **Invoice creation is one Postgres function** (`create_invoice`): it
  allocates the number and inserts the row in the same transaction, so
  numbers never skip because an insert failed, even under concurrency.
- **Tenant isolation:** API routes derive the business from the session
  cookie and ignore any id sent by the browser. The dashboard uses the anon
  key + RLS. The service-role key is server-only (`lib/supabaseAdmin.ts`).
- **Browsers cannot insert invoices** (no RLS insert policy) and cannot edit
  an issued invoice's numbers (trigger). They can mark paid / change due date.

## Setup

### 1. Supabase
- **New project:** SQL Editor → run `supabase/schema.sql`.
- **Existing database from an earlier version:** run
  `supabase/migrations/001_hardening.sql` instead (safe to re-run; backfills
  old invoices; leaves old invoice numbers untouched).
- Grab the Project URL, `anon` key and `service_role` key (Settings → API).

  Then run `supabase/migrations/002_nogst_upi_reminders.sql` (adds the
  GST-registered flag, UPI ID and the payment-link token; backfills old
  invoices). Fresh installs: `schema.sql` already has both.

### 2. Gemini
Free key at https://aistudio.google.com/apikey → `GEMINI_API_KEY` (no
`NEXT_PUBLIC_` prefix). Without it the app still works, regex-only.
Google renames models often; `lib/gemini.ts` tries a built-in list and shows
the exact failure reason. **Privacy:** message text goes to Google. Check the
current Gemini API terms and use a paid key before real customer data.

### 3. Run locally
```bash
cd frontend
npm install
cp .env.local.example .env.local   # fill in Supabase + Gemini
npm run dev
```

### 4. First login
Open **Settings** and enter your **GSTIN** (state is read from it) or choose
your state. **Until you do, invoice creation is refused on purpose** — Bahi
can't pick CGST+SGST vs IGST without it.

### 5. Deploy to Vercel
Push to GitHub, import in Vercel, set **root directory to `frontend/`**, add
the same env vars. Vercel's free Hobby tier is non-commercial; take payment →
use Pro.

## Saved defaults (fewer follow-up questions)

In **Settings** you can save *default payment terms* (e.g. due on receipt) and
*assume clients are in my state*. Then "Deepak sir ka 2000 ka bill bana do,
haircut aur facial" creates a bill with no follow-up questions. Both are
**off by default** (always ask) because a wrong assumption has a cost: an
out-of-state client billed CGST+SGST instead of IGST. Whatever was assumed is
shown on the review screen and in the Telegram summary ("assumed same as
yours", "your default terms"), and anything the message actually says always
wins over a default.

The reader now understands `<name> ka <amount> ka bill` in Hinglish and
Devanagari without calling Gemini; when a message has two possible amounts it
leaves the field empty instead of guessing.

## No-GST mode (freelancers and small businesses)

In **Settings**, untick *I'm registered for GST*. Invoices then carry no tax
and need no state or GSTIN; the page says "Invoice" instead of "Tax invoice"
and notes that no GST was charged. Any GST rate sent in is ignored. This is a
product setting, not tax advice: whether you must register, and what document
you must issue (e.g. a bill of supply under composition), is for you and your
CA. Not handled yet: composition scheme, exports/SEZ, reverse charge.

## Payment links and QR

Add your **UPI ID** in Settings. Every unpaid invoice then shows a UPI QR
(also on the printed page) and a shareable link `/pay/<token>`.

- The pay page is **public by design** and keyed by a random 64-hex token.
  What it may show is whitelisted in one tested function
  (`lib/publicInvoice.ts`): business name, invoice number, description,
  amount, due date, status and UPI ID — never the client's contact details,
  bank details or internal ids. It's `noindex`.
- **A UPI link only helps the customer pay.** Bahi cannot see that the money
  arrived, so *Mark paid* stays manual until a gateway webhook (e.g. Razorpay
  payment links) is added. Don't describe this as auto-reconciliation.

## Reminders

- **Ladder:** 3 days before → due today → 1, 3, 7, 15, 30 days overdue, each
  raised once per invoice (tracked in `messages_log`).
- **Dashboard → Reminders** lists everything that needs a nudge, with the
  message in **English, हिन्दी or Hinglish** and a *Send on WhatsApp* button
  (a `wa.me` link, so it goes from **your own number**; no WhatsApp Business
  API approval, no per-message cost, no automated-messaging ban risk).
- **Daily digest on Telegram** (if connected): a morning summary of what
  needs a nudge. Set `CRON_SECRET` and `APP_URL`; `vercel.json` schedules it
  at 09:00 IST. The route refuses to run without the secret.
- Have a native speaker review the Hindi/Hinglish wording before relying on
  it with real clients. Free-form Hindi *invoice requests* go through Gemini;
  the regex reads Devanagari digits and amounts like `१५ हजार रुपये`.

## How GST is decided

- Business state = Settings (or first two digits of your GSTIN).
- Place of supply = client GSTIN state → the state you choose → the saved
  client's state → a state/city found in your message (`goa`, `pune`…).
  If a message mentions two different states, Bahi doesn't guess.
- Same state → CGST + SGST (rate split in two). Different → IGST (full rate).
- Default rate 18%; set per invoice (`gst 12%`, `no gst`, or the form field).
- A message saying the amount **includes GST** is refused — enter the amount
  before GST so tax isn't applied twice.
- The review screen / Telegram summary always shows place of supply and the
  tax split before anything is created.

## Connect Telegram

1. Run `supabase/schema.sql` (or the migration) — it includes the bot tables.
2. @BotFather → `/newbot`; copy token and username.
3. Vercel env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (long random),
   `TELEGRAM_BOT_USERNAME` (no @), optional `APP_URL`. Redeploy.
4. Register the webhook once:
   ```
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d "url=https://<your-app>.vercel.app/api/telegram" \
     -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
   ```
   A bot has one webhook; this replaces any old (e.g. n8n) trigger.
5. Dashboard → **Telegram** → *Get connection link* → open in Telegram → Start.

Safety: every webhook call must carry the secret header (timing-safe check);
only private chats; unconfirmed requests expire after 1 hour; a button tap
creates at most one invoice; parsing is rate limited per business.

## Tests

```bash
cd frontend
npm run typecheck
npm test            # 110 tests: GST maths, GSTIN, parser (incl. Hindi amounts), eval set,
                    # invoice creation (incl. no-GST), UPI links, public-page whitelist,
                    # reminder ladder + messages, daily job, cron auth
```

Database tests (need a scratch Postgres; **never run on Supabase**):
```bash
psql -f supabase/tests/00_supabase_stubs.sql   # test-only stand-ins for auth.*
psql -f supabase/schema.sql
psql -f supabase/tests/smoke.sql               # numbering, RLS, immutability, rate limit, tokens
```
CI (`.github/workflows/ci.yml`) runs both.

## Security notes (read before going live)

- The earlier zip still contained `/api/invoices/[businessId]` and
  `/api/resolve-business`: unauthenticated routes using the service-role key.
  They are **deleted**. If a previous build of this app is live, redeploy.
- Check your Vercel logs for requests to
  those two paths from before the fix.
- Bank account numbers and PAN are stored in plaintext columns behind RLS.
  Fine for v0; consider column encryption before holding other people's data.
- Client names/amounts are sent to Gemini (see above).

## Next steps
1. Get ~10 pilot businesses on it and record each one's baseline days-to-pay
   before deciding what to build next.
2. Buyer acceptance link (timestamped) on the pay page; statutory-interest
   calculator and claim pack for MSME payments (have a lawyer review).
3. Days-to-pay dashboard (the metric investors will ask for).
4. Gateway webhook for real auto-reconcile; PDF + email delivery.
5. Credit notes; e-invoice (IRN/QR) for ₹5 Cr+ customers; TDS-aware net amounts.
