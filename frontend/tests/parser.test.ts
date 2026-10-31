import { describe, expect, it } from "vitest";
import { parseInvoiceText } from "../lib/parser";

const TODAY = "2026-10-24"; // fixed so relative dates are testable

const parse = (t: string) => parseInvoiceText(t, TODAY);

describe("regex parser", () => {
  it("reads the Telegram bot's own example message", () => {
    const p = parse(
      "make invoice for Marc, panjim goa, 25000, web development, due 1 nov 2026, email accounts@marc.com"
    );
    expect(p).toMatchObject({
      client_name: "Marc",
      client_email: "accounts@marc.com",
      taxable_value: 25000,
      due_date: "2026-11-01",
      client_state_code: "30",
      description: "web development",
    });
    // everything the bot needs is present, so Gemini is not even called
    expect(p.missing_fields).toEqual([]);
  });

  it("still reads the original 'amount is … to be paid by …' style", () => {
    const p = parse(
      "bill for Marc Glocal email a@b.com amount is 25,000 to be paid by 1 nov 2026"
    );
    expect(p.client_name).toBe("Marc Glocal");
    expect(p.taxable_value).toBe(25000);
    expect(p.due_date).toBe("2026-11-01");
    // no place mentioned -> state must be asked for, not assumed
    expect(p.client_state_code).toBeNull();
    expect(p.missing_fields).toContain("client_state");
  });

  it("reads the web form's placeholder message", () => {
    const p = parse(
      "Make a bill for Deepak Agarwal, jaipur, email deepak@gmail.com, mobile 9921880362, amount 20000, web design, due 30 nov 2026"
    );
    expect(p).toMatchObject({
      client_name: "Deepak Agarwal",
      client_phone: "9921880362",
      taxable_value: 20000,
      client_state_code: "08",
      due_date: "2026-11-30",
      description: "web design",
    });
  });

  it("understands lakh/k suffixes, relative due dates and a GST rate", () => {
    const p = parse(
      "invoice for Acme Ltd, mumbai, amount ₹1.5 lakh, due in 15 days, gst 12%"
    );
    expect(p).toMatchObject({
      client_name: "Acme Ltd",
      taxable_value: 150000,
      due_date: "2026-11-08",
      gst_rate: 12,
      client_state_code: "27",
    });
  });

  it("reads dd/mm/yyyy the Indian way", () => {
    expect(parse("bill for X Corp, goa, amount 100, due 05/11/2026").due_date).toBe("2026-11-05");
  });

  it("rolls a year-less date forward", () => {
    expect(parse("bill for X Corp, goa, amount 100, due 5 nov").due_date).toBe("2026-11-05");
    expect(parse("bill for X Corp, goa, amount 100, due 5 sep").due_date).toBe("2027-09-05");
  });

  it("does NOT guess when two bare numbers could be the amount", () => {
    const p = parse("invoice for Acme, jaipur, 302001, 25000, consulting, due 5 dec 2026");
    expect(p.taxable_value).toBeNull(); // pincode vs amount: leave it to the reviewer / Gemini
    expect(p.missing_fields).toContain("taxable_value");
  });

  it("does not mistake a 10-digit mobile for the amount", () => {
    const p = parse("invoice for Acme, goa, 9876543210, 5000, due 5 dec 2026");
    expect(p.client_phone).toBe("9876543210");
    expect(p.taxable_value).toBe(5000);
  });

  it("refuses a GST-inclusive amount instead of taxing it twice", () => {
    const p = parse("invoice for Acme, delhi, amount 11800 inclusive of GST, due in 7 days");
    expect(p.amount_includes_gst).toBe(true);
    expect(p.taxable_value).toBeNull();
    expect(p.parse_note).toMatch(/before GST/i);
  });

  it("reads 'no GST' as 0%", () => {
    expect(parse("invoice for Acme, goa, amount 5000, no gst, due 1 dec 2026").gst_rate).toBe(0);
  });

  it("takes the state from a valid GSTIN, and ignores an invalid one", () => {
    const ok = parse("invoice for Acme, amount 5000, gstin 27AAPFU0939F1ZV, due 1 dec 2026");
    expect(ok.client_gstin).toBe("27AAPFU0939F1ZV");
    expect(ok.client_state_code).toBe("27");

    const bad = parse("invoice for Acme, amount 5000, gstin 27AAPFU0939F1ZW, due 1 dec 2026");
    expect(bad.client_gstin).toBeNull();
    expect(bad.client_state_code).toBeNull();
  });

  it("does not take a state from an email domain", () => {
    expect(parse("invoice for Acme, amount 5000, email x@goa-traders.com, due 1 dec 2026").client_state_code).toBeNull();
  });

  it("reads the name from Hinglish but won't guess between two numbers", () => {
    const p = parse("Marc ko 15k ka invoice bhejo, 10 din mein payment");
    expect(p.client_name).toBe("Marc");
    expect(p.taxable_value).toBeNull(); // 15k vs 10 din: ambiguous, left to the AI step
    expect(p.missing_fields).toContain("taxable_value");
  });
});

describe("Hindi digits and currency words", () => {
  it("reads Devanagari digits", () => {
    expect(parse("bill for Acme, jaipur, amount २५०००, due 1 dec 2026").taxable_value).toBe(25000);
  });
  it("reads 'number then currency word'", () => {
    expect(parse("bill for Acme, goa, 25000 rupees, due 1 dec 2026").taxable_value).toBe(25000);
    expect(parse("bill for Acme, goa, 25000 rs, due 1 dec 2026").taxable_value).toBe(25000);
    expect(parse("bill for Acme, goa, २५००० रुपये, due 1 dec 2026").taxable_value).toBe(25000);
  });
  it("reads हजार and लाख", () => {
    expect(parse("bill for Acme, goa, 15 हजार रुपये, due 1 dec 2026").taxable_value).toBe(15000);
    expect(parse("bill for Acme, goa, १.५ लाख रुपये, due 1 dec 2026").taxable_value).toBe(150000);
  });
  it("reads a Hindi sentence's name and amount; the rest is left to the AI step", () => {
    const p = parse("मार्क के लिए २५००० का बिल बनाओ");
    expect(p.client_name).toBe("मार्क");
    expect(p.taxable_value).toBe(25000);
    expect(p.missing_fields).toContain("due_date");
  });
});

describe("business not registered for GST", () => {
  it("does not ask for the client's state", () => {
    const p = parseInvoiceText("bill for Acme, amount 5000, email a@b.com, due 1 dec 2026", TODAY, false);
    expect(p.missing_fields).toEqual([]);
    const q = parseInvoiceText("bill for Acme, amount 5000, email a@b.com, due 1 dec 2026", TODAY, true);
    expect(q.missing_fields).toEqual(["client_state"]);
  });
});

describe("Hinglish: 'X ka 2000 ka bill bana do'", () => {
  it("reads name, amount and the work", () => {
    const p = parse("Deepak sir ka 2000 ka bill bana do, haircut aur facial");
    expect(p).toMatchObject({
      client_name: "Deepak sir",
      taxable_value: 2000,
      description: "haircut aur facial",
      due_date: null,
    });
    expect(p.missing_fields).toEqual(["due_date", "client_state"]);
  });

  it("reads a Devanagari sentence with Devanagari digits", () => {
    const p = parse("दीपक जी का २००० का बिल बना दो");
    expect(p.client_name).toBe("दीपक जी");
    expect(p.taxable_value).toBe(2000);
  });

  it("ignores phone numbers and due dates when picking the one amount", () => {
    const p = parse("Meena ka 5000 ka bill, 9876543210, due in 7 days");
    expect(p).toMatchObject({ client_name: "Meena", taxable_value: 5000, client_phone: "9876543210", due_date: "2026-10-31" });
  });

  it("will not guess when there are two amounts", () => {
    const p = parse("Rohit ka haircut 300 aur beard 150");
    expect(p.client_name).toBe("Rohit");
    expect(p.taxable_value).toBeNull();
    expect(p.missing_fields).toContain("taxable_value");
  });

  it("does not turn 'bill bana do' into a customer name", () => {
    expect(parse("bill bana do ka 500").client_name).toBeNull();
  });

  it("no longer nags for an email/mobile (walk-ins have none)", () => {
    expect(parse("Deepak sir ka 2000 ka bill").missing_fields).not.toContain("client_contact");
  });
});

describe("regression: 'ka' is not the 'k' (thousand) suffix", () => {
  it("reads 2000 ka bill as 2000, not 2,000,000", () => {
    expect(parse("Deepak sir ka 2000 ka bill").taxable_value).toBe(2000);
    expect(parse("Deepak sir ka 2 lakh ka bill").taxable_value).toBe(200000);
    expect(parse("Deepak sir ka 15k ka bill").taxable_value).toBe(15000);
    expect(parse("Deepak sir ka 15 हजार का बिल").taxable_value).toBe(15000);
  });
});
