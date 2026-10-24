import { NextRequest, NextResponse } from "next/server";
import { verifySecret } from "@/lib/telegram";
import { handleTelegramUpdate } from "@/lib/telegramBot";

/**
 * Telegram calls this URL for every message sent to the bot.
 *
 * Anyone on the internet can POST here, so the request must carry the
 * secret we gave Telegram when registering the webhook
 * (TELEGRAM_WEBHOOK_SECRET). Without it we answer 403 and do nothing.
 *
 * Once the secret checks out we ALWAYS answer 200, even if handling
 * failed. Otherwise Telegram keeps retrying the same message.
 * Errors go to the Vercel logs instead.
 */
export async function POST(req: NextRequest) {
  const ok = verifySecret(
    req.headers.get("x-telegram-bot-api-secret-token"),
    process.env.TELEGRAM_WEBHOOK_SECRET
  );
  if (!ok) return new NextResponse("Forbidden", { status: 403 });

  const update = await req.json().catch(() => null);
  if (update) {
    try {
      // Everything is awaited before replying: on Vercel, work started
      // after the response is sent can be cut off.
      await handleTelegramUpdate(update);
    } catch (err) {
      console.error("Telegram update failed", err);
    }
  }
  return NextResponse.json({ ok: true });
}
