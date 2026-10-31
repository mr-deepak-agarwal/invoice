/**
 * UPI payment links. Pure functions — safe on server and client.
 *
 * IMPORTANT: a UPI link/QR only helps the customer PAY. It does not tell
 * Bahi the money arrived — "mark paid" stays manual until a payment
 * gateway webhook (e.g. Razorpay payment links) is added.
 */

const UPI_ID_RE = /^[a-zA-Z0-9._-]{2,255}@[a-zA-Z]{2,64}$/;

export function isValidUpiId(s: unknown): s is string {
  return typeof s === "string" && UPI_ID_RE.test(s.trim());
}

export interface UpiLinkInput {
  vpa: string;
  payeeName: string;
  amount: number;
  /** Shown in the payer's app, e.g. "Invoice INV/2627/0001". */
  note?: string;
  /** Your reference; stripped to letters/digits as UPI apps expect. */
  reference?: string;
}

/** upi://pay?pa=…&pn=…&am=…&cu=INR&tn=…&tr=… */
export function buildUpiUri(i: UpiLinkInput): string {
  if (!isValidUpiId(i.vpa)) throw new Error("Invalid UPI ID");
  if (!Number.isFinite(i.amount) || i.amount <= 0) throw new Error("Invalid amount");

  const params: string[] = [
    `pa=${i.vpa.trim()}`,
    `pn=${encodeURIComponent(i.payeeName.trim().slice(0, 40))}`,
    `am=${i.amount.toFixed(2)}`,
    "cu=INR",
  ];
  if (i.note) params.push(`tn=${encodeURIComponent(i.note.trim().slice(0, 50))}`);
  if (i.reference) {
    const tr = i.reference.replace(/[^A-Za-z0-9]/g, "").slice(0, 35);
    if (tr) params.push(`tr=${tr}`);
  }
  return `upi://pay?${params.join("&")}`;
}
