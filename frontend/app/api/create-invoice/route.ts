import { NextRequest, NextResponse } from "next/server";
import { getSessionBusiness, unauthorized } from "@/lib/auth";
import { createInvoiceForBusiness } from "@/lib/invoices";

export async function POST(req: NextRequest) {
  const session = await getSessionBusiness();
  if (!session) return unauthorized();

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // business_id from the browser is ignored on purpose: the invoice always
  // goes to the business that belongs to the signed-in user.
  const result = await createInvoiceForBusiness({
    business_id: session.businessId,
    client_name: body.client_name,
    client_email: body.client_email,
    client_phone: body.client_phone,
    client_address: body.client_address,
    taxable_value: body.taxable_value,
    due_date: body.due_date,
    description: body.description,
    sac_code: body.sac_code,
    place_of_supply: body.place_of_supply,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ...result.invoice, pdf_url: null });
}
