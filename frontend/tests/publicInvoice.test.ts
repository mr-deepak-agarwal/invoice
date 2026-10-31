import { describe, expect, it } from "vitest";
import { isValidPublicToken, toPublicInvoice } from "../lib/publicInvoice";

const row = {
  invoice_number: "INV/2627/0001",
  description: "Web design",
  total_value: "11800.00",
  due_date: "2026-11-01",
  status: "sent" as const,
  businesses: { name: "Bahi Studio", upi_id: "shop@okhdfcbank" },
  // everything below must NEVER reach the public page
  id: "11111111-1111-1111-1111-111111111111",
  business_id: "22222222-2222-2222-2222-222222222222",
  client_id: "33333333-3333-3333-3333-333333333333",
  clients: { name: "Secret Client", email: "secret@client.com", phone: "9876543210", gstin: "27AAPFU0939F1ZV" },
  public_token: "a".repeat(64),
  account_number: "123456789012",
  ifsc: "HDFC0001234",
};

describe("public token", () => {
  it("accepts exactly 64 lowercase hex chars", () => {
    expect(isValidPublicToken("a".repeat(64))).toBe(true);
    expect(isValidPublicToken("0123456789abcdef".repeat(4))).toBe(true);
  });
  it("rejects everything else", () => {
    for (const bad of ["", "a".repeat(63), "a".repeat(65), "A".repeat(64), "g".repeat(64), "../etc/passwd", null, undefined, 5, "a".repeat(64) + "\n"]) {
      expect(isValidPublicToken(bad as never), String(bad)).toBe(false);
    }
  });
});

describe("toPublicInvoice whitelist", () => {
  it("never exposes client details, ids, bank details or the token", () => {
    const json = JSON.stringify(toPublicInvoice(row, "2026-10-28"));
    for (const secret of ["secret@client.com", "9876543210", "Secret Client", "27AAPFU0939F1ZV", "123456789012", "HDFC0001234", row.id, row.business_id, row.client_id, "a".repeat(64)]) {
      expect(json, secret).not.toContain(secret);
    }
  });

  it("shows what the payer needs", () => {
    expect(toPublicInvoice(row, "2026-10-28")).toEqual({
      businessName: "Bahi Studio",
      invoiceNumber: "INV/2627/0001",
      description: "Web design",
      total: 11800,
      dueDate: "2026-11-01",
      status: "sent",
      upiId: "shop@okhdfcbank",
      canPay: true,
    });
  });

  it("can pay while sent or overdue, not once paid/cancelled or without a UPI id", () => {
    expect(toPublicInvoice({ ...row }, "2026-12-01").status).toBe("overdue");
    expect(toPublicInvoice({ ...row }, "2026-12-01").canPay).toBe(true);
    expect(toPublicInvoice({ ...row, status: "paid" }, "2026-10-28").canPay).toBe(false);
    expect(toPublicInvoice({ ...row, status: "cancelled" }, "2026-10-28").canPay).toBe(false);
    expect(toPublicInvoice({ ...row, status: "draft" }, "2026-10-28").canPay).toBe(false);
    expect(toPublicInvoice({ ...row, businesses: { name: "B", upi_id: null } }, "2026-10-28").canPay).toBe(false);
  });
});
