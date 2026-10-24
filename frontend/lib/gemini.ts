import { GoogleGenAI, Type } from "@google/genai";

/**
 * LLM fallback parser using Google's free-tier Gemini API.
 *
 * WHY A FALLBACK, NOT THE PRIMARY PARSER: regex (lib/parser.ts) is free
 * and instant but only handles fairly structured phrasing. This module
 * is called ONLY when regex leaves fields missing — casual phrasing,
 * reordered fields, or Hindi/Hinglish input.
 *
 * SETUP:
 * 1. Get a free API key at https://aistudio.google.com/apikey
 * 2. Set GEMINI_API_KEY (server-side only — do NOT prefix with
 *    NEXT_PUBLIC_, or it will be bundled into client-side JS).
 * 3. GEMINI_MODEL is optional. Google retires and renames models often
 *    (gemini-2.5-flash, for example, is now limited to existing users),
 *    so if it is unset or fails, we automatically try the models in
 *    DEFAULT_MODELS below. Update that list when Google changes things:
 *    https://ai.google.dev/gemini-api/docs/models
 */

const DEFAULT_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash",
];

function candidateModels(): string[] {
  const fromEnv = process.env.GEMINI_MODEL?.trim();
  return Array.from(new Set(fromEnv ? [fromEnv, ...DEFAULT_MODELS] : DEFAULT_MODELS));
}

let client: GoogleGenAI | null = null;

function getClient(apiKey: string): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
}

function todayInIndia(): string {
  // en-CA formats as YYYY-MM-DD
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function buildPrompt(text: string): string {
  return `Extract invoice details from this message. The message may be in English, Hindi, or a mix (Hinglish).

Today's date (India) is ${todayInIndia()}.

Message: "${text}"

Rules:
- client_name is the person or company being billed.
- company_address is the client's address or city, if given (e.g. "panjim goa").
- taxable_value is the base amount before any tax, as a plain number (no currency symbols, no commas, no words like "rupees" or "k" — convert "15k" to 15000).
- description is a short phrase naming the work or service being billed (e.g. "Web development, July 2026"), if mentioned.
- due_date must be YYYY-MM-DD. Only fill it if the message says when payment is DUE (e.g. "pay by 30 nov", "due in 10 days"); resolve relative dates using today's date. A period when the work was done (e.g. "work done in July 2026") is NOT a due date.
- Only extract information actually present in the message — never invent a name, amount, or date that isn't there.
- If a field is not mentioned, use null for it.`;
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    client_name: { type: Type.STRING, nullable: true },
    client_email: { type: Type.STRING, nullable: true },
    client_phone: { type: Type.STRING, nullable: true },
    company_address: { type: Type.STRING, nullable: true },
    taxable_value: { type: Type.NUMBER, nullable: true },
    description: { type: Type.STRING, nullable: true },
    due_date: { type: Type.STRING, nullable: true },
  },
  required: [
    "client_name",
    "client_email",
    "client_phone",
    "company_address",
    "taxable_value",
    "description",
    "due_date",
  ],
};

export interface GeminiParsedFields {
  client_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  company_address: string | null;
  taxable_value: number | null;
  description: string | null;
  due_date: string | null;
}

export type GeminiResult =
  | { ok: true; fields: GeminiParsedFields; model: string }
  | { ok: false; reason: string };

function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/\s+/g, " ").slice(0, 240);
}

/** Never throws. Returns { ok: false, reason } so the caller can keep
 * whatever regex found AND tell the user why the AI step didn't help. */
export async function parseWithGemini(rawText: string): Promise<GeminiResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "GEMINI_API_KEY is not set on the server" };
  }

  const ai = getClient(apiKey);
  const failures: string[] = [];

  for (const model of candidateModels()) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: buildPrompt(rawText),
        config: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0,
          // Don't let a slow model hold up the web request or Telegram webhook.
          httpOptions: { timeout: 8000 },
        },
      });

      const raw = response.text;
      if (!raw) {
        failures.push(`${model}: empty response`);
        continue;
      }
      const data = JSON.parse(raw);

      const due_date =
        typeof data.due_date === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(data.due_date)
          ? data.due_date
          : null;

      return {
        ok: true,
        model,
        fields: {
          client_name: data.client_name ?? null,
          client_email: data.client_email ?? null,
          client_phone: data.client_phone ?? null,
          company_address: data.company_address ?? null,
          taxable_value:
            typeof data.taxable_value === "number" ? data.taxable_value : null,
          description: data.description ?? null,
          due_date,
        },
      };
    } catch (err) {
      const text = errorText(err);
      failures.push(`${model}: ${text}`);
      // Only move on to the next model when THIS model is the problem
      // (retired, no access, out of quota). For network errors, timeouts or
      // a bad API key every model would fail the same way and just waste time.
      if (!/404|NOT_FOUND|not found|no longer available|not supported|limited to|429|RESOURCE_EXHAUSTED|quota/i.test(text)) {
        break;
      }
    }
  }

  return { ok: false, reason: failures.join(" | ") };
}
