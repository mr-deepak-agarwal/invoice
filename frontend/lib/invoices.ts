import { getSupabaseAdmin } from "./supabaseAdmin";
import { escapeLike } from "./db";
import {
  DEFAULT_GST_RATE,
  computeTotals,
  isRealIsoDate,
  isValidGstin,
  isValidGstRate,
  isValidStateCode,
  normalizeGstin,
  stateCodeFromGstin,
  stateName,
  taxTypeFor,
  type TaxType,
} from "./gst";

export interface NewInvoiceInput {
  business_id: string;
  client_name: string;
  client_email?: string | null;
  client_phone?: string | null;
  client_address?: string | null;
  client_gstin?: string | null;
  /** GST state code of the place of supply. Required unless the client
   * already has one saved or a valid GSTIN is given. */
  client_state_code?: string | null;
  taxable_value: number;
  /** Total GST %, default 18. */
  gst_rate?: number | null;
  due_date: string; // YYYY-MM-DD
  description?: string | null;
  sac_code?: string | null;
}

export interface CreatedInvoice {
  id: string;
  invoice_number: string;
  client_name: string;
  taxable_value: number;
  total_value: number;
  /** "none" = business isn't registered for GST, no tax charged. */
  tax_type: TaxType | "none";
  gst_rate: number;
  place_of_supply: string | null;
  due_date: string;
  status: string;
}

export type CreateInvoiceResult =
  | { ok: true; invoice: CreatedInvoice }
  | { ok: false; status: number; error: string };

const fail = (status: number, error: string): CreateInvoiceResult => ({
  ok: false,
  status,
  error,
});

const MAX_TAXABLE = 999_999_999; // numeric(12,2) holds more; this is a sanity cap
const SAC_RE = /^\d{4,8}$/;

/**
 * The one place an invoice gets created. Used by the web form
 * (/api/create-invoice) and by the Telegram bot, so both behave the same.
 * Callers must already have checked that business_id belongs to the
 * person asking — this function trusts it.
 *
 * The invoice number is allocated and the row inserted inside ONE
 * Postgres function (create_invoice), so numbers are sequential per
 * financial year with no gaps from failed inserts, even under concurrency.
 */
export async function createInvoiceForBusiness(
  input: NewInvoiceInput
): Promise<CreateInvoiceResult> {
  const name = (input.client_name ?? "").trim();
  const taxable = Number(input.taxable_value);
  const requestedRate = input.gst_rate ?? DEFAULT_GST_RATE;

  if (!name) return fail(400, "Enter the client name.");
  if (name.length > 200) return fail(400, "Client name is too long.");
  if (!Number.isFinite(taxable) || taxable <= 0) {
    return fail(400, "Enter the amount (a number above 0).");
  }
  if (taxable > MAX_TAXABLE) return fail(400, "That amount is too large.");
  if (!isRealIsoDate(input.due_date)) {
    return fail(400, "Pick a valid due date.");
  }
  const description = input.description?.trim() || null;
  if (description && description.length > 300) {
    return fail(400, "The description is too long (300 characters max).");
  }

  const clientGstin = input.client_gstin ? normalizeGstin(input.client_gstin) : null;
  if (clientGstin && !isValidGstin(clientGstin)) {
    return fail(400, "That client GSTIN doesn't look right. Check it and try again.");
  }
  if (input.client_state_code && !isValidStateCode(input.client_state_code)) {
    return fail(400, "Unknown state.");
  }

  const db = getSupabaseAdmin();

  const { data: business } = await db
    .from("businesses")
    .select("id, state_code, default_sac_code, gst_registered")
    .eq("id", input.business_id)
    .maybeSingle();
  if (!business) return fail(404, "Business not found.");

  // Not registered for GST: no tax, no place of supply needed. The rate
  // the caller sent (if any) is ignored — an unregistered supplier can't
  // charge GST.
  const registered = business.gst_registered !== false;
  const rate = registered ? requestedRate : 0;
  if (registered && !isValidGstRate(rate)) {
    return fail(400, "GST rate must be a number between 0 and 40.");
  }
  if (registered && !business.state_code) {
    return fail(
      400,
      "Set your business state (or GSTIN) in Settings first. Without it Bahi can't tell whether to charge CGST+SGST or IGST."
    );
  }

  const sac = (input.sac_code ?? business.default_sac_code ?? "998311").toString().trim();
  if (!SAC_RE.test(sac)) {
    return fail(400, "SAC/HSN code must be 4 to 8 digits.");
  }

  // 1. Find the client (ignoring upper/lower case) or create it. Details
  // we now have but the saved client lacks get filled in, so the next
  // invoice needs even less typing.
  const { data: existingRows } = await db
    .from("clients")
    .select("id, email, phone, address, gstin, state_code")
    .eq("business_id", input.business_id)
    .ilike("name", escapeLike(name))
    .limit(1);
  const existing = existingRows?.[0] ?? null;

  // Place of supply: GSTIN beats an explicit choice beats the saved client.
  const placeCode =
    stateCodeFromGstin(clientGstin) ??
    input.client_state_code ??
    stateCodeFromGstin(existing?.gstin) ??
    existing?.state_code ??
    null;
  if (registered && !placeCode) {
    return fail(
      400,
      "Choose the client's state. It decides whether the invoice carries IGST or CGST+SGST."
    );
  }

  let clientId: string;
  if (existing) {
    clientId = existing.id;
    const patch: Record<string, string> = {};
    if (!existing.email && input.client_email) patch.email = input.client_email;
    if (!existing.phone && input.client_phone) patch.phone = input.client_phone;
    if (!existing.address && input.client_address) patch.address = input.client_address;
    if (!existing.gstin && clientGstin) patch.gstin = clientGstin;
    if (!existing.state_code && placeCode) patch.state_code = placeCode;
    if (Object.keys(patch).length > 0) {
      await db
        .from("clients")
        .update(patch)
        .eq("id", clientId)
        .eq("business_id", input.business_id);
    }
  } else {
    const { data: created, error } = await db
      .from("clients")
      .insert({
        business_id: input.business_id,
        name,
        email: input.client_email || null,
        phone: input.client_phone || null,
        address: input.client_address || null,
        gstin: clientGstin,
        state_code: placeCode ?? null,
      })
      .select("id")
      .single();

    if (created) {
      clientId = created.id;
    } else if (error?.code === "23505") {
      // Someone created the same client a moment ago — use theirs.
      const { data: again } = await db
        .from("clients")
        .select("id")
        .eq("business_id", input.business_id)
        .ilike("name", escapeLike(name))
        .limit(1);
      if (!again?.[0]) return fail(500, "Could not save the client.");
      clientId = again[0].id;
    } else {
      console.error("Could not save client", error);
      return fail(500, "Could not save the client.");
    }
  }

  // 2. Work out the tax and create the invoice atomically.
  const taxType: TaxType =
    registered && business.state_code && placeCode
      ? taxTypeFor(business.state_code, placeCode)
      : "intra";
  const totals = computeTotals(taxable, rate, taxType);
  const posName = placeCode ? stateName(placeCode) ?? placeCode : null;

  const { data: invoice, error: rpcError } = await db.rpc("create_invoice", {
    p_business_id: input.business_id,
    p_client_id: clientId,
    p_description: description ?? "Professional Services",
    p_sac_code: sac,
    p_taxable: totals.taxable,
    p_cgst_rate: totals.cgstRate,
    p_sgst_rate: totals.sgstRate,
    p_igst_rate: totals.igstRate,
    p_cgst: totals.cgst,
    p_sgst: totals.sgst,
    p_igst: totals.igst,
    p_total: totals.total,
    p_pos_code: placeCode ?? null,
    p_pos_name: posName,
    p_due_date: input.due_date,
  });

  if (rpcError || !invoice) {
    console.error("create_invoice failed", rpcError);
    return fail(500, "Could not create the invoice.");
  }

  return {
    ok: true,
    invoice: {
      id: invoice.id,
      invoice_number: invoice.invoice_number,
      client_name: name,
      taxable_value: Number(invoice.taxable_value),
      total_value: Number(invoice.total_value),
      tax_type: registered ? taxType : "none",
      gst_rate: rate,
      place_of_supply: posName,
      due_date: invoice.due_date,
      status: invoice.status,
    },
  };
}
