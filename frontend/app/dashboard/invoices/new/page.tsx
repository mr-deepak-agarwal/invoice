"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ParsedInvoiceData } from "@/lib/types";
import {
  DEFAULT_GST_RATE,
  STATE_OPTIONS,
  computeTotals,
  isValidGstin,
  isValidGstRate,
  normalizeGstin,
  stateCodeFromGstin,
  stateName,
  taxTypeFor,
} from "@/lib/gst";
import { formatRupees } from "@/lib/format";
import { MicButton } from "@/components/MicButton";

// All parsing/invoice logic lives in this same Next.js app under
// app/api/ — no separate backend service, no CORS, no API_URL to configure.

type Step = "compose" | "review";

interface ClientSuggestion {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
}

// Matches "...for Deepak" / "...bill Deepak Ag" at the END of whatever
// text is typed so far, so we know what name is being typed right now
// and can suggest a match without waiting for the whole message.
// "for" is checked first since "bill for X" is the common phrasing and
// must not let the word "for" itself get swallowed into the captured name.
const TRAILING_NAME_FOR_RE = /\bfor\s+([A-Za-z][A-Za-z]*(?:\s+[A-Za-z]+)?)$/i;
const TRAILING_NAME_BILL_RE = /\bbill\s+([A-Za-z][A-Za-z]*(?:\s+[A-Za-z]+)?)$/i;

function matchTrailingName(text: string): RegExpMatchArray | null {
  return text.match(TRAILING_NAME_FOR_RE) ?? text.match(TRAILING_NAME_BILL_RE);
}

const FIELD_LABELS: Record<string, string> = {
  client_name: "client name",
  client_contact: "email or mobile",
  taxable_value: "amount",
  due_date: "due date",
  client_state: "client's state",
};

export default function NewInvoicePage() {
  const router = useRouter();
  const supabase = createClient();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [businessStateCode, setBusinessStateCode] = useState<string | null>(null);
  const [businessRegistered, setBusinessRegistered] = useState(true);
  const [businessLoaded, setBusinessLoaded] = useState(false);
  const [step, setStep] = useState<Step>("compose");
  const [rawText, setRawText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matchedClientName, setMatchedClientName] = useState<string | null>(null);
  const [parseNote, setParseNote] = useState<string | null>(null);
  const [noteIsFailure, setNoteIsFailure] = useState(false);
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [assumed, setAssumed] = useState<string[]>([]);

  const [suggestions, setSuggestions] = useState<ClientSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeMatchLength, setActiveMatchLength] = useState(0);

  const [form, setForm] = useState({
    client_name: "",
    client_email: "",
    client_phone: "",
    company_address: "",
    client_gstin: "",
    client_state_code: "",
    taxable_value: "",
    gst_rate: String(DEFAULT_GST_RATE),
    description: "",
    due_date: "",
  });

  useEffect(() => {
    async function loadBusiness() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("businesses")
        .select("state_code, gst_registered")
        .eq("owner_auth_id", user.id)
        .single();
      setBusinessStateCode(data?.state_code ?? null);
      setBusinessRegistered(data?.gst_registered !== false);
      setBusinessLoaded(true);
    }
    loadBusiness();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced autocomplete: look at the text up to the cursor, find a
  // name being typed after "for"/"bill", and search saved clients.
  useEffect(() => {
    const cursor = textareaRef.current?.selectionStart ?? rawText.length;
    const upToCursor = rawText.slice(0, cursor);
    const match = matchTrailingName(upToCursor);

    if (!match || match[1].trim().length < 2) {
      setShowSuggestions(false);
      setSuggestions([]);
      return;
    }

    const partialName = match[1].trim();
    setActiveMatchLength(match[1].length);

    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/clients/search?q=${encodeURIComponent(partialName)}`
        );
        if (!res.ok) return;
        const data: ClientSuggestion[] = await res.json();
        setSuggestions(data);
        setShowSuggestions(data.length > 0);
      } catch {
        // Silently skip — autocomplete is a nice-to-have, not critical path
      }
    }, 250);

    return () => clearTimeout(timeout);
  }, [rawText]);

  function applySuggestion(suggestion: ClientSuggestion) {
    const cursor = textareaRef.current?.selectionStart ?? rawText.length;
    const before = rawText.slice(0, cursor - activeMatchLength);
    const after = rawText.slice(cursor);
    setRawText(`${before}${suggestion.name}${after}`);
    setShowSuggestions(false);

    // Restore focus and put the cursor right after the inserted name
    requestAnimationFrame(() => {
      const pos = before.length + suggestion.name.length;
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(pos, pos);
    });
  }

  async function handleParse(textOverride?: string) {
    const text = textOverride ?? rawText;
    if (!text.trim()) return;
    setParsing(true);
    setError(null);
    setMatchedClientName(null);
    try {
      const res = await fetch(`/api/parse-invoice-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw_text: text }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Could not parse that message");
      }
      const data: ParsedInvoiceData = await res.json();

      setForm({
        client_name: data.client_name ?? "",
        client_email: data.client_email ?? "",
        client_phone: data.client_phone ?? "",
        company_address: data.company_address ?? "",
        client_gstin: data.client_gstin ?? "",
        client_state_code: data.client_state_code ?? "",
        taxable_value: data.taxable_value?.toString() ?? "",
        gst_rate: String(data.gst_rate ?? DEFAULT_GST_RATE),
        description: data.description ?? "",
        due_date: data.due_date ?? "",
      });
      setParseNote(data.parse_note);
      // A note about GST-inclusive amounts is guidance, not a failure.
      setNoteIsFailure(Boolean(data.parse_note) && !data.amount_includes_gst);
      setMissingFields(data.missing_fields ?? []);
      setAssumed(data.defaults_applied ?? []);
      if (data.matched_existing_client) {
        setMatchedClientName(data.client_name);
      }
      setStep("review");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong parsing that"
      );
    } finally {
      setParsing(false);
    }
  }

  // GSTIN beats the dropdown: its first two digits ARE the state.
  const gstinNormalized = normalizeGstin(form.client_gstin);
  const gstinFilled = gstinNormalized.length > 0;
  const gstinOk = !gstinFilled || isValidGstin(gstinNormalized);
  const effectiveStateCode =
    stateCodeFromGstin(gstinNormalized) ?? (form.client_state_code || null);

  const amount = parseFloat(form.taxable_value);
  const rate = parseFloat(form.gst_rate);
  const canPreview =
    Number.isFinite(amount) &&
    amount > 0 &&
    (!businessRegistered ||
      (businessStateCode !== null &&
        effectiveStateCode !== null &&
        isValidGstRate(rate)));
  const preview = canPreview
    ? businessRegistered
      ? computeTotals(
          amount,
          rate,
          taxTypeFor(businessStateCode!, effectiveStateCode!)
        )
      : computeTotals(amount, 0, "intra")
    : null;

  async function handleCreate() {
    if (businessRegistered && !businessStateCode) {
      setError("Set your business state in Settings first.");
      return;
    }
    if (!form.client_name.trim()) {
      setError("Enter the client name.");
      return;
    }
    if (!amount || amount <= 0) {
      setError("Enter the amount (a number, before GST).");
      return;
    }
    if (businessRegistered && !isValidGstRate(rate)) {
      setError("GST rate must be a number between 0 and 40.");
      return;
    }
    if (businessRegistered && !gstinOk) {
      setError("The client GSTIN doesn't look right. Check it or leave it blank.");
      return;
    }
    if (businessRegistered && !effectiveStateCode) {
      setError("Choose the client's state — it decides IGST vs CGST+SGST.");
      return;
    }
    if (!form.due_date) {
      setError("Pick a due date.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/create-invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: form.client_name.trim(),
          client_email: form.client_email || null,
          client_phone: form.client_phone || null,
          client_address: form.company_address || null,
          client_gstin: businessRegistered && gstinFilled ? gstinNormalized : null,
          client_state_code: businessRegistered ? effectiveStateCode : null,
          taxable_value: amount,
          gst_rate: businessRegistered ? rate : 0,
          description: form.description.trim() || undefined,
          due_date: form.due_date,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Could not create the invoice");
      }
      router.push("/dashboard/invoices");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong creating that"
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-display text-2xl text-ink mb-1">New entry</h1>
        <p className="text-sm text-slate">
          Write it the way you&apos;d say it. Bahi fills in the columns — and
          remembers who you&apos;ve billed before.
        </p>
      </header>

      {businessLoaded && businessRegistered && !businessStateCode && (
        <div className="mb-6 max-w-xl text-sm text-ink bg-marigold-soft rounded-card px-3 py-2">
          Set your business state (or GSTIN) in{" "}
          <Link href="/dashboard/settings" className="underline text-bahi-red">
            Settings
          </Link>{" "}
          before creating invoices — Bahi needs it to choose between CGST+SGST
          and IGST.
        </div>
      )}

      {step === "compose" && (
        <div className="max-w-xl">
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              onBlur={() =>
                // slight delay so a click on a suggestion registers first
                setTimeout(() => setShowSuggestions(false), 150)
              }
              rows={5}
              maxLength={2000}
              placeholder="Make a bill for Deepak Agarwal, jaipur, email deepak@gmail.com, mobile 9921880362, amount 20000, web design, due 30 nov 2026"
              className="w-full px-4 py-3 bg-paper-raised border border-ledger-line rounded-card text-sm focus:border-bahi-red outline-none resize-none"
            />

            {showSuggestions && (
              <div className="absolute left-0 right-0 mt-1 bg-white border border-ledger-line rounded-card shadow-sm z-10 overflow-hidden">
                {suggestions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applySuggestion(s)}
                    className="w-full text-left px-4 py-2.5 hover:bg-paper-raised transition-colors flex items-center justify-between gap-3 border-b border-ledger-line last:border-b-0"
                  >
                    <span className="font-medium text-ink text-sm">
                      {s.name}
                    </span>
                    <span className="text-xs text-slate truncate">
                      {s.email ?? s.phone ?? ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <MicButton
            onTranscript={(text, final) => {
              setRawText(text);
              // When you stop speaking, read it straight away. The review
              // screen still shows everything before anything is created.
              if (final && text) handleParse(text);
            }}
          />

          <p className="text-xs text-slate mt-2">
            {businessRegistered
              ? "Include the client's city or state — it decides IGST vs CGST+SGST. "
              : "Your invoices carry no GST (you're marked as not registered). "}
            After the first invoice, typing a saved client&apos;s name fills in
            their email, phone, address and state automatically.
          </p>

          {error && <p className="text-sm text-bahi-red-dark mt-2">{error}</p>}
          <button
            onClick={() => handleParse()}
            disabled={parsing || !rawText.trim()}
            className="mt-4 bg-bahi-red text-white rounded-card px-5 py-2.5 text-sm font-medium hover:bg-bahi-red-dark transition-colors disabled:opacity-60"
          >
            {parsing ? "Reading…" : "Read it"}
          </button>
        </div>
      )}

      {step === "review" && (
        <div className="max-w-xl">
          <p className="text-xs text-slate uppercase tracking-wide mb-4">
            Check the columns before it&apos;s entered in the ledger
          </p>

          {matchedClientName && (
            <div className="mb-4 flex items-center gap-2 text-sm text-bahi-red bg-bahi-red/5 border border-bahi-red/20 rounded-card px-3 py-2">
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-bahi-red text-[10px] leading-none">
                ✓
              </span>
              Using saved details for {matchedClientName}
            </div>
          )}

          {parseNote && noteIsFailure && (
            <div className="mb-4 text-sm text-ink bg-marigold-soft rounded-card px-3 py-2">
              <p className="font-medium">
                Automatic reading didn&apos;t work, so please fill in the fields
                below.
              </p>
              <p className="text-xs text-slate mt-1 break-words">{parseNote}</p>
            </div>
          )}

          {parseNote && !noteIsFailure && (
            <div className="mb-4 text-sm text-ink bg-marigold-soft rounded-card px-3 py-2">
              {parseNote}
            </div>
          )}

          {assumed.length > 0 && (
            <div className="mb-4 text-sm text-ink bg-marigold-soft rounded-card px-3 py-2">
              Assumed from your settings:{" "}
              {assumed
                .map((a) =>
                  a === "due_date" ? "due date (your default terms)" : "client is in your state"
                )
                .join(", ")}
              . Change it below if that&apos;s wrong.
            </div>
          )}

          {!noteIsFailure && missingFields.length > 0 && (
            <div className="mb-4 text-sm text-ink bg-marigold-soft rounded-card px-3 py-2">
              Still needed:{" "}
              {missingFields.map((f) => FIELD_LABELS[f] ?? f).join(", ")}.
            </div>
          )}

          <div className="space-y-4 bg-paper-raised border border-ledger-line rounded-card p-5">
            <Field
              label="Client name"
              value={form.client_name}
              onChange={(v) => setForm({ ...form, client_name: v })}
            />
            <Field
              label="Email"
              value={form.client_email}
              onChange={(v) => setForm({ ...form, client_email: v })}
            />
            <Field
              label="Mobile"
              value={form.client_phone}
              onChange={(v) => setForm({ ...form, client_phone: v })}
            />
            <Field
              label="Address"
              value={form.company_address}
              onChange={(v) => setForm({ ...form, company_address: v })}
            />
            {businessRegistered && (
            <Field
              label="Client GSTIN (optional)"
              value={form.client_gstin}
              onChange={(v) => setForm({ ...form, client_gstin: v.toUpperCase() })}
              invalid={!gstinOk}
              hint={
                gstinFilled && !gstinOk
                  ? "This doesn't look like a valid GSTIN."
                  : undefined
              }
            />
            )}

            {businessRegistered && (
            <div>
              <label className="block text-xs text-slate mb-1.5">
                Place of supply (client&apos;s state)
              </label>
              <select
                value={effectiveStateCode ?? ""}
                disabled={Boolean(stateCodeFromGstin(gstinNormalized))}
                onChange={(e) =>
                  setForm({ ...form, client_state_code: e.target.value })
                }
                className="w-full px-3 py-2 bg-white border border-ledger-line rounded-card text-sm focus:border-bahi-red outline-none disabled:opacity-70"
              >
                <option value="">Choose a state…</option>
                {STATE_OPTIONS.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
              {stateCodeFromGstin(gstinNormalized) && (
                <p className="text-xs text-slate mt-1">
                  Taken from the GSTIN.
                </p>
              )}
            </div>
            )}

            <Field
              label={businessRegistered ? "Amount (₹, before GST)" : "Amount (₹)"}
              value={form.taxable_value}
              onChange={(v) => setForm({ ...form, taxable_value: v })}
            />
            {businessRegistered && (
            <Field
              label="GST rate (%)"
              value={form.gst_rate}
              onChange={(v) => setForm({ ...form, gst_rate: v })}
              invalid={form.gst_rate !== "" && !isValidGstRate(rate)}
            />
            )}
            <Field
              label="What is this for?"
              value={form.description}
              onChange={(v) => setForm({ ...form, description: v })}
            />
            <Field
              label="Due date"
              type="date"
              value={form.due_date}
              onChange={(v) => setForm({ ...form, due_date: v })}
            />
          </div>

          {preview && (
            <div className="mt-4 text-sm bg-paper-raised border border-ledger-line rounded-card px-5 py-4">
              <p className="text-xs text-slate uppercase tracking-wide mb-2">
                {businessRegistered
                  ? `Tax on this invoice · supply to ${stateName(effectiveStateCode)}`
                  : "No GST charged"}
              </p>
              {businessRegistered && (
                <Row label="Amount before GST" value={formatRupees(preview.taxable, 2)} />
              )}
              {!businessRegistered ? null : preview.taxType === "intra" ? (
                <>
                  <Row label={`CGST @ ${preview.cgstRate}%`} value={formatRupees(preview.cgst, 2)} />
                  <Row label={`SGST @ ${preview.sgstRate}%`} value={formatRupees(preview.sgst, 2)} />
                </>
              ) : (
                <Row label={`IGST @ ${preview.igstRate}%`} value={formatRupees(preview.igst, 2)} />
              )}
              <div className="flex justify-between border-t border-ledger-line pt-2 mt-2 font-medium">
                <span>Total</span>
                <span className="font-mono tabular">{formatRupees(preview.total, 2)}</span>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-bahi-red-dark mt-3">{error}</p>}

          <div className="flex gap-3 mt-4">
            <button
              onClick={() => setStep("compose")}
              className="text-sm text-slate hover:text-ink px-4 py-2.5"
            >
              Back
            </button>
            <button
              onClick={handleCreate}
              disabled={creating || (businessRegistered && !businessStateCode)}
              className="bg-bahi-red text-white rounded-card px-5 py-2.5 text-sm font-medium hover:bg-bahi-red-dark transition-colors disabled:opacity-60"
            >
              {creating ? "Entering…" : "Add to ledger"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-slate">{label}</span>
      <span className="font-mono tabular">{value}</span>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  invalid = false,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  invalid?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-slate mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full px-3 py-2 bg-white border rounded-card text-sm outline-none font-mono tabular ${
          invalid
            ? "border-bahi-red-dark focus:border-bahi-red-dark"
            : "border-ledger-line focus:border-bahi-red"
        }`}
      />
      {hint && <p className="text-xs text-bahi-red-dark mt-1">{hint}</p>}
    </div>
  );
}
