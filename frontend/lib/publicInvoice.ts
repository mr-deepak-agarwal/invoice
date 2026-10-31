import { effectiveStatus } from "./status";
import type { InvoiceStatus } from "./types";

/**
 * The /pay/<token> page is public (no login), so the data it can show is
 * whitelisted HERE, in one tested function. Nothing about the client
 * (email, phone, address, GSTIN) and nothing internal (ids, bank details)
 * ever passes through this.
 */

export const PUBLIC_TOKEN_RE = /^[a-f0-9]{64}$/;

export function isValidPublicToken(t: unknown): t is string {
  return typeof t === "string" && PUBLIC_TOKEN_RE.test(t);
}

export interface PublicInvoiceView {
  businessName: string;
  invoiceNumber: string;
  description: string;
  total: number;
  dueDate: string;
  status: InvoiceStatus;
  upiId: string | null;
  canPay: boolean;
}

interface PublicInvoiceRow {
  invoice_number: string;
  description: string | null;
  total_value: number | string;
  due_date: string;
  status: InvoiceStatus;
  businesses: { name: string; upi_id: string | null } | null;
  // anything else on the row is ignored on purpose
  [key: string]: unknown;
}

export function toPublicInvoice(
  row: PublicInvoiceRow,
  today?: string
): PublicInvoiceView {
  const status = today
    ? effectiveStatusOn(row.status, row.due_date, today)
    : effectiveStatus(row.status, row.due_date);
  const upiId = row.businesses?.upi_id ?? null;
  return {
    businessName: row.businesses?.name ?? "",
    invoiceNumber: row.invoice_number,
    description: row.description ?? "",
    total: Number(row.total_value),
    dueDate: row.due_date,
    status,
    upiId,
    canPay: Boolean(upiId) && (status === "sent" || status === "overdue"),
  };
}

function effectiveStatusOn(
  status: InvoiceStatus,
  dueDate: string,
  today: string
): InvoiceStatus {
  return status === "sent" && dueDate < today ? "overdue" : status;
}
