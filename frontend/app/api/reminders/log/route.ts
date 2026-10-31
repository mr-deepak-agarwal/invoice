import { NextRequest, NextResponse } from "next/server";
import { getSessionBusiness, unauthorized } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { messageTypeFor, type ReminderStep } from "@/lib/reminders";

const STEPS: ReminderStep[] = [
  "before", "due", "overdue_1", "overdue_3", "overdue_7", "overdue_15", "overdue_30",
];
const CHANNELS = ["whatsapp", "email"] as const;

/** Records that the owner sent (or copied) a reminder for an invoice. */
export async function POST(req: NextRequest) {
  const session = await getSessionBusiness();
  if (!session) return unauthorized();

  const body = await req.json().catch(() => null);
  const step = body?.step as ReminderStep;
  const channel = body?.channel as (typeof CHANNELS)[number];
  if (
    typeof body?.invoice_id !== "string" ||
    !STEPS.includes(step) ||
    !CHANNELS.includes(channel)
  ) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const db = getSupabaseAdmin();
  // The invoice must belong to the signed-in user's business.
  const { data: invoice } = await db
    .from("invoices")
    .select("id")
    .eq("id", body.invoice_id)
    .eq("business_id", session.businessId)
    .maybeSingle();
  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  }

  const { error } = await db.from("messages_log").insert({
    business_id: session.businessId,
    invoice_id: invoice.id,
    channel,
    message_type: messageTypeFor(step),
  });
  if (error) {
    console.error("Could not log reminder", error);
    return NextResponse.json({ error: "Could not save." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
