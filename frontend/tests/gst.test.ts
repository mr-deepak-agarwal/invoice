import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  computeTotals,
  financialYearLabel,
  findStateInText,
  gstinChecksum,
  isRealIsoDate,
  isValidGstin,
  isValidGstRate,
  stateCodeFromGstin,
  taxTypeFor,
} from "../lib/gst";

describe("GSTIN", () => {
  it("accepts a GSTIN with a correct checksum", () => {
    expect(isValidGstin("27AAPFU0939F1ZV")).toBe(true);
    expect(isValidGstin(" 27aapfu0939f1zv ")).toBe(true); // normalised
  });

  it("rejects a wrong checksum, wrong state, bad shape", () => {
    expect(isValidGstin("27AAPFU0939F1ZW")).toBe(false);
    expect(isValidGstin("40AAPFU0939F1Z0")).toBe(false); // no state 40
    expect(isValidGstin("27AAPFU0939F1Y V")).toBe(false);
    expect(isValidGstin("")).toBe(false);
    expect(isValidGstin(null)).toBe(false);
  });

  it("reads the state from the first two digits", () => {
    expect(stateCodeFromGstin("27AAPFU0939F1ZV")).toBe("27");
    expect(stateCodeFromGstin("nonsense")).toBeNull();
  });

  it("computes the check character", () => {
    expect(gstinChecksum("27AAPFU0939F1Z")).toBe("V");
  });
});

describe("tax type", () => {
  it("same state -> intra, different -> inter", () => {
    expect(taxTypeFor("08", "08")).toBe("intra");
    expect(taxTypeFor("08", "30")).toBe("inter"); // Rajasthan seller, Goa client
  });
});

describe("computeTotals", () => {
  it("intra-state splits the rate into CGST + SGST", () => {
    const t = computeTotals(10000, 18, "intra");
    expect(t).toMatchObject({
      cgstRate: 9, sgstRate: 9, igstRate: 0,
      cgst: 900, sgst: 900, igst: 0, total: 11800,
    });
  });

  it("inter-state charges the whole rate as IGST", () => {
    const t = computeTotals(10000, 18, "inter");
    expect(t).toMatchObject({
      cgstRate: 0, sgstRate: 0, igstRate: 18,
      cgst: 0, sgst: 0, igst: 1800, total: 11800,
    });
  });

  it("keeps CGST equal to SGST and the total exact on awkward paise", () => {
    const t = computeTotals(333.33, 18, "intra");
    expect(t.cgst).toBe(30);
    expect(t.sgst).toBe(30);
    expect(t.total).toBe(393.33);
  });

  it("does not drift on float-unfriendly amounts", () => {
    const t = computeTotals(19.99, 5, "inter");
    expect(t.igst).toBe(1);
    expect(t.total).toBe(20.99);
    // classic float trap
    expect(computeTotals(0.1 + 0.2, 0, "intra").total).toBe(0.3);
  });

  it("supports 0% and non-default rates", () => {
    expect(computeTotals(5000, 0, "intra").total).toBe(5000);
    expect(computeTotals(1000, 12, "inter").igst).toBe(120);
    expect(computeTotals(1000, 5, "intra").cgst).toBe(25);
  });

  it("total always equals taxable + taxes", () => {
    for (const amt of [1, 99.99, 1234.56, 99999.99, 250000]) {
      for (const rate of [0, 5, 12, 18, 28]) {
        for (const type of ["intra", "inter"] as const) {
          const t = computeTotals(amt, rate, type);
          expect(Math.round(t.total * 100)).toBe(
            Math.round(t.taxable * 100) + Math.round(t.cgst * 100) +
              Math.round(t.sgst * 100) + Math.round(t.igst * 100)
          );
        }
      }
    }
  });

  it("validates rates", () => {
    expect(isValidGstRate(18)).toBe(true);
    expect(isValidGstRate(-1)).toBe(false);
    expect(isValidGstRate(41)).toBe(false);
    expect(isValidGstRate(NaN)).toBe(false);
    expect(isValidGstRate("18")).toBe(false);
  });
});

describe("findStateInText", () => {
  it("finds states and cities", () => {
    expect(findStateInText("panjim goa")).toBe("30");
    expect(findStateInText("Jaipur")).toBe("08");
    expect(findStateInText("Tamil Nadu")).toBe("33");
    expect(findStateInText("Jammu & Kashmir")).toBe("01");
    expect(findStateInText("new delhi")).toBe("07");
    expect(findStateInText("Navi Mumbai")).toBe("27");
  });

  it("refuses to guess when two states are mentioned", () => {
    expect(findStateInText("Mumbai and Jaipur")).toBeNull();
    expect(findStateInText("Delhi Public School, Jaipur")).toBeNull();
  });

  it("returns null when there is no place", () => {
    expect(findStateInText("web development for Marc")).toBeNull();
    expect(findStateInText("")).toBeNull();
    expect(findStateInText(null)).toBeNull();
  });
});

describe("dates", () => {
  it("rejects impossible dates", () => {
    expect(isRealIsoDate("2026-02-30")).toBe(false);
    expect(isRealIsoDate("2026-13-45")).toBe(false);
    expect(isRealIsoDate("26-01-01")).toBe(false);
    expect(isRealIsoDate("2028-02-29")).toBe(true);
    expect(isRealIsoDate("2027-02-29")).toBe(false);
  });

  it("adds days across month and year ends", () => {
    expect(addDaysIso("2026-10-24", 15)).toBe("2026-11-08");
    expect(addDaysIso("2026-12-25", 10)).toBe("2027-01-04");
  });

  it("labels the Indian financial year (April to March)", () => {
    expect(financialYearLabel("2026-03-31")).toBe("2526");
    expect(financialYearLabel("2026-04-01")).toBe("2627");
    expect(financialYearLabel("2027-01-15")).toBe("2627");
  });
});
