import { randomInt, timingSafeEqual } from "node:crypto";

/**
 * Small Telegram Bot API helpers. Server-side only (uses the bot token).
 * TELEGRAM_API_BASE exists only so tests can point at a fake server.
 */

function endpoint(method: string): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  const base = process.env.TELEGRAM_API_BASE ?? "https://api.telegram.org";
  return `${base}/bot${token}/${method}`;
}

async function call(
  method: string,
  payload: Record<string, unknown>
): Promise<boolean> {
  const res = await fetch(endpoint(method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`Telegram ${method} failed: ${res.status} ${body}`);
  }
  return res.ok;
}

const noPreview = { link_preview_options: { is_disabled: true } };

export function sendMessage(
  chatId: number | string,
  text: string,
  extra: Record<string, unknown> = {}
) {
  return call("sendMessage", { chat_id: chatId, text, ...noPreview, ...extra });
}

/** Editing without reply_markup also removes the buttons. */
export function editMessageText(
  chatId: number | string,
  messageId: number,
  text: string
) {
  return call("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...noPreview,
  });
}

export function answerCallbackQuery(callbackQueryId: string, text?: string) {
  return call("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  });
}

// No 0/O/1/I/L so a code is easy to read out or retype.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** 10 random characters, about 8e14 possibilities, single use, 15 min life. */
export function generateLinkCode(): string {
  let code = "";
  for (let i = 0; i < 10; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/** Telegram sends our secret back in a header on every webhook call. */
export function verifySecret(
  provided: string | null,
  expected: string | undefined
): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** "/start@MyBot ABC123" -> { name: "start", arg: "ABC123" } */
export function parseCommand(
  text: string
): { name: string; arg: string } | null {
  const m = text.match(/^\/([A-Za-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  return { name: m[1].toLowerCase(), arg: (m[2] ?? "").trim() };
}
