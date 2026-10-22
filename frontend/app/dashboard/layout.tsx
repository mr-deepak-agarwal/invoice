import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "./SignOutButton";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: business } = await supabase
    .from("businesses")
    .select("name")
    .eq("owner_auth_id", user.id)
    .single();

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 shrink-0 border-r border-ledger-line bg-paper-raised px-5 py-6 flex flex-col">
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full border-2 border-bahi-red text-bahi-red font-display text-xs">
              B
            </span>
            <span className="font-display text-lg text-ink">Bahi</span>
          </div>
          <p className="text-xs text-slate truncate pl-9">
            {business?.name ?? "Your business"}
          </p>
        </div>

        <nav className="flex-1 space-y-1">
          <Link
            href="/dashboard"
            className="block px-3 py-2 rounded-card text-sm text-ink hover:bg-ledger-line/40"
          >
            Overview
          </Link>
          <Link
            href="/dashboard/invoices"
            className="block px-3 py-2 rounded-card text-sm text-ink hover:bg-ledger-line/40"
          >
            Invoices
          </Link>
          <Link
            href="/dashboard/invoices/new"
            className="block px-3 py-2 rounded-card text-sm text-bahi-red font-medium hover:bg-bahi-red/5"
          >
            + New invoice
          </Link>
        </nav>

        <SignOutButton />
      </aside>

      <main className="flex-1 px-8 py-8 max-w-4xl">{children}</main>
    </div>
  );
}
