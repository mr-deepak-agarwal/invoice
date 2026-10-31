"use client";

import { useState } from "react";

export function CopyButton({
  text,
  label = "Copy",
  onCopied,
  className = "",
}: {
  text: string;
  label?: string;
  onCopied?: () => void;
  className?: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          onCopied?.();
          setTimeout(() => setDone(false), 1500);
        } catch {
          // clipboard blocked (e.g. insecure context) — nothing to do
        }
      }}
      className={`border border-ledger-line rounded-card px-3 py-1.5 text-sm text-ink hover:bg-paper-raised ${className}`}
    >
      {done ? "Copied ✓" : label}
    </button>
  );
}
