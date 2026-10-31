import { parseInvoiceText, computeMissingFields } from "./parser";
import type { ParsedInvoiceData } from "./types";
import { parseWithGemini } from "./gemini";
import {
  findClientByExactName,
  getTaxProfile,
  type ClientRecord,
  type TaxProfile,
} from "./db";
import {
  addDaysIso,
  findStateInText,
  isValidGstin,
  isValidGstRate,
  normalizeGstin,
  stateCodeFromGstin,
} from "./gst";
import { todayInIndia } from "./status";

function refreshMissing(p: ParsedInvoiceData, requireState: boolean) {
  p.missing_fields = computeMissingFields(p, requireState);
}

function backfillFromSavedClient(
  parsed: ParsedInvoiceData,
  existing: ClientRecord,
  requireState: boolean
) {
  parsed.client_email = parsed.client_email || existing.email;
  parsed.client_phone = parsed.client_phone || existing.phone;
  parsed.company_address = parsed.company_address || existing.address;
  parsed.client_gstin = parsed.client_gstin || existing.gstin;
  parsed.client_state_code =
    parsed.client_state_code ||
    stateCodeFromGstin(existing.gstin) ||
    existing.state_code;
  parsed.matched_existing_client = true;
  parsed.matched_client_id = existing.id;
  refreshMissing(parsed, requireState);
}

/** Fields the business's saved defaults can fill if the message doesn't. */
function coveredByDefaults(
  profile: TaxProfile | null,
  requireState: boolean
): Set<string> {
  const covered = new Set<string>();
  if (profile?.default_due_days != null) covered.add("due_date");
  if (requireState && profile?.assume_local_supply && profile.state_code) {
    covered.add("client_state");
  }
  return covered;
}

/**
 * Last step: anything the message (and the AI) didn't say gets the
 * business's saved default — and is recorded in defaults_applied so the
 * review screen / Telegram summary can say "assumed".
 */
function applyDefaults(
  parsed: ParsedInvoiceData,
  profile: TaxProfile | null,
  requireState: boolean
) {
  if (!parsed.due_date && profile?.default_due_days != null) {
    parsed.due_date = addDaysIso(todayInIndia(), profile.default_due_days);
    parsed.defaults_applied.push("due_date");
  }
  if (
    requireState &&
    !parsed.client_state_code &&
    profile?.assume_local_supply &&
    profile.state_code
  ) {
    parsed.client_state_code = profile.state_code;
    parsed.defaults_applied.push("client_state");
  }
  refreshMissing(parsed, requireState);
}

/**
 * Turns a free-text message into invoice fields. Used by the web form
 * AND the Telegram bot, so both read messages exactly the same way.
 *
 * Cheapest first:
 *   1. Regex — free, instant, handles structured phrasing
 *   2. Saved client — if the name matches someone billed before, fill in
 *      their email / mobile / address / GSTIN / state
 *   3. Gemini — only if something required is still missing AND the
 *      business's saved defaults can't fill it. Then step 2 runs again,
 *      because Gemini may be the one that found the name.
 *   4. Saved defaults (due date, local place of supply), flagged as assumed.
 */
export async function parseInvoiceMessage(
  rawText: string,
  businessId?: string | null
): Promise<ParsedInvoiceData> {
  // A business that isn't registered for GST doesn't need a client state.
  const profile = businessId ? await getTaxProfile(businessId) : null;
  const requireState = profile ? profile.gst_registered : true;

  const parsed = parseInvoiceText(rawText, undefined, requireState);

  if (businessId && parsed.client_name) {
    const existing = await findClientByExactName(businessId, parsed.client_name);
    if (existing) backfillFromSavedClient(parsed, existing, requireState);
  }
  refreshMissing(parsed, requireState);

  const covered = coveredByDefaults(profile, requireState);
  const needsAI = parsed.missing_fields.some((f) => !covered.has(f));

  if (needsAI) {
    const gemini = await parseWithGemini(rawText);
    if (gemini.ok) {
      const g = gemini.fields;
      parsed.client_name = parsed.client_name || g.client_name;
      parsed.client_email = parsed.client_email || g.client_email;
      parsed.client_phone = parsed.client_phone || g.client_phone;
      parsed.company_address = parsed.company_address || g.company_address;
      parsed.description = parsed.description || g.description;
      parsed.due_date = parsed.due_date || g.due_date;

      // If the message said the amount includes GST, regex deliberately
      // blanked it — don't let Gemini put the GST-inclusive figure back.
      if (!parsed.amount_includes_gst) {
        parsed.taxable_value = parsed.taxable_value || g.taxable_value;
      }

      if (parsed.gst_rate === null && isValidGstRate(g.gst_rate)) {
        parsed.gst_rate = g.gst_rate;
      }

      // Only trust a GSTIN from the model if it passes the checksum.
      const gGstin = normalizeGstin(g.client_gstin);
      if (!parsed.client_gstin && isValidGstin(gGstin)) {
        parsed.client_gstin = gGstin;
      }
      parsed.client_state_code =
        parsed.client_state_code ||
        stateCodeFromGstin(parsed.client_gstin) ||
        findStateInText(g.client_state) ||
        findStateInText(g.company_address);

      if (businessId && parsed.client_name && !parsed.matched_existing_client) {
        const existing = await findClientByExactName(
          businessId,
          parsed.client_name
        );
        if (existing) backfillFromSavedClient(parsed, existing, requireState);
      }
      refreshMissing(parsed, requireState);
    } else {
      parsed.parse_note = parsed.parse_note ?? gemini.reason;
    }
  }

  applyDefaults(parsed, profile, requireState);
  return parsed;
}
