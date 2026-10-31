import { getSupabaseAdmin } from "./supabaseAdmin";
import { resolveBusinessId } from "./db";
import { parseInvoiceMessage } from "./parseFlow";
import { createInvoiceForBusiness } from "./invoices";
import {
  DEFAULT_GST_RATE,
  computeTotals,
  stateName,
  taxTypeFor,
} from "./gst";
import { LIMITS, allow } from "./rateLimit";
import { formatDate, formatRupees } from "./format";
import {
  answerCallbackQuery,
  editMessageText,
  parseCommand,
  sendMessage,
} from "./telegram";

/** How long the "Create invoice" button stays valid. */
const PENDING_MAX_AGE_MS = 60 * 60 * 1000;

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { message_id: number; chat: { id: number; type: string } };
  };
}

interface PendingPayload {
  client_name: string;
  client_email: string | null;
  client_phone: string | null;
  client_address: string | null;
  client_gstin: string | null;
  client_state_code: string | null;
  taxable_value: number;
  gst_rate: number;
  description: string | null;
  due_date: string;
  /** Fields filled from saved defaults rather than the message. */
  assumed?: string[];
}

const EXAMPLE =
  "make invoice for Marc, panjim goa, 25000, web development, due 1 nov 2026, email accounts@marc.com";

const HELP = `Send me an invoice in plain words, for example:

${EXAMPLE}

I'll show you a summary and you tap Create to confirm.

/help - show this message
/link CODE - connect this chat to your Bahi account`;

const NOT_CONNECTED = `This chat isn't connected to a Bahi account yet.

Open your dashboard, go to Telegram, tap "Get connection link", then tap the link it gives you (or send /link CODE here).`;

export async function handleTelegramUpdate(update: TelegramUpdate) {
  if (update.callback_query) {
    await handleCallback(update.callback_query);
    return;
  }

  const msg = update.message;
  // Private chats only, so a group can never be linked to an account.
  if (!msg?.text || msg.chat.type !== "private") return;

  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const cmd = parseCommand(text);

  if (cmd) {
    if ((cmd.name === "start" || cmd.name === "link") && cmd.arg) {
      await linkChat(chatId, cmd.arg);
      return;
    }
    if (cmd.name === "link") {
      await sendMessage(
        chatId,
        "Send /link followed by your code, like /link ABCD234567. You can get a code in your dashboard under Telegram."
      );
      return;
    }
    if (cmd.name === "start") {
      const connected = await resolveBusinessId("telegram", String(chatId));
      await sendMessage(
        chatId,
        connected ? `You're connected.\n\n${HELP}` : `Welcome to Bahi.\n\n${NOT_CONNECTED}`
      );
      return;
    }
    await sendMessage(chatId, HELP);
    return;
  }

  await handleInvoiceMessage(chatId, text);
}

async function linkChat(chatId: number, rawCode: string) {
  const code = rawCode.trim().toUpperCase();
  const db = getSupabaseAdmin();

  const { data: row } = await db
    .from("telegram_link_codes")
    .select("code, business_id, expires_at")
    .eq("code", code)
    .maybeSingle();

  if (!row || new Date(row.expires_at).getTime() < Date.now()) {
    await sendMessage(
      chatId,
      "That code is invalid or has expired. Open your dashboard, go to Telegram and get a new connection link."
    );
    return;
  }

  const { error } = await db.from("identities").upsert(
    {
      business_id: row.business_id,
      channel: "telegram",
      channel_identifier: String(chatId),
    },
    { onConflict: "channel,channel_identifier" }
  );
  if (error) {
    console.error("Telegram link failed", error);
    await sendMessage(chatId, "Could not connect this chat. Please try again.");
    return;
  }

  await db.from("telegram_link_codes").delete().eq("code", code);

  const { data: business } = await db
    .from("businesses")
    .select("name")
    .eq("id", row.business_id)
    .maybeSingle();

  await sendMessage(
    chatId,
    `Connected to ${business?.name ?? "your account"}.\n\n${HELP}`
  );
}

function buildSummary(
  p: PendingPayload,
  supplier: { state_code: string | null; gst_registered: boolean }
): string {
  const lines = ["Create this invoice?", "", `Client: ${p.client_name}`];
  if (p.client_email) lines.push(`Email: ${p.client_email}`);
  if (p.client_phone) lines.push(`Mobile: ${p.client_phone}`);
  if (p.client_address) lines.push(`Address: ${p.client_address}`);
  if (p.client_gstin) lines.push(`GSTIN: ${p.client_gstin}`);
  lines.push(`For: ${p.description || "Professional Services"}`);

  if (!supplier.gst_registered || !supplier.state_code || !p.client_state_code) {
    // Not registered for GST: the amount is the total.
    lines.push(`Amount: ${formatRupees(p.taxable_value, 2)} (no GST charged)`);
  } else {
    const taxType = taxTypeFor(supplier.state_code, p.client_state_code);
    const totals = computeTotals(p.taxable_value, p.gst_rate, taxType);
    const taxLabel =
      taxType === "intra"
        ? `CGST ${totals.cgstRate}% + SGST ${totals.sgstRate}%`
        : `IGST ${totals.igstRate}%`;
    lines.push(
      `Place of supply: ${stateName(p.client_state_code) ?? p.client_state_code} (${p.client_state_code})${
        p.assumed?.includes("client_state") ? " — assumed same as yours" : ""
      }`
    );
    lines.push(
      `Amount: ${formatRupees(p.taxable_value, 2)} + ${taxLabel} (${formatRupees(totals.totalTax, 2)}) = ${formatRupees(totals.total, 2)}`
    );
  }
  lines.push(
    `Due: ${formatDate(p.due_date)}${
      p.assumed?.includes("due_date") ? " — your default terms" : ""
    }`
  );
  return lines.join("\n");
}

async function handleInvoiceMessage(chatId: number, text: string) {
  const businessId = await resolveBusinessId("telegram", String(chatId));
  if (!businessId) {
    await sendMessage(chatId, NOT_CONNECTED);
    return;
  }

  if (text.length > 2000) {
    await sendMessage(chatId, "That message is too long. Please keep it under 2000 characters.");
    return;
  }

  if (
    !(await allow(
      `parse:${businessId}`,
      LIMITS.parse.max,
      LIMITS.parse.windowSeconds
    ))
  ) {
    await sendMessage(
      chatId,
      "You've hit the hourly limit for reading messages. Please try again in a while."
    );
    return;
  }

  const db = getSupabaseAdmin();
  const { data: business } = await db
    .from("businesses")
    .select("state_code, gst_registered")
    .eq("id", businessId)
    .maybeSingle();
  const registered = business?.gst_registered !== false;
  if (!business || (registered && !business.state_code)) {
    await sendMessage(
      chatId,
      "Before creating invoices, open your dashboard → Settings and set your business state (or GSTIN). Bahi needs it to choose between CGST+SGST and IGST."
    );
    return;
  }

  const parsed = await parseInvoiceMessage(text, businessId);
  if (parsed.parse_note) {
    // Not shown to the customer; the owner can see it in the Vercel logs.
    console.error("Invoice reader note:", parsed.parse_note);
  }
  if (parsed.amount_includes_gst) {
    await sendMessage(
      chatId,
      "That message says the amount includes GST. Please send the amount before GST, for example:\n\n" +
        EXAMPLE
    );
    return;
  }

  const missing: string[] = [];
  if (!parsed.client_name) missing.push("client name");
  if (!parsed.taxable_value) missing.push("amount");
  if (!parsed.due_date) missing.push("due date");
  if (registered && !parsed.client_state_code) missing.push("client's city or state (for IGST vs CGST+SGST)");
  if (missing.length > 0) {
    await sendMessage(
      chatId,
      `I couldn't find: ${missing.join(", ")}.\n\nPlease send the whole message again with ${
        missing.length > 1 ? "them" : "it"
      } included, for example:\n\n${EXAMPLE}`
    );
    return;
  }

  const payload: PendingPayload = {
    client_name: parsed.client_name!,
    client_email: parsed.client_email,
    client_phone: parsed.client_phone,
    client_address: parsed.company_address,
    client_gstin: parsed.client_gstin,
    client_state_code: parsed.client_state_code,
    taxable_value: parsed.taxable_value!,
    gst_rate: parsed.gst_rate ?? DEFAULT_GST_RATE,
    description: parsed.description,
    due_date: parsed.due_date!,
    assumed: parsed.defaults_applied,
  };

  // Tidy up requests nobody confirmed.
  await db
    .from("telegram_pending")
    .delete()
    .lt("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  const { data: pending, error } = await db
    .from("telegram_pending")
    .insert({ business_id: businessId, chat_id: String(chatId), payload })
    .select("id")
    .single();
  if (error || !pending) {
    console.error("Could not save pending Telegram invoice", error);
    await sendMessage(chatId, "Something went wrong on our side. Please try again.");
    return;
  }

  await sendMessage(chatId, buildSummary(payload, {
    state_code: business.state_code ?? null,
    gst_registered: registered,
  }), {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Create invoice", callback_data: `ok:${pending.id}` },
          { text: "✖ Cancel", callback_data: `no:${pending.id}` },
        ],
      ],
    },
  });
}

async function handleCallback(
  cb: NonNullable<TelegramUpdate["callback_query"]>
) {
  const chatId = cb.message?.chat.id;
  const messageId = cb.message?.message_id;
  const m = (cb.data ?? "").match(/^(ok|no):([0-9a-f-]{36})$/);
  if (!chatId || !messageId || !m) {
    await answerCallbackQuery(cb.id);
    return;
  }
  const [, action, id] = m;
  const db = getSupabaseAdmin();

  // Claim the request first (delete + return it). A double tap, or a tap
  // from a different chat, finds nothing and can't create a second invoice.
  const { data: claimed } = await db
    .from("telegram_pending")
    .delete()
    .eq("id", id)
    .eq("chat_id", String(chatId))
    .select("*");
  const pending = claimed?.[0];
  if (!pending) {
    await answerCallbackQuery(cb.id, "Already handled, or it expired.");
    return;
  }

  if (action === "no") {
    await answerCallbackQuery(cb.id);
    await editMessageText(chatId, messageId, "Cancelled. Nothing was created.");
    return;
  }

  if (Date.now() - new Date(pending.created_at).getTime() > PENDING_MAX_AGE_MS) {
    await answerCallbackQuery(cb.id);
    await editMessageText(chatId, messageId, "That request expired. Please send the invoice again.");
    return;
  }

  const stillLinked = await resolveBusinessId("telegram", String(chatId));
  if (stillLinked !== pending.business_id) {
    await answerCallbackQuery(cb.id);
    await editMessageText(chatId, messageId, "This chat is no longer connected to your account.");
    return;
  }

  const p = pending.payload as PendingPayload;
  const result = await createInvoiceForBusiness({
    business_id: pending.business_id,
    client_name: p.client_name,
    client_email: p.client_email,
    client_phone: p.client_phone,
    client_address: p.client_address,
    client_gstin: p.client_gstin,
    client_state_code: p.client_state_code,
    taxable_value: p.taxable_value,
    gst_rate: p.gst_rate,
    description: p.description,
    due_date: p.due_date,
  });
  await answerCallbackQuery(cb.id);

  if (!result.ok) {
    await editMessageText(
      chatId,
      messageId,
      `Couldn't create the invoice: ${result.error}\n\nPlease send it again.`
    );
    return;
  }

  const inv = result.invoice;
  const appUrl = process.env.APP_URL?.replace(/\/$/, "");
  const lines = [
    `✅ Invoice ${inv.invoice_number} created`,
    `${inv.client_name} - ${formatRupees(inv.total_value, 2)} ${
      inv.tax_type === "none"
        ? "(no GST)"
        : `(incl. ${inv.gst_rate}% ${inv.tax_type === "inter" ? "IGST" : "GST"}, ${inv.place_of_supply})`
    }`,
    `Due ${formatDate(inv.due_date)}`,
  ];
  if (appUrl) lines.push("", `${appUrl}/dashboard/invoices/${inv.id}`);
  await editMessageText(chatId, messageId, lines.join("\n"));
}
