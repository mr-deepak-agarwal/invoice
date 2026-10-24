import { NextRequest, NextResponse } from "next/server";
import { getSessionBusiness, unauthorized } from "@/lib/auth";
import { parseInvoiceMessage } from "@/lib/parseFlow";

/**
 * Reads a free-text message into invoice fields for the signed-in user's
 * business. The Telegram bot uses the same lib/parseFlow.ts directly.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionBusiness();
  if (!session) return unauthorized();

  const body = await req.json().catch(() => null);
  const rawText = body?.raw_text;
  if (!rawText || typeof rawText !== "string") {
    return NextResponse.json({ error: "raw_text is required" }, { status: 400 });
  }

  const parsed = await parseInvoiceMessage(rawText, session.businessId);
  return NextResponse.json(parsed);
}
