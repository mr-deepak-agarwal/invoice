import { redirect } from "next/navigation";
import { getSessionBusiness } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { ConnectTelegram } from "./ConnectTelegram";

export const dynamic = "force-dynamic";

export default async function TelegramPage() {
  const session = await getSessionBusiness();
  if (!session) redirect("/login");

  const { data } = await getSupabaseAdmin()
    .from("identities")
    .select("channel_identifier")
    .eq("business_id", session.businessId)
    .eq("channel", "telegram");

  const botConfigured = Boolean(process.env.TELEGRAM_BOT_TOKEN);

  return (
    <div className="max-w-2xl">
      <header className="mb-8">
        <h1 className="font-display text-2xl text-ink mb-1">Telegram</h1>
        <p className="text-sm text-slate">
          Create invoices by sending a message to your bot.
        </p>
      </header>

      {!botConfigured && (
        <div className="mb-6 rounded border border-marigold/60 bg-marigold/10 p-4 text-sm text-ink">
          The Telegram bot isn&apos;t set up on the server yet. Add
          TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and
          TELEGRAM_BOT_USERNAME in Vercel and register the webhook (see the
          README), then come back here.
        </div>
      )}

      <ConnectTelegram connectedChats={data?.length ?? 0} />

      <section className="mt-10 text-sm text-slate">
        <h2 className="font-display text-lg text-ink mb-2">How it works</h2>
        <ol className="list-decimal pl-5 space-y-1">
          <li>Connect your chat using the button above (one time).</li>
          <li>
            Send a message such as: <em>make invoice for Marc, panjim goa,
            25000, web development, due 1 nov 2026, email accounts@marc.com</em>
          </li>
          <li>The bot shows a summary. Tap Create invoice to confirm.</li>
          <li>The invoice appears in your dashboard straight away.</li>
        </ol>
      </section>
    </div>
  );
}
