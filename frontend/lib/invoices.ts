import { getSupabaseAdmin } from "./supabaseAdmin";
import { escapeLike, nextInvoiceNumber } from "./db";

/** CGST + SGST, 9% each (intra-state). IGST for other states isn't built yet. */
export const GST_RATE_EACH = 9;
export const GST_RATE_TOTAL = GST_RATE_EACH * 2;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeTotals(taxable: number) {
  const cgst = round2((taxable * GST_RATE_EACH) / 100);
  const sgst = round2((taxable * GST_RATE_EACH) / 100);
  return { cgst, sgst, total: round2(taxable + cgst + sgst) };
}

export interface NewInvoiceInput {
  business_id: string;
  client_name: string;
  client_email?: string | null;
  client_phone?: string | null;
  client_address?: string | null;
  taxable_value: number;
  due_date: string; // YYYY-MM-DD
  description?: string | null;
  sac_code?: string;
  place_of_supply?: string | null;
}

export interface CreatedInvoice {
  id: string;
  invoice_number: string;
  client_name: string;
  taxable_value: number;
  total_value: number;
  due_date: string;
  status: string;
}

export type CreateInvoiceResult =
  | { ok: true; invoice: CreatedInvoice }
  | { ok: false; status: number; error: string };

/**
 * The one place an invoice gets created. Used by the web form
 * (/api/create-invoice) and by the Telegram bot, so both behave the same.
 * Callers must already have checked that business_id belongs to the
 * person asking — this function trusts it.
 */
export async function createInvoiceForBusiness(
  input: NewInvoiceInput
): Promise<CreateInvoiceResult> {
  const name = (input.client_name ?? "").trim();
  const taxable = Number(input.taxable_value);

  if (!name) return { ok: false, status: 400, error: "Enter the client name." };
  if (!Number.isFinite(taxable) || taxable <= 0) {
    return { ok: false, status: 400, error: "Enter the amount (a number above 0)." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.due_date ?? "")) {
    return { ok: false, status: 400, error: "Pick a valid due date." };
  }

  const db = getSupabaseAdmin();

  const { data: business } = await db
    .from("businesses")
    .select("id, address, invoice_prefix")
    .eq("id", input.business_id)
    .maybeSingle();
  if (!business) return { ok: false, status: 404, error: "Business not found." };

  // 1. Find the client (ignoring upper/lower case) or create it. If the
  // client already exists but is missing contact details we now have,
  // fill those in so the next invoice needs even less typing.
  const { data: existing } = await db
    .from("clients")
    .select("id, email, phone, address")
    .eq("business_id", input.business_id)
    .ilike("name", escapeLike(name))
    .limit(1);

  let clientId: string;
  if (existing && existing.length > 0) {
    clientId = existing[0].id;
    const patch: Record<string, string> = {};
    if (!existing[0].email && input.client_email) patch.email = input.client_email;
    if (!existing[0].phone && input.client_phone) patch.phone = input.client_phone;
    if (!existing[0].address && input.client_address) patch.address = input.client_address;
    if (Object.keys(patch).length > 0) {
      await db.from("clients").update(patch).eq("id", clientId);
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
      })
      .select("id")
      .single();
    if (error || !created) {
      return { ok: false, status: 500, error: "Could not save the client." };
    }
    clientId = created.id;
  }

  // 2. Insert the invoice. If the number is already taken (two created at
  // once, or an old one deleted), try the next number a few times.
  const totals = computeTotals(taxable);
  for (let attempt = 0; attempt < 5; attempt++) {
    const invoiceNumber = await nextInvoiceNumber(
      input.business_id,
      business.invoice_prefix ?? "INV",
      attempt
    );

    const { data: invoice, error } = await db
      .from("invoices")
      .insert({
        business_id: input.business_id,
        client_id: clientId,
        invoice_number: invoiceNumber,
        description: input.description?.trim() || "Professional Services",
        sac_code: input.sac_code ?? "998311",
        taxable_value: taxable,
        cgst_rate: GST_RATE_EACH,
        sgst_rate: GST_RATE_EACH,
        total_value: totals.total,
        place_of_supply: input.place_of_supply ?? business.address,
        due_date: input.due_date,
        status: "sent",
      })
      .select("id, invoice_number, taxable_value, total_value, due_date, status")
      .single();

    if (!error && invoice) {
      return {
        ok: true,
        invoice: {
          id: invoice.id,
          invoice_number: invoice.invoice_number,
          client_name: name,
          taxable_value: Number(invoice.taxable_value),
          total_value: Number(invoice.total_value),
          due_date: invoice.due_date,
          status: invoice.status,
        },
      };
    }
    // 23505 = duplicate invoice number -> retry with the next one
    if (error?.code !== "23505") {
      return { ok: false, status: 500, error: "Could not create the invoice." };
    }
  }
  return { ok: false, status: 500, error: "Could not find a free invoice number." };
}
