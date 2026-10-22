import { createClient } from "@/lib/supabase/server";
import { InvoiceTable } from "@/components/InvoiceTable";
import { Invoice } from "@/lib/types";

export default async function InvoicesPage() {
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

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-display text-2xl text-ink mb-1">
          All invoices
        </h1>
        <p className="text-sm text-slate">
          {invoices.length} entr{invoices.length === 1 ? "y" : "ies"} in the
          ledger.
        </p>
      </header>
      <InvoiceTable invoices={invoices} />
    </div>
  );
}
