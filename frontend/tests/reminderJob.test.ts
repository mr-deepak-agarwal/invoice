import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: { chatId: string; text: string }[] = [];
let telegramOk = true;
vi.mock("../lib/telegram", () => ({
  sendMessage: async (chatId: string, text: string) => {
    if (telegramOk) sent.push({ chatId, text });
    return telegramOk;
  },
}));

import { runReminderDigests } from "../lib/reminderJob";

// ---- minimal fake Supabase -------------------------------------------
interface World {
  identities: { business_id: string; channel_identifier: string }[];
  invoices: Record<string, unknown>[];
  logs: { invoice_id: string; message_type: string }[];
}
let world: World;
const inserts: Record<string, unknown>[][] = [];

function fakeDb() {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        lte: () => chain,
        in: () => chain,
        like: () => chain,
        limit: () => chain,
        insert: async (rows: Record<string, unknown>[]) => {
          inserts.push(rows);
          for (const r of rows) {
            world.logs.push({ invoice_id: String(r.invoice_id), message_type: String(r.message_type) });
          }
          return { error: null };
        },
        then: (resolve: (v: unknown) => void) => {
          const data =
            table === "identities" ? world.identities
            : table === "invoices" ? world.invoices
            : table === "messages_log" ? world.logs
            : [];
          resolve({ data, error: null });
        },
      };
      return chain;
    },
  };
}

const TODAY = "2026-10-28";
const inv = (id: string, due: string, name = "Marc") => ({
  id, invoice_number: `INV/2627/${id}`, total_value: "29500.00", due_date: due, status: "sent", clients: { name },
});

beforeEach(() => {
  sent.length = 0;
  inserts.length = 0;
  telegramOk = true;
  world = {
    identities: [{ business_id: "b1", channel_identifier: "111" }],
    invoices: [inv("1", "2026-10-20"), inv("2", "2026-10-28", "Anita")],
    logs: [],
  };
});

describe("runReminderDigests", () => {
  it("sends one digest per business and logs each reminder", async () => {
    const r = await runReminderDigests(fakeDb() as never, TODAY, "https://bahi.test");
    expect(r).toEqual({ businesses: 1, digests: 1, reminders: 2 });
    expect(sent).toHaveLength(1);
    expect(sent[0].chatId).toBe("111");
    expect(sent[0].text).toContain("2 invoices need a nudge");
    expect(sent[0].text).toContain("Marc");
    expect(sent[0].text).toContain("8 days overdue");
    expect(sent[0].text).toContain("Anita");
    expect(inserts[0].map((x) => x.message_type).sort()).toEqual(["reminder_due", "reminder_overdue_7"]);
    expect(inserts[0].every((x) => x.channel === "telegram" && x.business_id === "b1")).toBe(true);
  });

  it("does not repeat itself on the next run (same day or tomorrow)", async () => {
    await runReminderDigests(fakeDb() as never, TODAY, null);
    sent.length = 0;
    const again = await runReminderDigests(fakeDb() as never, TODAY, null);
    expect(again.reminders).toBe(0);
    expect(sent).toHaveLength(0);
    const tomorrow = await runReminderDigests(fakeDb() as never, "2026-10-29", null);
    // 'due' invoice is now 1 day overdue -> a NEW step, so it is raised once
    expect(tomorrow.reminders).toBe(1);
    expect(sent[0].text).toContain("Anita");
    expect(sent[0].text).not.toContain("Marc");
  });

  it("respects reminders the owner already sent from the dashboard", async () => {
    world.logs.push({ invoice_id: "1", message_type: "reminder_overdue_7" });
    const r = await runReminderDigests(fakeDb() as never, TODAY, null);
    expect(r.reminders).toBe(1);
    expect(sent[0].text).not.toContain("Marc");
  });

  it("retries tomorrow if Telegram delivery fails (nothing is logged)", async () => {
    telegramOk = false;
    const r = await runReminderDigests(fakeDb() as never, TODAY, null);
    expect(r.digests).toBe(0);
    expect(inserts).toHaveLength(0);
  });

  it("stays quiet when nothing is due", async () => {
    world.invoices = [inv("9", "2026-12-31")];
    const r = await runReminderDigests(fakeDb() as never, TODAY, null);
    expect(r).toEqual({ businesses: 1, digests: 0, reminders: 0 });
    expect(sent).toHaveLength(0);
  });
});
