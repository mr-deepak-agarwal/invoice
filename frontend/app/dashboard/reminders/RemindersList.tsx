"use client";

import { useState } from "react";
import { CopyButton } from "@/components/CopyButton";
import { formatRupees } from "@/lib/format";
import {
  LANG_LABELS,
  buildReminderMessage,
  waLink,
  type Lang,
  type ReminderStep,
} from "@/lib/reminders";

export interface ReminderItem {
  invoiceId: string;
  clientName: string;
  phone: string | null;
  invoiceNumber: string;
  amount: number;
  dueDate: string;
  step: ReminderStep;
  daysOverdue: number;
  reminded: boolean;
  payUrl: string | null;
}

function whenText(i: ReminderItem): string {
  if (i.step === "before") return `due in ${-i.daysOverdue} day${-i.daysOverdue === 1 ? "" : "s"}`;
  if (i.step === "due") return "due today";
  return `${i.daysOverdue} day${i.daysOverdue === 1 ? "" : "s"} overdue`;
}

export function RemindersList({
  items,
  businessName,
}: {
  items: ReminderItem[];
  businessName: string;
}) {
  const [lang, setLang] = useState<Lang>("en");
  const [sent, setSent] = useState<Set<string>>(new Set());

  async function log(i: ReminderItem, channel: "whatsapp" | "email") {
    setSent((s) => new Set(s).add(i.invoiceId));
    try {
      await fetch("/api/reminders/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice_id: i.invoiceId, step: i.step, channel }),
      });
    } catch {
      // logging is best-effort; the message was still sent
    }
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-slate border border-ledger-line rounded-card px-4 py-6 bg-paper-raised">
        Nothing needs a nudge today. 🎉
      </p>
    );
  }

  return (
    <div>
      <div className="flex gap-2 mb-4" role="group" aria-label="Message language">
        {(Object.keys(LANG_LABELS) as Lang[]).map((l) => (
          <button
            key={l}
            onClick={() => setLang(l)}
            className={`px-3 py-1.5 rounded-card text-sm border ${
              lang === l
                ? "bg-bahi-red text-white border-bahi-red"
                : "border-ledger-line text-ink hover:bg-paper-raised"
            }`}
          >
            {LANG_LABELS[l]}
          </button>
        ))}
      </div>

      <ul className="space-y-4">
        {items.map((i) => {
          const text = buildReminderMessage({
            lang,
            step: i.step,
            clientName: i.clientName,
            businessName,
            invoiceNumber: i.invoiceNumber,
            amount: i.amount,
            dueDate: i.dueDate,
            daysOverdue: i.daysOverdue,
            payUrl: i.payUrl,
          });
          const wa = waLink(i.phone, text);
          const done = i.reminded || sent.has(i.invoiceId);
          return (
            <li
              key={i.invoiceId}
              className="bg-paper-raised border border-ledger-line rounded-card p-4"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <p className="font-medium text-ink">{i.clientName}</p>
                  <p className="text-xs text-slate font-mono">
                    {i.invoiceNumber} · {formatRupees(i.amount, 2)} · {whenText(i)}
                  </p>
                </div>
                {done && (
                  <span className="text-xs text-bahi-red border border-bahi-red/30 rounded-full px-2 py-0.5 shrink-0">
                    Reminded ✓
                  </span>
                )}
              </div>
              <p className="text-sm text-ink bg-white border border-ledger-line rounded-card px-3 py-2 whitespace-pre-wrap break-words">
                {text}
              </p>
              <div className="flex flex-wrap items-center gap-2 mt-3">
                {wa ? (
                  <a
                    href={wa}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => log(i, "whatsapp")}
                    className="bg-bahi-red text-white rounded-card px-4 py-1.5 text-sm font-medium hover:bg-bahi-red-dark"
                  >
                    Send on WhatsApp
                  </a>
                ) : (
                  <span className="text-xs text-slate">
                    No valid mobile number saved — copy the message instead.
                  </span>
                )}
                <CopyButton
                  text={text}
                  label="Copy message"
                  onCopied={() => log(i, "whatsapp")}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
