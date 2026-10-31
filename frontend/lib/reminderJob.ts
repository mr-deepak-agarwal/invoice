import type { SupabaseClient } from "@supabase/supabase-js";
import { sendMessage } from "./telegram";
import { formatDate, formatRupees } from "./format";
import {
  dueSoonCutoff,
  messageTypeFor,
  planReminders,
  type ReminderStep,
} from "./reminders";

interface InvoiceRow {
  id: string;
  invoice_number: string;
  total_value: number | string;
  due_date: string;
  status: string;
  clients: { name: string } | null;
}

const MAX_LINES = 10;

export function buildDigestText(
  today: string,
  items: { name: string; amount: number; invoiceNumber: string; step: ReminderStep; daysOverdue: number }[],
  dashboardUrl: string | null
): string {
  const lines = items.slice(0, MAX_LINES).map((it) => {
    const when =
      it.step === "before"
        ? `due in ${-it.daysOverdue} day${-it.daysOverdue === 1 ? "" : "s"}`
        : it.step === "due"
        ? "due today"
        : `${it.daysOverdue} day${it.daysOverdue === 1 ? "" : "s"} overdue`;
    return `• ${it.name} — ${formatRupees(it.amount, 0)} · ${when} (${it.invoiceNumber})`;
  });
  if (items.length > MAX_LINES) lines.push(`…and ${items.length - MAX_LINES} more`);
  return [
    `📒 Payment reminders — ${formatDate(today)}`,
    `${items.length} invoice${items.length === 1 ? "" : "s"} need a nudge:`,
    "",
    ...lines,
    ...(dashboardUrl
      ? ["", `Send each on WhatsApp (English / हिन्दी): ${dashboardUrl}/dashboard/reminders`]
      : []),
  ].join("\n");
}

/**
 * Daily job: for every business with a connected Telegram chat, tell the
 * owner which invoices need a nudge today. Each reminder step is raised
 * once per invoice (tracked in messages_log), so no daily spam.
 */
export async function runReminderDigests(
  db: SupabaseClient,
  today: string,
  appUrl: string | null
): Promise<{ businesses: number; digests: number; reminders: number }> {
  const { data: identities } = await db
    .from("identities")
    .select("business_id, channel_identifier")
    .eq("channel", "telegram");

  const byBusiness = new Map<string, string[]>();
  for (const row of identities ?? []) {
    const list = byBusiness.get(row.business_id) ?? [];
    list.push(row.channel_identifier);
    byBusiness.set(row.business_id, list);
  }

  let digests = 0;
  let reminders = 0;

  for (const [businessId, chatIds] of byBusiness) {
    const { data: invoices } = await db
      .from("invoices")
      .select("id, invoice_number, total_value, due_date, status, clients(name)")
      .eq("business_id", businessId)
      .eq("status", "sent")
      .lte("due_date", dueSoonCutoff(today))
      .limit(500);
    const rows = (invoices ?? []) as unknown as InvoiceRow[];
    if (rows.length === 0) continue;

    const { data: logs } = await db
      .from("messages_log")
      .select("invoice_id, message_type")
      .in("invoice_id", rows.map((r) => r.id))
      .like("message_type", "reminder_%");
    const logged = new Set(
      (logs ?? []).map((l) => `${l.invoice_id}:${String(l.message_type).replace(/^reminder_/, "")}`)
    );

    const plan = planReminders(rows, logged, today);
    if (plan.length === 0) continue;

    const text = buildDigestText(
      today,
      plan.map((p) => ({
        name: p.invoice.clients?.name ?? "Client",
        amount: Number(p.invoice.total_value),
        invoiceNumber: p.invoice.invoice_number,
        step: p.step,
        daysOverdue: p.daysOverdue,
      })),
      appUrl
    );

    let delivered = false;
    for (const chatId of chatIds) {
      if (await sendMessage(chatId, text)) delivered = true;
    }
    if (!delivered) continue; // try again tomorrow

    await db.from("messages_log").insert(
      plan.map((p) => ({
        business_id: businessId,
        invoice_id: p.invoice.id,
        channel: "telegram",
        message_type: messageTypeFor(p.step),
      }))
    );
    digests += 1;
    reminders += plan.length;
  }

  return { businesses: byBusiness.size, digests, reminders };
}
