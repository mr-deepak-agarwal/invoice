import { describe, expect, it } from "vitest";
import { parseInvoiceText } from "../lib/parser";
import data from "./evals/messages.json";

// Runs the 'regex' tier of the eval set on every CI run. The 'llm' tier
// is for scoring the Gemini step offline — see the note in the JSON file.
describe("eval set (regex tier)", () => {
  for (const c of data.cases.filter((c) => c.tier === "regex")) {
    it(c.text, () => {
      const p = parseInvoiceText(c.text, "2026-10-24") as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(c.expect)) {
        expect(p[key], key).toEqual(value);
      }
    });
  }
});
