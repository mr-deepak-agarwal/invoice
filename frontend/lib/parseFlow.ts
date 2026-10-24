import {
  parseInvoiceText,
  computeMissingFields,
  type ParsedInvoiceData,
} from "./parser";
import { parseWithGemini } from "./gemini";
import { findClientByExactName, type ClientRecord } from "./db";

function backfillFromSavedClient(
  parsed: ParsedInvoiceData,
  existing: ClientRecord
) {
  parsed.client_email = parsed.client_email || existing.email;
  parsed.client_phone = parsed.client_phone || existing.phone;
  parsed.company_address = parsed.company_address || existing.address;
  parsed.matched_existing_client = true;
  parsed.matched_client_id = existing.id;
  parsed.missing_fields = computeMissingFields(parsed);
}

/**
 * Turns a free-text message into invoice fields. Used by the web form
 * AND the Telegram bot, so both read messages exactly the same way.
 *
 * Cheapest first:
 *   1. Regex — free, instant, handles the fixed "bill for X … amount is Y" style
 *   2. Saved client — if the name matches someone billed before, fill in
 *      their email / mobile / address
 *   3. Gemini — only if something is still missing; reads casual or
 *      Hinglish phrasing. Then step 2 runs again, because Gemini may be
 *      the one that found the name.
 */
export async function parseInvoiceMessage(
  rawText: string,
  businessId?: string | null
): Promise<ParsedInvoiceData> {
  const parsed = parseInvoiceText(rawText);
  parsed.missing_fields = computeMissingFields(parsed);

  if (businessId && parsed.client_name) {
    const existing = await findClientByExactName(businessId, parsed.client_name);
    if (existing) backfillFromSavedClient(parsed, existing);
  }

  if (parsed.missing_fields.length > 0) {
    const gemini = await parseWithGemini(rawText);
    if (gemini.ok) {
      const g = gemini.fields;
      parsed.client_name = parsed.client_name || g.client_name;
      parsed.client_email = parsed.client_email || g.client_email;
      parsed.client_phone = parsed.client_phone || g.client_phone;
      parsed.company_address = parsed.company_address || g.company_address;
      parsed.taxable_value = parsed.taxable_value || g.taxable_value;
      parsed.description = parsed.description || g.description;
      parsed.due_date = parsed.due_date || g.due_date;
      parsed.missing_fields = computeMissingFields(parsed);

      if (businessId && parsed.client_name && !parsed.matched_existing_client) {
        const existing = await findClientByExactName(
          businessId,
          parsed.client_name
        );
        if (existing) backfillFromSavedClient(parsed, existing);
      }
    } else {
      parsed.parse_note = gemini.reason;
    }
  }

  return parsed;
}
