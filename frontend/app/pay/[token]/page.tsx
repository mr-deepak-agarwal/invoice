import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isValidPublicToken, toPublicInvoice } from "@/lib/publicInvoice";
import { buildUpiUri } from "@/lib/upi";
import { qrSvg } from "@/lib/upiQr";
import { formatDate, formatRupees } from "@/lib/format";

// Public page: anyone holding the link can open it. The link is a 64-hex
// random token; the page shows only the whitelisted fields from
// toPublicInvoice() — never the client's contact details.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Invoice payment",
  robots: { index: false, follow: false },
};

export default async function PayPage({ params }: { params: { token: string } }) {
  if (!isValidPublicToken(params.token)) notFound();

  const { data } = await getSupabaseAdmin()
    .from("invoices")
    .select(
      "invoice_number, description, total_value, due_date, status, businesses(name, upi_id)"
    )
    .eq("public_token", params.token)
    .maybeSingle();
  if (!data) notFound();

  const inv = toPublicInvoice(data as never);

  let uri: string | null = null;
  let qr: string | null = null;
  if (inv.canPay && inv.upiId) {
    uri = buildUpiUri({
      vpa: inv.upiId,
      payeeName: inv.businessName,
      amount: inv.total,
      note: `Invoice ${inv.invoiceNumber}`,
      reference: inv.invoiceNumber,
    });
    qr = await qrSvg(uri);
  }

  return (
    <main className="min-h-screen bg-paper flex items-start justify-center px-4 py-10">
      <div className="w-full max-w-md bg-paper-raised border border-ledger-line rounded-card p-6">
        <p className="text-xs text-slate uppercase tracking-wide mb-1">
          Invoice from
        </p>
        <h1 className="font-display text-2xl text-ink mb-4">{inv.businessName}</h1>

        <dl className="text-sm space-y-1 mb-5">
          <div className="flex justify-between">
            <dt className="text-slate">Invoice</dt>
            <dd className="font-mono">{inv.invoiceNumber}</dd>
          </div>
          {inv.description && (
            <div className="flex justify-between gap-4">
              <dt className="text-slate">For</dt>
              <dd className="text-right">{inv.description}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-slate">Due</dt>
            <dd>{formatDate(inv.dueDate)}</dd>
          </div>
        </dl>

        <p className="text-3xl font-mono tabular text-ink mb-5">
          {formatRupees(inv.total, 2)}
        </p>

        {inv.status === "paid" && (
          <p className="text-sm bg-marigold-soft rounded-card px-3 py-2">
            This invoice is marked as paid. Thank you!
          </p>
        )}
        {inv.status === "cancelled" && (
          <p className="text-sm bg-marigold-soft rounded-card px-3 py-2">
            This invoice has been cancelled. Please contact {inv.businessName}.
          </p>
        )}

        {inv.canPay && uri && qr && (
          <>
            <a
              href={uri}
              className="block text-center bg-bahi-red text-white rounded-card px-5 py-3 text-sm font-medium hover:bg-bahi-red-dark transition-colors"
            >
              Pay with a UPI app
            </a>
            <p className="text-xs text-slate text-center mt-2 mb-4">
              On a computer, scan this with any UPI app.
            </p>
            <div
              className="mx-auto w-44 h-44 bg-white p-2 border border-ledger-line rounded-card"
              dangerouslySetInnerHTML={{ __html: qr }}
            />
            <p className="text-xs text-slate text-center mt-3 font-mono break-all">
              {inv.upiId}
            </p>
            <p className="text-xs text-slate text-center mt-3">
              After paying, let {inv.businessName} know so they can mark it
              received.
            </p>
          </>
        )}

        {!inv.canPay && inv.status !== "paid" && inv.status !== "cancelled" && (
          <p className="text-sm text-slate">
            Online payment isn&apos;t set up for this invoice. Please contact{" "}
            {inv.businessName} to pay.
          </p>
        )}
      </div>
    </main>
  );
}
