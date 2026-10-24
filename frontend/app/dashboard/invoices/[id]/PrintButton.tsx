"use client";

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="text-sm text-ink border border-ledger-line rounded-card px-5 py-2.5 hover:bg-paper-raised transition-colors"
    >
      Print / save as PDF
    </button>
  );
}
