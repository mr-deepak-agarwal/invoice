import { createClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/StatCard";
import { InvoiceTable } from "@/components/InvoiceTable";
import { Invoice } from "@/lib/types";

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

  const outstanding = invoices
    .filter((i) => i.status === "sent" || i.status === "overdue")
    .reduce((sum, i) => sum + i.total_value, 0);

  const paid = invoices
    .filter((i) => i.status === "paid")
    .reduce((sum, i) => sum + i.total_value, 0);

  const overdueCount = invoices.filter((i) => i.status === "overdue").length;

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
