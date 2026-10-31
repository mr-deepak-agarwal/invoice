import * as chrono from "chrono-node";
import type { ParsedInvoiceData } from "./types";
import {
  addDaysIso,
  findStateInText,
  isRealIsoDate,
  isValidGstin,
  isValidGstRate,
  normalizeGstin,
  stateCodeFromGstin,
} from "./gst";
import { todayInIndia } from "./status";

/**
 * Regex reader for the common phrasings. It is deliberately strict: when
 * a number or date is ambiguous it returns null and lets the Gemini step
 * (lib/gemini.ts) decide, instead of guessing wrong.
 *
 * Handles, for example:
 *   "bill for Marc Glocal email a@b.com amount is 25000 to be paid by 1 nov 2026"
 *   "make invoice for Marc, panjim goa, 25000, web development, due 1 nov 2026"
 *   "invoice for Acme Ltd, ₹1.5 lakh, due in 15 days, gst 12%"
 * Hinglish / free-form messages mostly fall through to Gemini.
 */

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
// Indian mobile: starts 6-9, optional +91 / 91 prefix.
const PHONE_RE = /(?<!\d)(?:\+?91[\s-]?)?([6-9]\d{9})(?!\d)/;
const GSTIN_RE = /\b(\d{2}[A-Za-z]{5}\d{4}[A-Za-z][1-9A-Za-z][Zz][0-9A-Za-z])\b/;

// "bill for X" / "make invoice for X" / "invoice to X" — X stops at a comma,
// a keyword, a digit or the end.
const NAME_RE =
  /\b(?:bill|invoice)\s+(?:for|to)\s+([A-Za-z][A-Za-z.&'’\s-]*?)(?=\s*(?:,|\bemail\b|\bmobile\b|\bphone\b|\baddress\b|\bamount\b|\bto\s+be\b|\bdue\b|\bgst\b|\bfor\b|\d|₹|$))/i;

// "Deepak sir ka 2000 ka bill ...", "दीपक जी का 2000 का बिल ..." — a name,
// then ka/ki/ke/ko, with a number later in the same clause.
const HINGLISH_NAME_RE =
  /^\s*([A-Za-z\u0900-\u097F][A-Za-z\u0900-\u097F.&'’ -]*?)\s+(?:ka|ki|ke|ko|का|की|के|को)\s+(?=[^,]*\d)/i;

const ADDRESS_RE =
  /(?:company\s+)?address\s+is\s+(.+?)(?:,?\s*(?:space\s+)?amount|,?\s*to\s+be\s+paid|,?\s*due\b|$)/i;

const AMOUNT_KEYWORD_RE =
  /(?:\bamount(?:\s+is)?|\brs\.?|₹|\binr\b|रुपये|रुपए|रुपया|\brupees?\b|\brupaye\b)\s*[:=-]?\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(k|lakhs?|lacs?|l|हज़ार|हजार|लाख)?(?![A-Za-z0-9])/i;

// Number first, currency word after: "25000 rupees", "२५००० रुपये", "15 हजार रुपये"
const AMOUNT_SUFFIX_RE =
  /(\d[\d,]*(?:\.\d{1,2})?)\s*(k|lakhs?|lacs?|हज़ार|हजार|लाख)?\s*(?:रुपये|रुपए|रुपया|rupees?\b|rupaye\b|rs\b\.?)/i;

// A bare number sitting alone between commas: ", 25000,"
const AMOUNT_FIELD_RE_G =
  /(?:^|,)\s*(?:rs\.?\s*|₹\s*|inr\s*)?(\d{3,9}(?:\.\d{1,2})?)\s*(k|lakhs?|lacs?)?\s*(?=,|$)/gi;

const GST_RATE_RE =
  /\bgst\s*(?:@|of|at|:)?\s*(\d{1,2}(?:\.\d+)?)\s*%|(\d{1,2}(?:\.\d+)?)\s*%\s*(?:gst|igst|cgst|tax)\b/i;
const NO_GST_RE = /\b(?:no|without|zero|nil)\s+gst\b|\bgst\s*(?:free|exempt)\b/i;
const GST_INCLUSIVE_RE =
  /\b(?:incl(?:usive|uding|\.)?\s+(?:of\s+)?(?:gst|tax)|gst\s+(?:is\s+)?(?:included|inclusive))\b/i;

const RELATIVE_DUE_RE =
  /\b(?:due\s+in|within|payable\s+in|pay\s+in|net)\s+(\d{1,3})\s*(day|week)s?\b/i;

const DATE_PATTERNS = [
  String.raw`\d{4}-\d{2}-\d{2}`,
  String.raw`\d{1,2}[/-]\d{1,2}[/-]\d{2,4}`,
  String.raw`\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?[A-Za-z]{3,9}\.?,?\s+\d{4}`,
  String.raw`[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}`,
  String.raw`\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?[A-Za-z]{3,9}\b`, // no year
];
const DUE_DATE_RE = new RegExp(
  String.raw`\b(?:due(?:\s+date)?|paid|payable|payment|pay)(?:\s+(?:by|on|before|date))?\s*[:=-]?\s*(` +
    DATE_PATTERNS.join("|") +
    String.raw`)`,
  "i"
);

export function computeMissingFields(
  p: {
  client_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  client_state_code?: string | null;
  taxable_value: number | null;
  due_date: string | null;
  },
  /** false for businesses not registered under GST: no state needed. */
  requireState = true
): string[] {
  const missing: string[] = [];
  if (!p.client_name) missing.push("client_name");
  if (!p.taxable_value) missing.push("taxable_value");
  if (!p.due_date) missing.push("due_date");
  if (requireState && !p.client_state_code) missing.push("client_state");
  return missing;
}

function multiplier(suffix: string | undefined): number {
  if (!suffix) return 1;
  const s = suffix.toLowerCase();
  if (s === "k" || s === "हज़ार" || s === "हजार") return 1_000;
  return 100_000; // l / lakh / lac / लाख
}

/** Devanagari digits (२५०००) -> ASCII (25000) so the rest of the parser sees one script. */
export function normalizeDigits(s: string): string {
  return s.replace(/[०-९]/g, (d) => String("०१२३४५६७८९".indexOf(d)));
}

function parseAmount(text: string, phone: string | null): number | null {
  const kw = text.match(AMOUNT_KEYWORD_RE);
  if (kw) {
    const n = parseFloat(kw[1].replace(/,/g, "")) * multiplier(kw[2]);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  }
  const sfx = text.match(AMOUNT_SUFFIX_RE);
  if (sfx) {
    const n = parseFloat(sfx[1].replace(/,/g, "")) * multiplier(sfx[2]);
    if (Number.isFinite(n) && n > 0) return Math.round(n * 100) / 100;
  }
  // Fallback: a bare number alone between commas. Only trust it when
  // there is exactly one candidate (a pincode would also look like one).
  const candidates: number[] = [];
  for (const m of text.matchAll(AMOUNT_FIELD_RE_G)) {
    if (phone && m[1] === phone) continue;
    candidates.push(parseFloat(m[1]) * multiplier(m[2]));
  }
  return candidates.length === 1 && candidates[0] > 0 ? candidates[0] : null;
}

/** The one amount in a message, or null if there are none or several —
 * several means it's ambiguous and the AI step / reviewer should decide. */
function singleNumber(text: string): number | null {
  const cleaned = text
    .replace(EMAIL_RE, " ")
    .replace(GSTIN_RE, " ")
    .replace(new RegExp(PHONE_RE.source, "g"), " ")
    .replace(RELATIVE_DUE_RE, " ")
    .replace(DUE_DATE_RE, " ")
    .replace(GST_RATE_RE, " ");
  const found: number[] = [];
  for (const m of cleaned.matchAll(
    // The suffix only counts as a whole word: "2000 ka" must NOT read as "2000 k".
    /(\d[\d,]*(?:\.\d{1,2})?)(?:\s*(k|lakhs?|lacs?|हज़ार|हजार|लाख)(?![A-Za-z0-9\u0900-\u097F]))?/gi
  )) {
    found.push(parseFloat(m[1].replace(/,/g, "")) * multiplier(m[2]));
  }
  return found.length === 1 && found[0] > 0 ? found[0] : null;
}

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDueDate(text: string, today: string): string | null {
  const rel = text.match(RELATIVE_DUE_RE);
  if (rel) {
    const n = parseInt(rel[1], 10) * (rel[2].toLowerCase() === "week" ? 7 : 1);
    return addDaysIso(today, n);
  }
  const m = text.match(DUE_DATE_RE);
  if (!m) return null;
  const ref = new Date(`${today}T12:00:00`);
  // en.GB reads 30/11/2026 as day/month, which is how Indians write it.
  const parsed = chrono.en.GB.parseDate(m[1], ref, { forwardDate: true });
  if (!parsed) return null;
  const iso = formatLocalDate(parsed);
  return isRealIsoDate(iso) ? iso : null;
}

/** Comma-separated style: the field right after the amount is the work. */
function guessDescription(
  text: string,
  amountFound: boolean,
  hinglish = false
): string | null {
  if (!amountFound) return null;
  const protectedText = text.replace(/(\d),(?=\d{2,3}(?!\d))/g, "$1\u0001");
  const fields = protectedText
    .split(",")
    .map((f) => f.replace(/\u0001/g, ",").trim())
    .filter(Boolean);
  const amountIdx = fields.findIndex((f) =>
    /^(?:amount(?:\s+is)?\s*)?(?:rs\.?\s*|₹\s*|inr\s*)?\d[\d,]*(?:\.\d{1,2})?\s*(?:k|lakhs?|lacs?)?$/i.test(f)
  );
  // "Deepak sir ka 2000 ka bill bana do, haircut aur facial": the amount is
  // inside the first clause, so the work is the next clean clause.
  const start = amountIdx >= 0 ? amountIdx + 1 : hinglish ? 1 : -1;
  if (start < 0) return null;
  for (const f of fields.slice(start)) {
    if (
      /@|\b(?:due|paid|payable|by|email|mobile|phone|address|gst|igst|net|within)\b|%|^\d/i.test(f) ||
      f.length < 3 ||
      f.length > 120
    ) {
      continue;
    }
    return f;
  }
  return null;
}

export function parseInvoiceText(
  rawText: string,
  today: string = todayInIndia(),
  requireState = true
): ParsedInvoiceData {
  const text = normalizeDigits(rawText.trim());

  const emailMatch = text.match(EMAIL_RE);
  const phoneMatch = text.match(PHONE_RE);
  const nameMatch = text.match(NAME_RE);
  const addressMatch = text.match(ADDRESS_RE);
  const gstinMatch = text.match(GSTIN_RE);

  const client_email = emailMatch ? emailMatch[0] : null;
  const client_phone = phoneMatch ? phoneMatch[1] : null;
  let hinglishName: string | null = null;
  if (!nameMatch) {
    const h = text.match(HINGLISH_NAME_RE);
    const n = h ? h[1].trim() : "";
    if (n && !/\b(?:bill|invoice|bana|banao|bana do)\b|बिल|बना/i.test(n)) {
      hinglishName = n;
    }
  }
  const client_name = nameMatch
    ? nameMatch[1].trim().replace(/[.\s-]+$/, "") || null
    : hinglishName;
  const company_address = addressMatch
    ? addressMatch[1].trim().replace(/,$/, "")
    : null;

  const gstinCandidate = gstinMatch ? normalizeGstin(gstinMatch[1]) : null;
  const client_gstin =
    gstinCandidate && isValidGstin(gstinCandidate) ? gstinCandidate : null;

  // Look for a place name only in text that isn't an email address or GSTIN.
  const placeText = text
    .replace(EMAIL_RE, " ")
    .replace(GSTIN_RE, " ");
  const client_state_code =
    stateCodeFromGstin(client_gstin) ?? findStateInText(placeText);

  const amount_includes_gst = GST_INCLUSIVE_RE.test(text);
  let taxable_value = amount_includes_gst
    ? null
    : parseAmount(text, client_phone) ??
      (hinglishName ? singleNumber(text) : null);

  let gst_rate: number | null = null;
  if (NO_GST_RE.test(text)) {
    gst_rate = 0;
  } else {
    const r = text.match(GST_RATE_RE);
    if (r) {
      const n = parseFloat(r[1] ?? r[2]);
      if (isValidGstRate(n)) gst_rate = n;
    }
  }

  const due_date = parseDueDate(text, today);
  const description = guessDescription(
    text,
    taxable_value !== null,
    hinglishName !== null
  );

  let parse_note: string | null = null;
  if (amount_includes_gst) {
    parse_note =
      "The message says GST is included. Bahi needs the amount before GST — please enter it below.";
    taxable_value = null;
  }

  return {
    client_name,
    client_email,
    client_phone,
    company_address,
    client_gstin,
    client_state_code,
    taxable_value,
    gst_rate,
    description,
    due_date,
    missing_fields: computeMissingFields(
      {
        client_name,
        client_email,
        client_phone,
        client_state_code,
        taxable_value,
        due_date,
      },
      requireState
    ),
    matched_existing_client: false,
    matched_client_id: null,
    amount_includes_gst,
    parse_note,
    defaults_applied: [],
  };
}
