"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function MarkPaidButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function markPaid() {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      // Row Level Security only lets you update your own business's invoices.
      const { data, error: updateError } = await supabase
        .from("invoices")
        .update({ status: "paid" })
        .eq("id", invoiceId)
        .select("id");
      if (updateError || !data || data.length === 0) {
        setError("Could not mark this invoice as paid. Please try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not mark this invoice as paid. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        onClick={markPaid}
        disabled={busy}
        className="bg-bahi-red text-white rounded-card px-5 py-2.5 text-sm font-medium hover:bg-bahi-red-dark transition-colors disabled:opacity-60"
      >
        {busy ? "Saving…" : "Mark as paid"}
      </button>
      {error && <p className="text-sm text-bahi-red-dark mt-2">{error}</p>}
    </div>
  );
}
