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
 * 3. Optionally set GEMINI_MODEL to override the default. Google's
 *    model names/aliases change fairly often — if extraction starts
 *    failing, check https://ai.google.dev/gemini-api/docs/models for
 *    the current free-tier model name.
 */

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

function buildPrompt(text: string): string {
  return `Extract invoice details from this message. The message may be in English, Hindi, or a mix (Hinglish).

Message: "${text}"

Rules:
- taxable_value is the base amount before any tax, as a plain number (no currency symbols, no commas, no words like "rupees" or "k" — convert "15k" to 15000).
- due_date must be in YYYY-MM-DD format. If a relative date is used ("next Friday", "in 10 days") and cannot be resolved without knowing today's date, leave it null rather than guessing.
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
    due_date: { type: Type.STRING, nullable: true },
  },
  required: [
    "client_name",
    "client_email",
    "client_phone",
    "company_address",
    "taxable_value",
    "due_date",
  ],
};

export interface GeminiParsedFields {
  client_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  company_address: string | null;
  taxable_value: number | null;
  due_date: string | null;
}

/** Returns null on ANY failure (missing key, network error, bad JSON) so
 * the caller can silently keep whatever regex already found. */
export async function parseWithGemini(
  rawText: string
): Promise<GeminiParsedFields | null> {
  try {
    const ai = getClient();
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: buildPrompt(rawText),
      config: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0,
      },
    });

    const raw = response.text;
    if (!raw) return null;
    const data = JSON.parse(raw);

    let due_date: string | null = null;
    if (typeof data.due_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.due_date)) {
      due_date = data.due_date;
    }

    return {
      client_name: data.client_name ?? null,
      client_email: data.client_email ?? null,
      client_phone: data.client_phone ?? null,
      company_address: data.company_address ?? null,
      taxable_value:
        typeof data.taxable_value === "number" ? data.taxable_value : null,
      due_date,
    };
  } catch {
    return null;
  }
}
