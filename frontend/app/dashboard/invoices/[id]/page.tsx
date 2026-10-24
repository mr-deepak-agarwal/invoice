import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate, formatRupees } from "@/lib/format";
import { effectiveStatus } from "@/lib/status";
import type { InvoiceStatus } from "@/lib/types";
import { MarkPaidButton } from "./MarkPaidButton";
import { PrintButton } from "./PrintButton";

interface InvoiceDetailRow {
  id: string;
  invoice_number: string;
  description: string;
  sac_code: string | null;
  taxable_value: number;
  cgst_rate: number;
  sgst_rate: number;
  igst_rate: number;
  total_value: number;
  place_of_supply: string | null;
  due_date: string;
  status: InvoiceStatus;
  created_at: string;
  clients: {
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    gstin: string | null;
  } | null;
  businesses: {
    name: string;
    address: string | null;
    gstin: string | null;
    pan: string | null;
    phone: string | null;
    email: string | null;
    bank_name: string | null;
    account_number: string | null;
    ifsc: string | null;
  } | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function Line({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <p className="text-sm text-ink">
      <span className="text-slate">{label}: </span>
      {value}
    </p>
  );
}

export default async function InvoiceDetailPage({
  params,
}: {
  params: { id: string };
}) {
  // Uses the signed-in user's session, so database security only returns
  // this invoice if it belongs to their business.
  const supabase = createClient();
  const { data } = await supabase
    .from("invoices")
    .select(
      "*, clients(name, email, phone, address, gstin), businesses(name, address, gstin, pan, phone, email, bank_name, account_number, ifsc)"
    )
    .eq("id", params.id)
    .maybeSingle();

  if (!data) notFound();
  const inv = data as unknown as InvoiceDetailRow;

  const taxable = Number(inv.taxable_value);
  const cgst = round2((taxable * Number(inv.cgst_rate)) / 100);
  const sgst = round2((taxable * Number(inv.sgst_rate)) / 100);
  const igst = round2((taxable * Number(inv.igst_rate)) / 100);
  const status = effectiveStatus(inv.status, inv.due_date);
  const canMarkPaid = status !== "paid" && status !== "cancelled";

  return (
    <div className="max-w-2xl">
      <Link
        href="/dashboard/invoices"
        className="print:hidden text-sm text-slate hover:text-bahi-red"
      >
        ← All invoices
      </Link>

      <header className="flex items-start justify-between gap-4 mt-4 mb-8">
        <div>
          <h1 className="font-display text-2xl text-ink mb-1">
            {inv.invoice_number}
          </h1>
          <p className="text-sm text-slate">
            Created {formatDate(inv.created_at)} · due {formatDate(inv.due_date)}
          </p>
        </div>
        <StatusBadge status={status} />
      </header>

      <div className="grid grid-cols-2 gap-6 mb-8">
        <section>
          <h2 className="text-xs text-slate uppercase tracking-wide mb-2">
            Billed to
          </h2>
          <p className="font-medium text-ink">{inv.clients?.name ?? "—"}</p>
          <Line label="Email" value={inv.clients?.email} />
          <Line label="Mobile" value={inv.clients?.phone} />
          <Line label="Address" value={inv.clients?.address} />
          <Line label="GSTIN" value={inv.clients?.gstin} />
        </section>
        <section>
          <h2 className="text-xs text-slate uppercase tracking-wide mb-2">
            From
          </h2>
          <p className="font-medium text-ink">{inv.businesses?.name ?? "—"}</p>
          <Line label="Address" value={inv.businesses?.address} />
          <Line label="GSTIN" value={inv.businesses?.gstin} />
          <Line label="PAN" value={inv.businesses?.pan} />
          <Line label="Phone" value={inv.businesses?.phone} />
          <Line label="Email" value={inv.businesses?.email} />
        </section>
      </div>

      <div className="border-t border-b border-ledger-line py-4 mb-6">
        <div className="flex justify-between gap-4">
          <div>
            <p className="text-ink">{inv.description}</p>
            {inv.sac_code && (
              <p className="text-xs text-slate font-mono mt-1">
                SAC {inv.sac_code}
              </p>
            )}
          </div>
          <p className="font-mono tabular text-ink shrink-0">
            {formatRupees(taxable, 2)}
          </p>
        </div>
      </div>

      <dl className="ml-auto max-w-xs space-y-2 mb-8">
        <div className="flex justify-between text-sm">
          <dt className="text-slate">Amount before GST</dt>
          <dd className="font-mono tabular">{formatRupees(taxable, 2)}</dd>
        </div>
        {cgst > 0 && (
          <div className="flex justify-between text-sm">
            <dt className="text-slate">CGST @ {Number(inv.cgst_rate)}%</dt>
            <dd className="font-mono tabular">{formatRupees(cgst, 2)}</dd>
          </div>
        )}
        {sgst > 0 && (
          <div className="flex justify-between text-sm">
            <dt className="text-slate">SGST @ {Number(inv.sgst_rate)}%</dt>
            <dd className="font-mono tabular">{formatRupees(sgst, 2)}</dd>
          </div>
        )}
        {igst > 0 && (
          <div className="flex justify-between text-sm">
            <dt className="text-slate">IGST @ {Number(inv.igst_rate)}%</dt>
            <dd className="font-mono tabular">{formatRupees(igst, 2)}</dd>
          </div>
        )}
        <div className="flex justify-between border-t border-ledger-line pt-2">
          <dt className="font-medium text-ink">Total</dt>
          <dd className="font-mono tabular font-medium text-ink">
            {formatRupees(Number(inv.total_value), 2)}
          </dd>
        </div>
      </dl>

      <div className="mb-8 space-y-1">
        <Line label="Place of supply" value={inv.place_of_supply} />
        <Line label="Bank" value={inv.businesses?.bank_name} />
        <Line label="Account number" value={inv.businesses?.account_number} />
        <Line label="IFSC" value={inv.businesses?.ifsc} />
      </div>

      <div className="print:hidden flex flex-wrap items-start gap-3">
        {canMarkPaid && <MarkPaidButton invoiceId={inv.id} />}
        <PrintButton />
      </div>
    </div>
  );
}
