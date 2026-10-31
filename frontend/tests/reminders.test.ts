import { describe, expect, it } from "vitest";
import {
  buildReminderMessage,
  daysBetween,
  messageTypeFor,
  planReminders,
  reminderStepFor,
  waLink,
  type ReminderStep,
} from "../lib/reminders";
import { buildDigestText } from "../lib/reminderJob";

const TODAY = "2026-10-28";

describe("daysBetween", () => {
  it("counts calendar days across month/year ends", () => {
    expect(daysBetween("2026-10-28", "2026-10-31")).toBe(3);
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3);
    expect(daysBetween("2026-10-28", "2026-10-28")).toBe(0);
    expect(daysBetween("2026-10-28", "2026-10-25")).toBe(-3);
  });
});

describe("reminderStepFor", () => {
  const step = (due: string) => reminderStepFor(due, TODAY)?.step ?? null;
  it("is quiet when the due date is more than 3 days away", () => {
    expect(step("2026-11-02")).toBeNull();
  });
  it("walks the ladder", () => {
    expect(step("2026-10-31")).toBe("before");
    expect(step("2026-10-29")).toBe("before");
    expect(step("2026-10-28")).toBe("due");
    expect(step("2026-10-27")).toBe("overdue_1");
    expect(step("2026-10-26")).toBe("overdue_1");
    expect(step("2026-10-25")).toBe("overdue_3");
    expect(step("2026-10-21")).toBe("overdue_7");
    expect(step("2026-10-13")).toBe("overdue_15");
    expect(step("2026-09-28")).toBe("overdue_30");
    expect(step("2025-01-01")).toBe("overdue_30");
  });
  it("reports how many days overdue", () => {
    expect(reminderStepFor("2026-10-21", TODAY)?.daysOverdue).toBe(7);
  });
});

describe("planReminders", () => {
  const inv = (id: string, due: string, status = "sent") => ({ id, due_date: due, status });
  it("skips paid/cancelled/draft and too-early invoices", () => {
    const plan = planReminders(
      [inv("a", "2026-10-20"), inv("b", "2026-10-20", "paid"), inv("c", "2026-10-20", "cancelled"), inv("d", "2026-10-20", "draft"), inv("e", "2026-12-01")],
      new Set(),
      TODAY
    );
    expect(plan.map((p) => p.invoice.id)).toEqual(["a"]);
  });
  it("raises each step once", () => {
    const logged = new Set(["a:overdue_7"]);
    const plan = (today: string) =>
      planReminders([inv("a", "2026-10-21")], logged, today).map((p) => p.step);
    expect(plan("2026-10-28")).toEqual([]); // day 7: already raised
    expect(plan("2026-11-03")).toEqual([]); // day 13: still the 7-day step
    expect(plan("2026-11-05")).toEqual(["overdue_15"]); // day 15: next step
    expect(plan("2026-11-20")).toEqual(["overdue_30"]); // day 30
  });
  it("lists the most overdue first", () => {
    const plan = planReminders([inv("new", "2026-10-27"), inv("old", "2026-09-01")], new Set(), TODAY);
    expect(plan.map((p) => p.invoice.id)).toEqual(["old", "new"]);
  });
  it("log keys match messageTypeFor", () => {
    expect(messageTypeFor("overdue_7")).toBe("reminder_overdue_7");
  });
});

describe("buildReminderMessage", () => {
  const base = {
    step: "overdue_3" as const,
    clientName: "Marc",
    businessName: "Bahi Studio",
    invoiceNumber: "INV/2627/0001",
    amount: 29500,
    dueDate: "2026-10-25",
    daysOverdue: 3,
    payUrl: "https://bahi.test/pay/abc",
  };

  it("includes the essentials in every language", () => {
    for (const lang of ["en", "hi", "hinglish"] as const) {
      const m = buildReminderMessage({ ...base, lang });
      for (const must of ["Marc", "Bahi Studio", "INV/2627/0001", "29,500", "https://bahi.test/pay/abc"]) {
        expect(m, `${lang}: ${must}`).toContain(must);
      }
    }
  });

  it("is really Hindi (Devanagari) and really Hinglish (Latin)", () => {
    expect(buildReminderMessage({ ...base, lang: "hi" })).toMatch(/[\u0900-\u097F]/);
    expect(buildReminderMessage({ ...base, lang: "hinglish" })).not.toMatch(/[\u0900-\u097F]/);
    expect(buildReminderMessage({ ...base, lang: "hinglish" })).toMatch(/Kripya|kripya/);
  });

  it("omits the link line when there is no UPI link", () => {
    expect(buildReminderMessage({ ...base, lang: "en", payUrl: null })).not.toContain("Pay here");
  });

  it("escalates in tone as it gets later", () => {
    const m = (step: ReminderStep, n: number) => buildReminderMessage({ ...base, lang: "en", step, daysOverdue: n });
    expect(m("before", -2)).toContain("quick reminder");
    expect(m("due", 0)).toContain("due today");
    expect(m("overdue_3", 3)).toContain("Could you please");
    expect(m("overdue_7", 7)).toContain("at the earliest");
    expect(m("overdue_30", 30)).toContain("immediately");
  });

  it("singular day", () => {
    expect(buildReminderMessage({ ...base, lang: "en", step: "overdue_1", daysOverdue: 1 })).toContain("1 day overdue");
  });
});

describe("waLink", () => {
  const t = "hello & bye";
  it("normalises Indian numbers", () => {
    const want = `https://wa.me/919876543210?text=${encodeURIComponent(t)}`;
    expect(waLink("9876543210", t)).toBe(want);
    expect(waLink("+91 98765-43210", t)).toBe(want);
    expect(waLink("919876543210", t)).toBe(want);
    expect(waLink("09876543210", t)).toBe(want);
  });
  it("returns null for unusable numbers", () => {
    for (const bad of [null, undefined, "", "12345", "5876543210", "98765432101234"]) {
      expect(waLink(bad as never, t), String(bad)).toBeNull();
    }
  });
});

describe("digest text", () => {
  it("summarises and caps the list", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      name: `C${i}`, amount: 1000, invoiceNumber: `INV/2627/${i}`, step: "overdue_7" as const, daysOverdue: 7,
    }));
    const text = buildDigestText(TODAY, items, "https://bahi.test");
    expect(text).toContain("12 invoices need a nudge");
    expect(text).toContain("…and 2 more");
    expect(text).toContain("https://bahi.test/dashboard/reminders");
    expect(text.split("\n").filter((l) => l.startsWith("•"))).toHaveLength(10);
  });
  it("handles singular and 'due' wording", () => {
    const text = buildDigestText(TODAY, [{ name: "Marc", amount: 500, invoiceNumber: "X", step: "due", daysOverdue: 0 }], null);
    expect(text).toContain("1 invoice need");
    expect(text).toContain("due today");
    expect(text).not.toContain("dashboard");
  });
});
