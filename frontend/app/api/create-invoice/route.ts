import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { nextInvoiceNumber } from "@/lib/db";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    business_id,
    client_name,
    client_email,
    client_phone,
    client_address,
    taxable_value,
    due_date,
    description = "Professional Services",
    sac_code = "998311",
    place_of_supply,
  } = body;

  if (!business_id || !client_name || !taxable_value || !due_date) {
    return NextResponse.json(
      { error: "business_id, client_name, taxable_value, and due_date are required" },
      { status: 400 }
    );
  }

  // 1. Find or create the client under this business
  const { data: existingClient } = await getSupabaseAdmin()
    .from("clients")
    .select("id")
    .eq("business_id", business_id)
    .eq("name", client_name)
    .maybeSingle();

  let clientId: string;
  if (existingClient) {
    clientId = existingClient.id;
  } else {
    const { data: newClient, error: clientError } = await getSupabaseAdmin()
      .from("clients")
      .insert({
        business_id,
        name: client_name,
        email: client_email ?? null,
        phone: client_phone ?? null,
        address: client_address ?? null,
      })
      .select("id")
      .single();
    if (clientError || !newClient) {
      return NextResponse.json(
        { error: "Could not create client" },
        { status: 500 }
      );
    }
    clientId = newClient.id;
  }

  // 2. Fetch business to get GST rates / place of supply defaults
  const { data: business } = await getSupabaseAdmin()
    .from("businesses")
    .select("*")
    .eq("id", business_id)
    .single();

  if (!business) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  }

  // 3. Calculate tax (assumes intra-state CGST+SGST by default; swap to
  // IGST if place_of_supply differs from business state)
  const cgstRate = 9.0;
  const sgstRate = 9.0;
  const taxAmount = taxable_value * ((cgstRate + sgstRate) / 100);
  const totalValue = taxable_value + taxAmount;

  const invoiceNumber = await nextInvoiceNumber(
    business_id,
    business.invoice_prefix ?? "INV"
  );

  // 4. Insert invoice
  const { data: invoice, error: invoiceError } = await getSupabaseAdmin()
    .from("invoices")
    .insert({
      business_id,
      client_id: clientId,
      invoice_number: invoiceNumber,
      description,
      sac_code,
      taxable_value,
      cgst_rate: cgstRate,
      sgst_rate: sgstRate,
      total_value: totalValue,
      place_of_supply: place_of_supply ?? business.address,
      due_date,
      status: "sent",
    })
    .select("*")
    .single();

  if (invoiceError || !invoice) {
    return NextResponse.json(
      { error: "Could not create invoice" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    id: invoice.id,
    invoice_number: invoice.invoice_number,
    client_name,
    taxable_value: invoice.taxable_value,
    total_value: invoice.total_value,
    due_date,
    status: invoice.status,
    pdf_url: null, // populated after PDF generation step (next milestone)
  });
}
