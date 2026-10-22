import * as chrono from "chrono-node";

/**
 * Regex-based parser, ported 1:1 from the Python version. Same rules,
 * same fixes: NAME_RE terminates on "amount"/"to be" too (not just
 * email/comma) so short repeat messages without an email still parse
 * the name correctly.
 */

export interface ParsedInvoiceData {
  client_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  company_address: string | null;
  taxable_value: number | null;
  due_date: string | null; // YYYY-MM-DD
  missing_fields: string[];
  matched_existing_client: boolean;
  matched_client_id: string | null;
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_RE = /\b\d{10}\b/;
const AMOUNT_RE = /amount\s+is\s+(?:rs\.?|rupees|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i;
const NAME_RE =
  /(?:bill|invoice)\s+for\s+([A-Za-z][A-Za-z\s]+?)\s+(?:email|,|amount|to\s+be|$)/i;
const ADDRESS_RE =
  /(?:company\s+)?address\s+is\s+(.+?)(?:,?\s*(?:space\s+)?amount|,?\s*to\s+be\s+paid|$)/i;
const DUE_DATE_RE =
  /(?:paid|due)\s+by\s+(\d{1,2}\s+\w+\s+\d{4}|\w+\s+\d{1,2},?\s+\d{4})/i;

export function computeMissingFields(p: {
  client_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  taxable_value: number | null;
  due_date: string | null;
}): string[] {
  const missing: string[] = [];
  if (!p.client_name) missing.push("client_name");
  if (!p.client_email && !p.client_phone) missing.push("client_contact");
  if (!p.taxable_value) missing.push("taxable_value");
  if (!p.due_date) missing.push("due_date");
  return missing;
}

export function parseInvoiceText(rawText: string): ParsedInvoiceData {
  const text = rawText.trim();

  const emailMatch = text.match(EMAIL_RE);
  const phoneMatch = text.match(PHONE_RE);
  const amountMatch = text.match(AMOUNT_RE);
  const nameMatch = text.match(NAME_RE);
  const addressMatch = text.match(ADDRESS_RE);
  const dueDateMatch = text.match(DUE_DATE_RE);

  const client_name = nameMatch ? nameMatch[1].trim() : null;
  const client_email = emailMatch ? emailMatch[0] : null;
  const client_phone = phoneMatch ? phoneMatch[0] : null;
  const company_address = addressMatch
    ? addressMatch[1].trim().replace(/,$/, "")
    : null;

  let taxable_value: number | null = null;
  if (amountMatch) {
    taxable_value = parseFloat(amountMatch[1].replace(/,/g, ""));
  }

  let due_date: string | null = null;
  if (dueDateMatch) {
    // chrono handles "30 nov 2025" / "nov 30, 2025" style phrasing well
    const parsed = chrono.parseDate(dueDateMatch[1]);
    if (parsed) {
      due_date = parsed.toISOString().slice(0, 10);
    }
  }

  return {
    client_name,
    client_email,
    client_phone,
    company_address,
    taxable_value,
    due_date,
    missing_fields: computeMissingFields({
      client_name,
      client_email,
      client_phone,
      taxable_value,
      due_date,
    }),
    matched_existing_client: false,
    matched_client_id: null,
  };
}
