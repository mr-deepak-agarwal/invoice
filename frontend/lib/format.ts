export function formatRupees(n: number, fractionDigits = 0): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(n);
}

/** Accepts "2026-11-01" or a full timestamp; shows "01 Nov 2026". */
export function formatDate(iso: string): string {
  // Date-only strings are parsed as UTC; format in UTC so the day never shifts.
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: isDateOnly ? "UTC" : "Asia/Kolkata",
  });
}
