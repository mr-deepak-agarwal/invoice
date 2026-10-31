import { addDaysIso } from "./gst";
import { formatDate, formatRupees } from "./format";

/**
 * Payment reminder logic: WHEN to nudge and WHAT to say (English, Hindi,
 * Hinglish). Pure functions, no I/O.
 *
 * Bahi does not send WhatsApp messages to your clients itself. It writes
 * the message and gives you a wa.me link, so it goes from YOUR number —
 * no WhatsApp Business API approval or per-message cost, and no risk of
 * your number being flagged for automated messaging. (Automatic sending
 * is a later step.)
 *
 * Have a native speaker check the Hindi/Hinglish wording before you rely
 * on it with real clients.
 */

export type Lang = "en" | "hi" | "hinglish";

export type ReminderStep =
  | "before"
  | "due"
  | "overdue_1"
  | "overdue_3"
  | "overdue_7"
  | "overdue_15"
  | "overdue_30";

export const LANG_LABELS: Record<Lang, string> = {
  en: "English",
  hi: "हिन्दी",
  hinglish: "Hinglish",
};

/** Whole days from a to b (both YYYY-MM-DD). b later than a => positive. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000
  );
}

const OVERDUE_STEPS: [number, ReminderStep][] = [
  [30, "overdue_30"],
  [15, "overdue_15"],
  [7, "overdue_7"],
  [3, "overdue_3"],
  [1, "overdue_1"],
];

/** The reminder that applies today, or null if it's too early. */
export function reminderStepFor(
  dueDate: string,
  today: string
): { step: ReminderStep; daysOverdue: number } | null {
  const daysOverdue = daysBetween(dueDate, today);
  if (daysOverdue < -3) return null;
  if (daysOverdue < 0) return { step: "before", daysOverdue };
  if (daysOverdue === 0) return { step: "due", daysOverdue };
  for (const [min, step] of OVERDUE_STEPS) {
    if (daysOverdue >= min) return { step, daysOverdue };
  }
  return { step: "overdue_1", daysOverdue };
}

export interface ReminderCandidate {
  id: string;
  status: string;
  due_date: string;
}

export interface PlannedReminder<T extends ReminderCandidate> {
  invoice: T;
  step: ReminderStep;
  daysOverdue: number;
}

/**
 * Which invoices need a nudge right now. `alreadyLogged` holds
 * `${invoice_id}:${step}` for reminders already handled, so each step
 * is raised once.
 */
export function planReminders<T extends ReminderCandidate>(
  invoices: T[],
  alreadyLogged: Set<string>,
  today: string
): PlannedReminder<T>[] {
  const out: PlannedReminder<T>[] = [];
  for (const invoice of invoices) {
    if (invoice.status !== "sent") continue; // paid / cancelled / draft: no nudge
    const s = reminderStepFor(invoice.due_date, today);
    if (!s) continue;
    if (alreadyLogged.has(`${invoice.id}:${s.step}`)) continue;
    out.push({ invoice, ...s });
  }
  // Most overdue first.
  return out.sort((a, b) => b.daysOverdue - a.daysOverdue);
}

export function messageTypeFor(step: ReminderStep): string {
  return `reminder_${step}`;
}

// ---------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------

export interface MessageInput {
  lang: Lang;
  step: ReminderStep;
  clientName: string;
  businessName: string;
  invoiceNumber: string;
  amount: number;
  dueDate: string;
  daysOverdue: number;
  payUrl?: string | null;
}

function days(n: number, lang: Lang): string {
  if (lang === "hi") return `${n} दिन`;
  if (lang === "hinglish") return `${n} din`;
  return n === 1 ? "1 day" : `${n} days`;
}

export function buildReminderMessage(i: MessageInput): string {
  const amt = formatRupees(i.amount, 2).replace(/\.00$/, "");
  const due = formatDate(i.dueDate);
  const n = Math.max(i.daysOverdue, 0);
  const firm = i.step === "overdue_7" || i.step === "overdue_15";
  const final = i.step === "overdue_30";
  const overdue = i.step.startsWith("overdue");
  const link = i.payUrl ?? null;

  if (i.lang === "hi") {
    const head = `नमस्ते ${i.clientName} जी,`;
    const inv = `${i.businessName} के इनवॉइस ${i.invoiceNumber} (${amt})`;
    const pay = link ? ` भुगतान लिंक: ${link}` : "";
    if (i.step === "before")
      return `${head} ${i.businessName} की ओर से एक छोटा सा रिमाइंडर: इनवॉइस ${i.invoiceNumber} (${amt}) की अंतिम तिथि ${due} है।${pay} धन्यवाद!`;
    if (i.step === "due")
      return `${head} ${inv} का भुगतान आज देय है।${pay} धन्यवाद!`;
    if (final)
      return `${head} ${inv} की अंतिम तिथि ${due} थी, ${days(n, "hi")} से भुगतान बाकी है। कृपया तुरंत भुगतान करें या भुगतान की तारीख बताएँ।${pay}`;
    if (firm)
      return `${head} ${inv} की अंतिम तिथि ${due} थी और ${days(n, "hi")} बीत चुके हैं। कृपया जल्द से जल्द भुगतान करें या बता दें कि भुगतान कब तक हो जाएगा।${pay} धन्यवाद।`;
    return `${head} ${inv} की अंतिम तिथि ${due} थी और ${days(n, "hi")} बीत चुके हैं। कृपया भुगतान करवा दीजिए।${pay} धन्यवाद।`;
  }

  if (i.lang === "hinglish") {
    const head = `Namaste ${i.clientName} ji,`;
    const inv = `${i.businessName} ka invoice ${i.invoiceNumber} (${amt})`;
    const pay = link ? ` Payment link: ${link}` : "";
    if (i.step === "before")
      return `${head} ${i.businessName} ki taraf se ek chhota reminder: invoice ${i.invoiceNumber} (${amt}) ki due date ${due} hai.${pay} Dhanyavaad!`;
    if (i.step === "due")
      return `${head} ${inv} aaj due hai.${pay} Dhanyavaad!`;
    if (final)
      return `${head} ${inv} ki due date ${due} thi, ${days(n, "hinglish")} se payment baaki hai. Kripya turant payment karein ya payment ki date bata dein.${pay}`;
    if (firm)
      return `${head} ${inv} ki due date ${due} thi aur ${days(n, "hinglish")} ho gaye hain. Kripya jaldi se jaldi payment karein ya bata dein ki payment kab tak ho jayega.${pay} Dhanyavaad.`;
    return `${head} ${inv} ki due date ${due} thi aur ${days(n, "hinglish")} ho gaye hain. Kripya payment kar dijiye.${pay} Dhanyavaad.`;
  }

  const head = `Hi ${i.clientName},`;
  const inv = `invoice ${i.invoiceNumber} for ${amt} from ${i.businessName}`;
  const pay = link ? ` Pay here: ${link}` : "";
  if (i.step === "before")
    return `${head} a quick reminder from ${i.businessName}: invoice ${i.invoiceNumber} for ${amt} is due on ${due}.${pay} Thank you!`;
  if (i.step === "due") return `${head} ${inv} is due today.${pay} Thank you!`;
  if (final)
    return `${head} ${inv} was due on ${due} and is now ${days(n, "en")} overdue. Kindly pay immediately, or reply with a payment date so we can close this.${pay}`;
  if (firm)
    return `${head} ${inv} was due on ${due} and is now ${days(n, "en")} overdue. Please clear it at the earliest, or let us know when we can expect the payment.${pay} Thank you.`;
  if (overdue)
    return `${head} ${inv} was due on ${due} and is now ${days(n, "en")} overdue. Could you please arrange the payment?${pay} Thank you.`;
  return `${head} ${inv} is due on ${due}.${pay}`;
}

/** https://wa.me link with the message filled in, or null without a usable number. */
export function waLink(
  phone: string | null | undefined,
  text: string
): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  let n: string | null = null;
  if (/^[6-9]\d{9}$/.test(digits)) n = `91${digits}`;
  else if (/^91[6-9]\d{9}$/.test(digits)) n = digits;
  else if (/^0[6-9]\d{9}$/.test(digits)) n = `91${digits.slice(1)}`;
  if (!n) return null;
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}

/** Used by tests and the cron job to know "3 days from today". */
export function dueSoonCutoff(today: string): string {
  return addDaysIso(today, 3);
}
