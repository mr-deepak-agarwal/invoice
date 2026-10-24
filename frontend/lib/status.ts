import type { InvoiceStatus } from "./types";

/** Today's date in India as YYYY-MM-DD. */
export function todayInIndia(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/**
 * Invoices are stored as "sent" until someone marks them paid, so
 * "overdue" is worked out here from the due date instead of being a
 * stored value that would go stale.
 */
export function effectiveStatus(
  status: InvoiceStatus,
  dueDate: string
): InvoiceStatus {
  if (status === "sent" && dueDate < todayInIndia()) return "overdue";
  return status;
}
