"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  STATE_OPTIONS,
  isValidGstin,
  normalizeGstin,
  stateCodeFromGstin,
} from "@/lib/gst";
import { isValidUpiId } from "@/lib/upi";

export interface BusinessProfile {
  id: string;
  name: string;
  address: string | null;
  state_code: string | null;
  gstin: string | null;
  pan: string | null;
  phone: string | null;
  email: string | null;
  bank_name: string | null;
  account_number: string | null;
  ifsc: string | null;
  invoice_prefix: string;
  default_sac_code: string;
  gst_registered: boolean;
  upi_id: string | null;
  default_due_days: number | null;
  assume_local_supply: boolean;
}

const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const PREFIX_RE = /^[A-Za-z0-9-]{1,5}$/;
const SAC_RE = /^\d{4,8}$/;

export function SettingsForm({ business }: { business: BusinessProfile }) {
  const router = useRouter();
  const [f, setF] = useState({
    name: business.name ?? "",
    address: business.address ?? "",
    state_code: business.state_code ?? "",
    gstin: business.gstin ?? "",
    pan: business.pan ?? "",
    phone: business.phone ?? "",
    email: business.email ?? "",
    bank_name: business.bank_name ?? "",
    account_number: business.account_number ?? "",
    ifsc: business.ifsc ?? "",
    invoice_prefix: business.invoice_prefix ?? "INV",
    default_sac_code: business.default_sac_code ?? "998311",
    upi_id: business.upi_id ?? "",
  });
  const [registered, setRegistered] = useState(business.gst_registered !== false);
  const [terms, setTerms] = useState(
    business.default_due_days == null ? "" : String(business.default_due_days)
  );
  const [assumeLocal, setAssumeLocal] = useState(business.assume_local_supply === true);
  const termOptions = Array.from(
    new Set([0, 7, 15, 30, ...(business.default_due_days == null ? [] : [business.default_due_days])])
  ).sort((a, b) => a - b);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const gstin = normalizeGstin(f.gstin);
  const gstinState = stateCodeFromGstin(gstin);
  const effectiveState = gstinState ?? f.state_code;

  function set<K extends keyof typeof f>(key: K, value: string) {
    setSaved(false);
    setF({ ...f, [key]: value });
  }

  async function save() {
    setError(null);
    setSaved(false);

    const pan = f.pan.trim().toUpperCase();
    const ifsc = f.ifsc.trim().toUpperCase();

    if (!f.name.trim()) return setError("Enter your business name.");
    if (registered && gstin && !isValidGstin(gstin))
      return setError("That GSTIN doesn't look right. Check it or leave it blank.");
    if (registered && !effectiveState)
      return setError("Choose your state (or enter your GSTIN).");
    const upi = f.upi_id.trim();
    if (upi && !isValidUpiId(upi))
      return setError("UPI ID should look like name@bank.");
    if (pan && !PAN_RE.test(pan)) return setError("PAN should look like ABCDE1234F.");
    if (ifsc && !IFSC_RE.test(ifsc)) return setError("IFSC should look like HDFC0001234.");
    if (!PREFIX_RE.test(f.invoice_prefix))
      return setError("Invoice prefix: 1–5 letters, digits or hyphens.");
    if (!SAC_RE.test(f.default_sac_code))
      return setError("SAC code must be 4 to 8 digits.");

    const orNull = (s: string) => (s.trim() === "" ? null : s.trim());

    setSaving(true);
    try {
      const supabase = createClient();
      // Row Level Security only lets you update your own business.
      const { error: updateError } = await supabase
        .from("businesses")
        .update({
          name: f.name.trim(),
          address: orNull(f.address),
          gst_registered: registered,
          state_code: registered ? effectiveState : f.state_code || null,
          gstin: registered ? gstin || null : null,
          upi_id: upi || null,
          default_due_days: terms === "" ? null : Number(terms),
          assume_local_supply: registered && assumeLocal,
          pan: pan || null,
          phone: orNull(f.phone),
          email: orNull(f.email),
          bank_name: orNull(f.bank_name),
          account_number: orNull(f.account_number),
          ifsc: ifsc || null,
          invoice_prefix: f.invoice_prefix.trim(),
          default_sac_code: f.default_sac_code.trim(),
        })
        .eq("id", business.id);
      if (updateError) {
        setError("Could not save. Please check the fields and try again.");
        return;
      }
      setSaved(true);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="space-y-4 bg-paper-raised border border-ledger-line rounded-card p-5">
        <Input label="Business name" value={f.name} onChange={(v) => set("name", v)} />
        <Input label="Address" value={f.address} onChange={(v) => set("address", v)} />
        <label className="flex items-start gap-2 text-sm text-ink cursor-pointer">
          <input
            type="checkbox"
            checked={registered}
            onChange={(e) => {
              setSaved(false);
              setRegistered(e.target.checked);
            }}
            className="mt-1"
          />
          <span>
            I&apos;m registered for GST
            <span className="block text-xs text-slate">
              Untick if you aren&apos;t (e.g. a freelancer under the registration
              limit). Your invoices will carry no GST and need no state.
              Check your own obligations — Bahi isn&apos;t tax advice.
            </span>
          </span>
        </label>
        {registered && (
        <Input
          label="GSTIN"
          value={f.gstin}
          onChange={(v) => set("gstin", v.toUpperCase())}
          invalid={gstin.length > 0 && !isValidGstin(gstin)}
          hint={
            gstin.length > 0 && !isValidGstin(gstin)
              ? "This doesn't look like a valid GSTIN."
              : undefined
          }
        />
        )}
        {registered && (
        <div>
          <label className="block text-xs text-slate mb-1.5">State</label>
          <select
            value={effectiveState}
            disabled={Boolean(gstinState)}
            onChange={(e) => set("state_code", e.target.value)}
            className="w-full px-3 py-2 bg-white border border-ledger-line rounded-card text-sm focus:border-bahi-red outline-none disabled:opacity-70"
          >
            <option value="">Choose a state…</option>
            {STATE_OPTIONS.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name} ({s.code})
              </option>
            ))}
          </select>
          {gstinState && (
            <p className="text-xs text-slate mt-1">Taken from your GSTIN.</p>
          )}
        </div>
        )}
        <Input label="PAN" value={f.pan} onChange={(v) => set("pan", v.toUpperCase())} />
        <Input label="Phone" value={f.phone} onChange={(v) => set("phone", v)} />
        <Input label="Email" value={f.email} onChange={(v) => set("email", v)} />
        <div>
          <label className="block text-xs text-slate mb-1.5">Default payment terms</label>
          <select
            value={terms}
            onChange={(e) => {
              setSaved(false);
              setTerms(e.target.value);
            }}
            className="w-full px-3 py-2 bg-white border border-ledger-line rounded-card text-sm focus:border-bahi-red outline-none"
          >
            <option value="">Ask me every time</option>
            {termOptions.map((d) => (
              <option key={d} value={String(d)}>
                {d === 0 ? "Due on receipt (same day)" : `${d} days`}
              </option>
            ))}
          </select>
          <p className="text-xs text-slate mt-1">
            Used when a message doesn&apos;t say when payment is due. The review
            screen always shows what was assumed.
          </p>
        </div>
        {registered && (
          <label className="flex items-start gap-2 text-sm text-ink cursor-pointer">
            <input
              type="checkbox"
              checked={assumeLocal}
              onChange={(e) => {
                setSaved(false);
                setAssumeLocal(e.target.checked);
              }}
              className="mt-1"
            />
            <span>
              Assume clients are in my state unless I say otherwise
              <span className="block text-xs text-slate">
                Right for local customers (salons, clinics, shops). For
                out-of-state clients, mention their city or state — otherwise
                the invoice gets CGST+SGST instead of IGST. The review screen
                shows what was assumed.
              </span>
            </span>
          </label>
        )}
        <Input
          label="UPI ID (for payment links and QR)"
          value={f.upi_id}
          onChange={(v) => set("upi_id", v.trim())}
          invalid={f.upi_id.length > 0 && !isValidUpiId(f.upi_id)}
          hint={
            f.upi_id.length > 0 && !isValidUpiId(f.upi_id)
              ? "UPI ID should look like name@bank."
              : undefined
          }
        />
        <Input label="Bank name" value={f.bank_name} onChange={(v) => set("bank_name", v)} />
        <Input label="Account number" value={f.account_number} onChange={(v) => set("account_number", v)} />
        <Input label="IFSC" value={f.ifsc} onChange={(v) => set("ifsc", v.toUpperCase())} />
        <Input
          label="Invoice prefix"
          value={f.invoice_prefix}
          onChange={(v) => set("invoice_prefix", v)}
          hint={`Numbers look like ${f.invoice_prefix || "INV"}/2627/0001 — sequential per financial year (April–March).`}
          hintIsInfo
        />
        <Input
          label="Default SAC / HSN code"
          value={f.default_sac_code}
          onChange={(v) => set("default_sac_code", v)}
        />
      </div>

      {error && <p className="text-sm text-bahi-red-dark mt-3">{error}</p>}
      {saved && <p className="text-sm text-ink mt-3">Saved.</p>}

      <button
        onClick={save}
        disabled={saving}
        className="mt-4 bg-bahi-red text-white rounded-card px-5 py-2.5 text-sm font-medium hover:bg-bahi-red-dark transition-colors disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save settings"}
      </button>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  invalid = false,
  hint,
  hintIsInfo = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  hint?: string;
  hintIsInfo?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs text-slate mb-1.5">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full px-3 py-2 bg-white border rounded-card text-sm outline-none font-mono tabular ${
          invalid
            ? "border-bahi-red-dark focus:border-bahi-red-dark"
            : "border-ledger-line focus:border-bahi-red"
        }`}
      />
      {hint && (
        <p className={`text-xs mt-1 ${hintIsInfo ? "text-slate" : "text-bahi-red-dark"}`}>
          {hint}
        </p>
      )}
    </div>
  );
}
