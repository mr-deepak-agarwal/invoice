export function StatCard({
  label,
  value,
  accent = "ink",
}: {
  label: string;
  value: string;
  accent?: "ink" | "bahi-red" | "marigold";
}) {
  const accentClass =
    accent === "bahi-red"
      ? "text-bahi-red"
      : accent === "marigold"
      ? "text-marigold"
      : "text-ink";

  return (
    <div className="bg-paper-raised border border-ledger-line rounded-card px-5 py-4">
      <p className="text-xs text-slate uppercase tracking-wide mb-1.5">
        {label}
      </p>
      <p className={`font-mono tabular text-2xl font-medium ${accentClass}`}>
        {value}
      </p>
    </div>
  );
}
