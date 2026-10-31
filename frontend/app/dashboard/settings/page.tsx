import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SettingsForm, type BusinessProfile } from "./SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: business } = await supabase
    .from("businesses")
    .select(
      "id, name, address, state_code, gstin, pan, phone, email, bank_name, account_number, ifsc, invoice_prefix, default_sac_code, gst_registered, upi_id, default_due_days, assume_local_supply"
    )
    .eq("owner_auth_id", user.id)
    .single();

  if (!business) {
    return (
      <p className="text-sm text-slate">
        We couldn&apos;t find your business. Try signing out and in again.
      </p>
    );
  }

  return (
    <div className="max-w-xl">
      <header className="mb-8">
        <h1 className="font-display text-2xl text-ink mb-1">Settings</h1>
        <p className="text-sm text-slate">
          Your business details appear on every invoice. Your state decides
          whether an invoice carries CGST+SGST or IGST.
        </p>
      </header>
      <SettingsForm business={business as BusinessProfile} />
    </div>
  );
}
