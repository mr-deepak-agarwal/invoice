import { createClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/StatCard";
import { InvoiceTable } from "@/components/InvoiceTable";
import { Invoice } from "@/lib/types";
import { effectiveStatus } from "@/lib/status";

function formatRupees(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

export default async function DashboardOverview() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_auth_id", user!.id)
    .single();

  const { data: invoicesRaw } = await supabase
    .from("invoices")
    .select("*, clients(name, email, phone)")
    .eq("business_id", business?.id)
    .order("created_at", { ascending: false });

  const invoices = (invoicesRaw ?? []) as unknown as Invoice[];

  // "Overdue" is worked out from the due date, not stored (see lib/status.ts)
  const withStatus = invoices.map((i) => ({
    ...i,
    shown: effectiveStatus(i.status, i.due_date),
  }));

  const outstanding = withStatus
    .filter((i) => i.shown === "sent" || i.shown === "overdue")
    .reduce((sum, i) => sum + i.total_value, 0);

  const paid = withStatus
    .filter((i) => i.shown === "paid")
    .reduce((sum, i) => sum + i.total_value, 0);

  const overdueCount = withStatus.filter((i) => i.shown === "overdue").length;

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-display text-2xl text-ink mb-1">Overview</h1>
        <p className="text-sm text-slate">
          Everything owed, everything settled, at a glance.
        </p>
      </header>

      <div className="grid grid-cols-3 gap-4 mb-10">
        <StatCard
          label="Outstanding"
          value={formatRupees(outstanding)}
          accent="bahi-red"
        />
        <StatCard label="Paid" value={formatRupees(paid)} />
        <StatCard
          label="Overdue"
          value={String(overdueCount)}
          accent="marigold"
        />
      </div>

      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-lg text-ink">Recent entries</h2>
      </div>
      <InvoiceTable invoices={invoices.slice(0, 8)} />
    </div>
  );
}
