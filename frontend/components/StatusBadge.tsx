import { InvoiceStatus } from "@/lib/types";

const STATUS_STYLES: Record<InvoiceStatus, string> = {
  draft: "border-slate text-slate",
  sent: "border-marigold text-marigold",
  paid: "border-bahi-red text-bahi-red bg-bahi-red/5",
  overdue: "border-bahi-red-dark text-bahi-red-dark bg-bahi-red-dark/10",
  cancelled: "border-slate/50 text-slate/50",
};

const STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  paid: "Paid",
  overdue: "Overdue",
  cancelled: "Cancelled",
};

// A small circular seal rather than a pill/chip — a deliberate nod to the
// round ink stamp every Indian small-business invoice carries.
export function StatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span
      className={`inline-flex items-center justify-center w-20 h-20 rounded-full border-2 text-[11px] font-display uppercase tracking-wide leading-tight text-center px-1 ${STATUS_STYLES[status]}`}
      style={{ width: 56, height: 56 }}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
