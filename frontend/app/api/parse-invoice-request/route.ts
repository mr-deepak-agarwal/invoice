import { NextRequest, NextResponse } from "next/server";
import { parseInvoiceText, computeMissingFields } from "@/lib/parser";
import { parseWithGemini } from "@/lib/gemini";
import { findClientByExactName } from "@/lib/db";

/**
 * Telegram bot, WhatsApp bot, and the web app's textbox all call THIS
 * SAME route — one parser, one source of truth.
 *
 * Order of operations, cheapest/fastest first:
 *   1. Regex (free, instant) — handles the common structured phrasing
 *   2. Saved-client lookup (free, one DB call) — backfills email/phone/
 *      address for a client billed before, even if regex found nothing
 *      but the name
 *   3. Gemini fallback (costs an API call) — ONLY runs if fields are
 *      still missing after 1+2, to handle messy/casual/Hinglish phrasing
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const rawText: string = body.raw_text;
  const businessId: string | undefined = body.business_id;

  if (!rawText || typeof rawText !== "string") {
    return NextResponse.json(
      { error: "raw_text is required" },
      { status: 400 }
    );
  }

  const parsed = parseInvoiceText(rawText);
  parsed.missing_fields = computeMissingFields(parsed);

  // Step 2: backfill from a previously saved client with the same name
  if (businessId && parsed.client_name) {
    const existing = await findClientByExactName(businessId, parsed.client_name);
    if (existing) {
      parsed.client_email = parsed.client_email || existing.email;
      parsed.client_phone = parsed.client_phone || existing.phone;
      parsed.company_address = parsed.company_address || existing.address;
      parsed.matched_existing_client = true;
      parsed.matched_client_id = existing.id;
      parsed.missing_fields = computeMissingFields(parsed);
    }
  }

  // Step 3: Gemini fallback, only spent if something's still missing
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
    } else {
      parsed.parse_note = gemini.reason;
    }
  }

  return NextResponse.json(parsed);
}
