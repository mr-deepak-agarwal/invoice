"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface LinkInfo {
  code: string;
  deep_link: string | null;
}

export function ConnectTelegram({ connectedChats }: { connectedChats: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<LinkInfo | null>(null);

  async function getLink() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/telegram/link-code", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not get a code.");
      setLink({ code: body.code, deep_link: body.deep_link });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm("Disconnect Telegram from this account?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/telegram/disconnect", { method: "POST" });
      if (!res.ok) throw new Error("Could not disconnect.");
      setLink(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded border border-ink/15 bg-paper p-5">
      <p className="text-sm text-ink mb-4">
        {connectedChats > 0
          ? `Connected (${connectedChats} chat${connectedChats > 1 ? "s" : ""}).`
          : "Not connected yet."}
      </p>

      <div className="flex flex-wrap gap-3">
        <button
          onClick={getLink}
          disabled={busy}
          className="rounded bg-bahi-red px-4 py-2 text-sm text-white disabled:opacity-60"
        >
          {busy ? "Please wait…" : connectedChats > 0 ? "Connect another chat" : "Get connection link"}
        </button>
        {connectedChats > 0 && (
          <button
            onClick={disconnect}
            disabled={busy}
            className="rounded border border-ink/30 px-4 py-2 text-sm text-ink disabled:opacity-60"
          >
            Disconnect
          </button>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-bahi-red">{error}</p>}

      {link && (
        <div className="mt-5 text-sm text-ink space-y-2">
          {link.deep_link ? (
            <p>
              <a
                href={link.deep_link}
                target="_blank"
                rel="noreferrer"
                className="underline text-bahi-red"
              >
                Open Telegram to finish connecting
              </a>{" "}
              and tap Start.
            </p>
          ) : (
            <p>TELEGRAM_BOT_USERNAME isn&apos;t set, so use the code below.</p>
          )}
          <p>
            Or open your bot and send:{" "}
            <code className="font-mono bg-ink/5 px-1.5 py-0.5 rounded">
              /link {link.code}
            </code>
          </p>
          <p className="text-slate">Valid for 15 minutes, works once.</p>
        </div>
      )}
    </div>
  );
}
