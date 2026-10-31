import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- a tiny in-memory stand-in for the Supabase client -----------------
interface Cfg {
  business: Record<string, unknown> | null;
  clients: Record<string, unknown>[]; // rows returned by the client lookup
  created: { id: string } | null;     // row returned by a client insert
}
let cfg: Cfg;
let calls: {
  rpc: { name: string; args: Record<string, unknown> }[];
  inserts: { table: string; row: Record<string, unknown> }[];
  updates: { table: string; patch: Record<string, unknown> }[];
};

function fakeDb() {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        ilike: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: cfg.business }),
        single: async () => ({ data: cfg.created, error: null }),
        insert: (row: Record<string, unknown>) => {
          calls.inserts.push({ table, row });
          return chain;
        },
        update: (patch: Record<string, unknown>) => {
          calls.updates.push({ table, patch });
          return chain;
        },
        // `await db.from(..).select().eq().ilike().limit()` lands here
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: table === "clients" ? cfg.clients : null, error: null }),
      };
      return chain;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.rpc.push({ name, args });
      return {
        data: {
          id: "inv-1",
          invoice_number: "INV/2627/0001",
          taxable_value: args.p_taxable,
          total_value: args.p_total,
          due_date: args.p_due_date,
          status: "sent",
        },
        error: null,
      };
    },
  };
}

vi.mock("../lib/supabaseAdmin", () => ({ getSupabaseAdmin: () => fakeDb() }));

import { createInvoiceForBusiness } from "../lib/invoices";

const base = {
  business_id: "biz-1",
  client_name: "Marc",
  taxable_value: 10000,
  due_date: "2026-11-01",
};

beforeEach(() => {
  cfg = {
    business: { id: "biz-1", state_code: "08", default_sac_code: "998314" }, // Rajasthan
    clients: [],
    created: { id: "client-1" },
  };
  calls = { rpc: [], inserts: [], updates: [] };
});

describe("createInvoiceForBusiness — tax type", () => {
  it("charges IGST when a Rajasthan seller bills a Goa client", async () => {
    const r = await createInvoiceForBusiness({ ...base, client_state_code: "30" });
    expect(r.ok).toBe(true);
    const a = calls.rpc[0].args;
    expect(a).toMatchObject({
      p_igst_rate: 18, p_igst: 1800, p_cgst: 0, p_sgst: 0,
      p_total: 11800, p_pos_code: "30", p_pos_name: "Goa", p_sac_code: "998314",
    });
    if (r.ok) expect(r.invoice.tax_type).toBe("inter");
  });

  it("charges CGST+SGST when seller and client are in the same state", async () => {
    const r = await createInvoiceForBusiness({ ...base, client_state_code: "08" });
    expect(r.ok).toBe(true);
    expect(calls.rpc[0].args).toMatchObject({
      p_cgst_rate: 9, p_sgst_rate: 9, p_igst_rate: 0,
      p_cgst: 900, p_sgst: 900, p_igst: 0, p_total: 11800,
    });
  });

  it("uses a custom GST rate", async () => {
    await createInvoiceForBusiness({ ...base, client_state_code: "30", gst_rate: 5 });
    expect(calls.rpc[0].args).toMatchObject({ p_igst_rate: 5, p_igst: 500, p_total: 10500 });
  });

  it("a valid client GSTIN decides the place of supply over the dropdown", async () => {
    await createInvoiceForBusiness({
      ...base, client_state_code: "30", client_gstin: "27AAPFU0939F1ZV",
    });
    expect(calls.rpc[0].args).toMatchObject({ p_pos_code: "27", p_pos_name: "Maharashtra" });
  });

  it("falls back to the saved client's state", async () => {
    cfg.clients = [{ id: "c9", email: null, phone: null, address: null, gstin: null, state_code: "27" }];
    const r = await createInvoiceForBusiness(base);
    expect(r.ok).toBe(true);
    expect(calls.rpc[0].args).toMatchObject({ p_pos_code: "27", p_client_id: "c9", p_igst: 1800 });
  });

  it("fills in saved-client gaps but never overwrites existing details", async () => {
    cfg.clients = [{ id: "c9", email: "keep@x.com", phone: null, address: null, gstin: null, state_code: "30" }];
    await createInvoiceForBusiness({
      ...base, client_email: "new@x.com", client_phone: "9876543210",
    });
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0].patch).toEqual({ phone: "9876543210" });
  });
});

describe("createInvoiceForBusiness — refusals", () => {
  const refused = async (input: Parameters<typeof createInvoiceForBusiness>[0], status: number, msg: RegExp) => {
    const r = await createInvoiceForBusiness(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(status);
      expect(r.error).toMatch(msg);
    }
    expect(calls.rpc).toHaveLength(0); // nothing was issued
  };

  it("refuses when the business has no state set", async () => {
    cfg.business = { id: "biz-1", state_code: null, default_sac_code: "998314" };
    await refused({ ...base, client_state_code: "30" }, 400, /Settings/);
  });

  it("refuses when the client's state is unknown", async () => {
    await refused(base, 400, /client's state/i);
  });

  it("refuses an unknown business", async () => {
    cfg.business = null;
    await refused({ ...base, client_state_code: "30" }, 404, /not found/i);
  });

  it("refuses bad input", async () => {
    await refused({ ...base, client_state_code: "30", taxable_value: 0 }, 400, /amount/i);
    await refused({ ...base, client_state_code: "30", taxable_value: 2e9 }, 400, /too large/i);
    await refused({ ...base, client_state_code: "30", due_date: "2026-13-45" }, 400, /due date/i);
    await refused({ ...base, client_state_code: "30", gst_rate: 99 }, 400, /GST rate/i);
    await refused({ ...base, client_state_code: "99x" }, 400, /state/i);
    await refused({ ...base, client_state_code: "30", client_gstin: "27AAPFU0939F1ZW" }, 400, /GSTIN/i);
    await refused({ ...base, client_state_code: "30", sac_code: "abc" }, 400, /SAC/i);
    await refused({ ...base, client_state_code: "30", client_name: "  " }, 400, /client name/i);
  });
});

describe("createInvoiceForBusiness — business not registered for GST", () => {
  beforeEach(() => {
    cfg.business = { id: "biz-1", state_code: null, default_sac_code: "998314", gst_registered: false };
  });

  it("creates a no-tax invoice without needing any state", async () => {
    const r = await createInvoiceForBusiness({ ...base });
    expect(r.ok).toBe(true);
    expect(calls.rpc[0].args).toMatchObject({
      p_cgst: 0, p_sgst: 0, p_igst: 0,
      p_cgst_rate: 0, p_sgst_rate: 0, p_igst_rate: 0,
      p_taxable: 10000, p_total: 10000,
      p_pos_code: null, p_pos_name: null,
    });
    if (r.ok) {
      expect(r.invoice.tax_type).toBe("none");
      expect(r.invoice.gst_rate).toBe(0);
    }
  });

  it("ignores any GST rate sent in — an unregistered supplier can't charge GST", async () => {
    await createInvoiceForBusiness({ ...base, gst_rate: 18, client_state_code: "30" });
    expect(calls.rpc[0].args).toMatchObject({ p_igst: 0, p_cgst: 0, p_total: 10000 });
  });

  it("still validates amount and due date", async () => {
    expect((await createInvoiceForBusiness({ ...base, taxable_value: 0 })).ok).toBe(false);
    expect((await createInvoiceForBusiness({ ...base, due_date: "2026-02-30" })).ok).toBe(false);
    expect(calls.rpc).toHaveLength(0);
  });

  it("a registered business is unaffected (still refuses without a state)", async () => {
    cfg.business = { id: "biz-1", state_code: null, default_sac_code: "998314", gst_registered: true };
    const r = await createInvoiceForBusiness({ ...base, client_state_code: "30" });
    expect(r.ok).toBe(false);
  });
});
