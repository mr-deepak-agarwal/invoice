import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { runReminderDigests } from "@/lib/reminderJob";
import { todayInIndia } from "@/lib/status";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest, secret: string): boolean {
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Daily job (see vercel.json). Vercel Cron sends
 * "Authorization: Bearer <CRON_SECRET>" automatically when CRON_SECRET is
 * set. Without the secret this route refuses everything.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  }
  if (!authorized(req, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runReminderDigests(
      getSupabaseAdmin(),
      todayInIndia(),
      process.env.APP_URL?.replace(/\/+$/, "") ?? null
    );
    return NextResponse.json(result);
  } catch (err) {
    console.error("Reminder job failed", err);
    return NextResponse.json({ error: "Job failed" }, { status: 500 });
  }
}
