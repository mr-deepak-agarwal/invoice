"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ParsedInvoiceData } from "@/lib/types";

// All parsing/invoice logic now lives in this same Next.js app under
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

export default function NewInvoicePage() {
  const router = useRouter();
  const supabase = createClient();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [businessId, setBusinessId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("compose");
  const [rawText, setRawText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matchedClientName, setMatchedClientName] = useState<string | null>(
    null
  );
  const [parseNote, setParseNote] = useState<string | null>(null);
  const [missingFields, setMissingFields] = useState<string[]>([]);

  const [suggestions, setSuggestions] = useState<ClientSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeMatchLength, setActiveMatchLength] = useState(0);

  const [form, setForm] = useState({
    client_name: "",
    client_email: "",
    client_phone: "",
    company_address: "",
    taxable_value: "",
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
        .select("id")
        .eq("owner_auth_id", user.id)
        .single();
      setBusinessId(data?.id ?? null);
    }
    loadBusiness();
  }, []);

  // Debounced autocomplete: look at the text up to the cursor, find a
  // name being typed after "for"/"bill", and search saved clients.
  useEffect(() => {
    if (!businessId) return;
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
          `/api/clients/${businessId}/search?q=${encodeURIComponent(
            partialName
          )}`
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
  }, [rawText, businessId]);

  function applySuggestion(suggestion: ClientSuggestion) {
    const cursor = textareaRef.current?.selectionStart ?? rawText.length;
    const before = rawText.slice(0, cursor - activeMatchLength);
    const after = rawText.slice(cursor);
    const newText = `${before}${suggestion.name}${after}`;
    setRawText(newText);
    setShowSuggestions(false);

    // Restore focus and put the cursor right after the inserted name
    requestAnimationFrame(() => {
      const pos = before.length + suggestion.name.length;
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(pos, pos);
    });
  }

  async function handleParse() {
    if (!rawText.trim()) return;
    setParsing(true);
    setError(null);
    setMatchedClientName(null);
    try {
      const res = await fetch(`/api/parse-invoice-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw_text: rawText,
          channel: "web",
          channel_identifier: businessId ?? "web",
          business_id: businessId,
        }),
      });
      if (!res.ok) throw new Error("Could not parse that message");
      const data: ParsedInvoiceData = await res.json();

      setForm({
        client_name: data.client_name ?? "",
        client_email: data.client_email ?? "",
        client_phone: data.client_phone ?? "",
        company_address: data.company_address ?? "",
        taxable_value: data.taxable_value?.toString() ?? "",
        description: data.description ?? "",
        due_date: data.due_date ?? "",
      });
      setParseNote(data.parse_note);
      setMissingFields(data.missing_fields ?? []);
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

  async function handleCreate() {
    if (!businessId) {
      setError("Could not find your business — try signing in again.");
      return;
    }
    const amount = parseFloat(form.taxable_value);
    if (!form.client_name.trim()) {
      setError("Enter the client name.");
      return;
    }
    if (!amount || amount <= 0) {
      setError("Enter the amount (a number, before GST).");
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
          business_id: businessId,
          client_name: form.client_name.trim(),
          client_email: form.client_email || null,
          client_phone: form.client_phone || null,
          client_address: form.company_address || null,
          taxable_value: amount,
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
          Write it the way you'd say it. Bahi fills in the columns — and
          remembers who you've billed before.
        </p>
      </header>

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
              placeholder="Make a bill for Deepak Agarwal, email deepak@gmail.com, mobile 9921880362, address aa, jaipur, amount 20000, due by 30 nov 2025"
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

          <p className="text-xs text-slate mt-2">
            Tip: after the first invoice, just typing a saved client's name
            fills in their email, phone, and address automatically.
          </p>

          {error && (
            <p className="text-sm text-bahi-red-dark mt-2">{error}</p>
          )}
          <button
            onClick={handleParse}
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
            Check the columns before it's entered in the ledger
          </p>

          {matchedClientName && (
            <div className="mb-4 flex items-center gap-2 text-sm text-bahi-red bg-bahi-red/5 border border-bahi-red/20 rounded-card px-3 py-2">
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-bahi-red text-[10px] leading-none">
                ✓
              </span>
              Using saved details for {matchedClientName}
            </div>
          )}

          {parseNote && (
            <div className="mb-4 text-sm text-ink bg-marigold-soft rounded-card px-3 py-2">
              <p className="font-medium">
                Automatic reading didn't work, so please fill in the fields
                below.
              </p>
              <p className="text-xs text-slate mt-1 break-words">{parseNote}</p>
            </div>
          )}

          {!parseNote && missingFields.length > 0 && (
            <div className="mb-4 text-sm text-ink bg-marigold-soft rounded-card px-3 py-2">
              Still needed:{" "}
              {missingFields
                .map((f) =>
                  f === "client_name"
                    ? "client name"
                    : f === "client_contact"
                    ? "email or mobile"
                    : f === "taxable_value"
                    ? "amount"
                    : "due date"
                )
                .join(", ")}
              .
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
            <Field
              label="Amount (₹, before GST)"
              value={form.taxable_value}
              onChange={(v) => setForm({ ...form, taxable_value: v })}
            />
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

          {error && (
            <p className="text-sm text-bahi-red-dark mt-3">{error}</p>
          )}

          <div className="flex gap-3 mt-4">
            <button
              onClick={() => setStep("compose")}
              className="text-sm text-slate hover:text-ink px-4 py-2.5"
            >
              Back
            </button>
            <button
              onClick={handleCreate}
              disabled={creating}
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

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-slate mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 bg-white border border-ledger-line rounded-card text-sm focus:border-bahi-red outline-none font-mono tabular"
      />
    </div>
  );
}
