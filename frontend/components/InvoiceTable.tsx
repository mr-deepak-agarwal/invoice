import { Invoice } from "@/lib/types";
import { StatusBadge } from "./StatusBadge";

function formatRupees(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

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
        <div
          key={invoice.id}
          className="flex items-center justify-between gap-4 py-4"
        >
          <div className="flex items-center gap-4 min-w-0">
            <StatusBadge status={invoice.status} />
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
            {invoice.pdf_url && (
              <a
                href={invoice.pdf_url}
                target="_blank"
                className="text-xs text-bahi-red hover:underline"
              >
                View PDF
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
