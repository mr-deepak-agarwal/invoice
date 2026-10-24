import Link from "next/link";
import { Invoice } from "@/lib/types";
import { formatDate, formatRupees } from "@/lib/format";
import { effectiveStatus } from "@/lib/status";
import { StatusBadge } from "./StatusBadge";

export function InvoiceTable({ invoices }: { invoices: Invoice[] }) {
  if (invoices.length === 0) {
    return (
      <div className="text-center py-16 border border-dashed border-ledger-line rounded-card">
        <p className="font-display text-lg text-ink mb-1">
          No entries yet
        </p>
        <p className="text-sm text-slate">
          Your first invoice will appear here as a new ledger line.
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-ledger-line border-t border-b border-ledger-line">
      {invoices.map((invoice) => (
        <Link
          key={invoice.id}
          href={`/dashboard/invoices/${invoice.id}`}
          className="flex items-center justify-between gap-4 py-4 hover:bg-paper-raised transition-colors"
        >
          <div className="flex items-center gap-4 min-w-0">
            <StatusBadge
              status={effectiveStatus(invoice.status, invoice.due_date)}
            />
            <div className="min-w-0">
              <p className="font-medium text-ink truncate">
                {invoice.clients?.name ?? "Unknown client"}
              </p>
              <p className="text-xs text-slate font-mono">
                {invoice.invoice_number} · due {formatDate(invoice.due_date)}
              </p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="font-mono tabular text-ink font-medium">
              {formatRupees(invoice.total_value)}
            </p>
            <span className="text-xs text-bahi-red">View details</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
