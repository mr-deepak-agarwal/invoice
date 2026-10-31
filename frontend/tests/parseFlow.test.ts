import { beforeEach, describe, expect, it, vi } from "vitest";

const gemini = vi.fn();
vi.mock("../lib/gemini", () => ({ parseWithGemini: (...a: unknown[]) => gemini(...a) }));
const profileFn = vi.fn();
vi.mock("../lib/db", () => ({
  findClientByExactName: async () => null,
  getTaxProfile: (...a: unknown[]) => profileFn(...a),
}));

import { parseInvoiceMessage } from "../lib/parseFlow";
import { addDaysIso } from "../lib/gst";
import { todayInIndia } from "../lib/status";

const profile = (over: Record<string, unknown> = {}) => ({
  gst_registered: true,
  state_code: "08",
  default_due_days: null,
  assume_local_supply: false,
  ...over,
});
const geminiOk = (f: Record<string, unknown>) =>
  gemini.mockResolvedValue({
    ok: true,
    fields: {
      client_name: null, client_email: null, client_phone: null, company_address: null,
      client_state: null, client_gstin: null, taxable_value: null, gst_rate: null,
      description: null, due_date: null, ...f,
    },
  });

beforeEach(() => {
  gemini.mockReset();
  gemini.mockResolvedValue({ ok: false, reason: "no key" });
  profileFn.mockReset();
});

const MSG = "Deepak sir ka 2000 ka bill bana do, haircut aur facial";

describe("saved defaults", () => {
  it("fills due date and local place of supply, flags both as assumed, and skips the AI", async () => {
    profileFn.mockResolvedValue(profile({ default_due_days: 0, assume_local_supply: true }));
    const p = await parseInvoiceMessage(MSG, "b1");
    expect(p).toMatchObject({
      client_name: "Deepak sir",
      taxable_value: 2000,
      due_date: todayInIndia(),
      client_state_code: "08",
      description: "haircut aur facial",
      missing_fields: [],
    });
    expect(p.defaults_applied.sort()).toEqual(["client_state", "due_date"]);
    expect(gemini).not.toHaveBeenCalled(); // nothing left that the AI could add
  });

  it("uses N-day terms", async () => {
    profileFn.mockResolvedValue(profile({ default_due_days: 15, assume_local_supply: true }));
    const p = await parseInvoiceMessage(MSG, "b1");
    expect(p.due_date).toBe(addDaysIso(todayInIndia(), 15));
  });

  it("with no defaults saved it still asks (and tries the AI)", async () => {
    profileFn.mockResolvedValue(profile());
    const p = await parseInvoiceMessage(MSG, "b1");
    expect(p.missing_fields).toEqual(["due_date", "client_state"]);
    expect(p.defaults_applied).toEqual([]);
    expect(gemini).toHaveBeenCalledTimes(1);
  });

  it("applies each default independently", async () => {
    profileFn.mockResolvedValue(profile({ default_due_days: 7 }));
    const p = await parseInvoiceMessage(MSG, "b1");
    expect(p.defaults_applied).toEqual(["due_date"]);
    expect(p.client_state_code).toBeNull();
    expect(p.missing_fields).toEqual(["client_state"]);
  });

  it("never overrides what the message actually said", async () => {
    profileFn.mockResolvedValue(profile({ default_due_days: 0, assume_local_supply: true }));
    const p = await parseInvoiceMessage("bill for Marc, goa, 25000, due 1 nov 2026", "b1");
    expect(p.due_date).toBe("2026-11-01");
    expect(p.client_state_code).toBe("30"); // Goa, not the business's Rajasthan
    expect(p.defaults_applied).toEqual([]);
  });

  it("never overrides what the AI found, and still calls it when needed", async () => {
    profileFn.mockResolvedValue(profile({ default_due_days: 0, assume_local_supply: true }));
    geminiOk({ client_name: "Rohit", taxable_value: 300, due_date: "2026-12-01", client_state: "Pune" });
    const p = await parseInvoiceMessage("Rohit ka haircut 300 aur beard 150", "b1");
    expect(gemini).toHaveBeenCalledTimes(1);
    expect(p).toMatchObject({ client_name: "Rohit", taxable_value: 300, due_date: "2026-12-01", client_state_code: "27" });
    expect(p.defaults_applied).toEqual([]);
  });

  it("does not assume a state for a business that isn't GST-registered, and needs none", async () => {
    profileFn.mockResolvedValue(profile({ gst_registered: false, state_code: null, default_due_days: 0 }));
    const p = await parseInvoiceMessage(MSG, "b1");
    expect(p.client_state_code).toBeNull();
    expect(p.defaults_applied).toEqual(["due_date"]);
    expect(p.missing_fields).toEqual([]);
  });

  it("does nothing special without a business (no defaults to apply)", async () => {
    const p = await parseInvoiceMessage(MSG);
    expect(p.defaults_applied).toEqual([]);
    expect(p.missing_fields).toEqual(["due_date", "client_state"]);
  });
});
