import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getBaseUrl } from "@/lib/baseUrl";
import { todayInIndia } from "@/lib/status";
import { dueSoonCutoff, reminderStepFor } from "@/lib/reminders";
import { RemindersList, type ReminderItem } from "./RemindersList";

export const dynamic = "force-dynamic";

interface Row {
  id: string;
  invoice_number: string;
  total_value: number | string;
  due_date: string;
  public_token: string;
  clients: { name: string; phone: string | null } | null;
}

export default async function RemindersPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: business } = await supabase
    .from("businesses")
    .select("name, upi_id")
    .eq("owner_auth_id", user.id)
    .single();
  if (!business) redirect("/dashboard");

  const today = todayInIndia();
  const { data } = await supabase
    .from("invoices")
    .select("id, invoice_number, total_value, due_date, public_token, clients(name, phone)")
    .eq("status", "sent")
    .lte("due_date", dueSoonCutoff(today))
    .order("due_date", { ascending: true })
    .limit(200);
  const rows = (data ?? []) as unknown as Row[];

  const { data: logs } = rows.length
    ? await supabase
        .from("messages_log")
        .select("invoice_id, message_type")
        .in("invoice_id", rows.map((r) => r.id))
        .like("message_type", "reminder_%")
    : { data: [] as { invoice_id: string; message_type: string }[] };
  const logged = new Set(
    (logs ?? []).map((l) => `${l.invoice_id}:${l.message_type.replace(/^reminder_/, "")}`)
  );

  const base = getBaseUrl();
  const items: ReminderItem[] = [];
  for (const r of rows) {
    const s = reminderStepFor(r.due_date, today);
    if (!s) continue;
    items.push({
      invoiceId: r.id,
      clientName: r.clients?.name ?? "Client",
      phone: r.clients?.phone ?? null,
      invoiceNumber: r.invoice_number,
      amount: Number(r.total_value),
      dueDate: r.due_date,
      step: s.step,
      daysOverdue: s.daysOverdue,
      reminded: logged.has(`${r.id}:${s.step}`),
      payUrl: business.upi_id && base ? `${base}/pay/${r.public_token}` : null,
    });
  }
  items.sort((a, b) => b.daysOverdue - a.daysOverdue);

  return (
    <div className="max-w-3xl">
      <header className="mb-6">
        <h1 className="font-display text-2xl text-ink mb-1">Reminders</h1>
        <p className="text-sm text-slate">
          Invoices that are due within 3 days or overdue. Messages go from
          your own WhatsApp — Bahi writes them, you tap send.
        </p>
      </header>

      {!business.upi_id && (
        <div className="mb-6 text-sm text-ink bg-marigold-soft rounded-card px-3 py-2">
          Add your UPI ID in{" "}
          <Link href="/dashboard/settings" className="underline text-bahi-red">
            Settings
          </Link>{" "}
          and every reminder will include a payment link.
        </div>
      )}

      <RemindersList items={items} businessName={business.name} />
    </div>
  );
}
