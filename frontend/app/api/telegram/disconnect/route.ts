import { NextResponse } from "next/server";
import { getSessionBusiness, unauthorized } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

/** Removes every Telegram chat linked to the signed-in user's business. */
export async function POST() {
  const session = await getSessionBusiness();
  if (!session) return unauthorized();

  const { error } = await getSupabaseAdmin()
    .from("identities")
    .delete()
    .eq("business_id", session.businessId)
    .eq("channel", "telegram");

  if (error) {
    return NextResponse.json({ error: "Could not disconnect." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
