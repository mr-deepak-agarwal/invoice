import { NextRequest, NextResponse } from "next/server";
import { getSessionBusiness, unauthorized } from "@/lib/auth";
import { createInvoiceForBusiness } from "@/lib/invoices";
import { LIMITS, allow } from "@/lib/rateLimit";

export async function POST(req: NextRequest) {
  const session = await getSessionBusiness();
  if (!session) return unauthorized();

  if (
    !(await allow(
      `create:${session.businessId}`,
      LIMITS.create.max,
      LIMITS.create.windowSeconds
    ))
  ) {
    return NextResponse.json(
      { error: "Too many invoices created in the last hour. Try again later." },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
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
    client_gstin: body.client_gstin,
    client_state_code: body.client_state_code,
    taxable_value: body.taxable_value,
    gst_rate: body.gst_rate === "" ? null : body.gst_rate,
    due_date: body.due_date,
    description: body.description,
    sac_code: body.sac_code,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ...result.invoice, pdf_url: null });
}
