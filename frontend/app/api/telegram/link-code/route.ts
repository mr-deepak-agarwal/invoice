import { NextResponse } from "next/server";
import { getSessionBusiness, unauthorized } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { generateLinkCode } from "@/lib/telegram";

const CODE_LIFETIME_MS = 15 * 60 * 1000;

/** Signed-in user asks for a one-time code to connect a Telegram chat. */
export async function POST() {
  const session = await getSessionBusiness();
  if (!session) return unauthorized();

  const db = getSupabaseAdmin();
  // One live code per business; asking again replaces the old one.
  await db.from("telegram_link_codes").delete().eq("business_id", session.businessId);

  const code = generateLinkCode();
  const expiresAt = new Date(Date.now() + CODE_LIFETIME_MS).toISOString();
  const { error } = await db.from("telegram_link_codes").insert({
    code,
    business_id: session.businessId,
    expires_at: expiresAt,
  });
  if (error) {
    console.error("Could not create Telegram link code", error);
    return NextResponse.json(
      { error: "Could not create a code. Have you run supabase/telegram.sql?" },
      { status: 500 }
    );
  }

  const username = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "") || null;
  return NextResponse.json({
    code,
    expires_at: expiresAt,
    bot_username: username,
    deep_link: username ? `https://t.me/${username}?start=${code}` : null,
  });
}
