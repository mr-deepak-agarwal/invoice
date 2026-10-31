import { NextRequest, NextResponse } from "next/server";
import { getSessionBusiness, unauthorized } from "@/lib/auth";
import { parseInvoiceMessage } from "@/lib/parseFlow";
import { LIMITS, allow } from "@/lib/rateLimit";

/**
 * Reads a free-text message into invoice fields for the signed-in user's
 * business. The Telegram bot uses the same lib/parseFlow.ts directly.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionBusiness();
  if (!session) return unauthorized();

  if (
    !(await allow(
      `parse:${session.businessId}`,
      LIMITS.parse.max,
      LIMITS.parse.windowSeconds
    ))
  ) {
    return NextResponse.json(
      { error: "You've hit the hourly limit for reading messages. Try again in a bit." },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => null);
  const rawText = body?.raw_text;
  if (!rawText || typeof rawText !== "string") {
    return NextResponse.json({ error: "raw_text is required" }, { status: 400 });
  }
  if (rawText.length > 2000) {
    return NextResponse.json(
      { error: "That message is too long (2000 characters max)." },
      { status: 400 }
    );
  }

  const parsed = await parseInvoiceMessage(rawText, session.businessId);
  return NextResponse.json(parsed);
}
