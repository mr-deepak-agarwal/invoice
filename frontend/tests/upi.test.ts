import { describe, expect, it } from "vitest";
import { buildUpiUri, isValidUpiId } from "../lib/upi";

describe("UPI ids", () => {
  it("accepts normal VPAs and rejects junk", () => {
    for (const ok of ["name@okhdfcbank", "9876543210@ybl", "a.b-c_d@paytm"]) {
      expect(isValidUpiId(ok), ok).toBe(true);
    }
    for (const bad of ["", "no-at-sign", "a@b", "spa ce@bank", "x@bank!", "@bank", null, 5]) {
      expect(isValidUpiId(bad as never), String(bad)).toBe(false);
    }
  });
});

describe("buildUpiUri", () => {
  it("builds a standard pay link", () => {
    const uri = buildUpiUri({
      vpa: "shop@okhdfcbank",
      payeeName: "Bahi Studio",
      amount: 11800,
      note: "Invoice INV/2627/0001",
      reference: "INV/2627/0001",
    });
    expect(uri).toBe(
      "upi://pay?pa=shop@okhdfcbank&pn=Bahi%20Studio&am=11800.00&cu=INR&tn=Invoice%20INV%2F2627%2F0001&tr=INV26270001"
    );
  });

  it("always uses two decimals and INR", () => {
    expect(buildUpiUri({ vpa: "a.b@ybl", payeeName: "X", amount: 99.5 })).toContain("am=99.50&cu=INR");
  });

  it("encodes characters that would break the URL", () => {
    const uri = buildUpiUri({ vpa: "a.b@ybl", payeeName: "R&D Co #1", amount: 1, note: "a&b=c" });
    expect(uri).toContain("pn=R%26D%20Co%20%231");
    expect(uri).toContain("tn=a%26b%3Dc");
    expect(uri.split("&").length).toBe(5); // pa, pn, am, cu, tn — nothing injected
  });

  it("truncates long names and notes to UPI limits", () => {
    const uri = buildUpiUri({ vpa: "a.b@ybl", payeeName: "N".repeat(100), amount: 1, note: "n".repeat(100), reference: "r".repeat(100) });
    expect(decodeURIComponent(uri.match(/pn=([^&]*)/)![1]).length).toBe(40);
    expect(decodeURIComponent(uri.match(/tn=([^&]*)/)![1]).length).toBe(50);
    expect(uri.match(/tr=([^&]*)/)![1].length).toBe(35);
  });

  it("refuses an invalid id or amount instead of making a bad link", () => {
    expect(() => buildUpiUri({ vpa: "bad", payeeName: "X", amount: 1 })).toThrow();
    expect(() => buildUpiUri({ vpa: "a.b@ybl", payeeName: "X", amount: 0 })).toThrow();
    expect(() => buildUpiUri({ vpa: "a.b@ybl", payeeName: "X", amount: NaN })).toThrow();
  });
});

import { qrSvg } from "../lib/upiQr";

describe("qrSvg", () => {
  it("renders an SVG for a UPI link", async () => {
    const svg = await qrSvg(buildUpiUri({ vpa: "a.b@ybl", payeeName: "X", amount: 10 }));
    expect(svg.startsWith("<svg") || svg.includes("<svg")).toBe(true);
    expect(svg).toContain("</svg>");
  });
});
