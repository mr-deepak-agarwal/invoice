"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();

  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);

    try {
      // Created here (not during render) so the page can be prerendered at
      // build time even before env vars are configured.
      const supabase = createClient();

      if (mode === "sign-up") {
        // The business row is created by a database trigger
        // (see supabase/schema.sql), which reads business_name from here.
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { business_name: businessName || "My Business" } },
        });
        if (signUpError) {
          setError(signUpError.message);
          return;
        }
        // No session means Supabase wants the email confirmed first.
        if (!data.session) {
          setNotice(
            "Account created. Check your email and click the confirmation link, then sign in."
          );
          setMode("sign-in");
          return;
        }
        router.push("/dashboard");
        router.refresh();
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) {
        setError(signInError.message);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full border-2 border-bahi-red text-bahi-red font-display text-xl mb-4">
            B
          </div>
          <h1 className="font-display text-3xl text-ink">Bahi</h1>
          <p className="text-slate text-sm mt-1">
            Invoices, kept the way your ledger always has.
          </p>
        </div>

        <div className="bg-paper-raised border border-ledger-line rounded-card p-6">
          <div className="flex mb-6 border-b border-ledger-line">
            <button
              onClick={() => setMode("sign-in")}
              className={`flex-1 pb-3 text-sm font-medium transition-colors ${
                mode === "sign-in"
                  ? "text-bahi-red border-b-2 border-bahi-red -mb-px"
                  : "text-slate"
              }`}
            >
              Sign in
            </button>
            <button
              onClick={() => setMode("sign-up")}
              className={`flex-1 pb-3 text-sm font-medium transition-colors ${
                mode === "sign-up"
                  ? "text-bahi-red border-b-2 border-bahi-red -mb-px"
                  : "text-slate"
              }`}
            >
              Create account
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "sign-up" && (
              <div>
                <label className="block text-xs text-slate mb-1.5">
                  Business name
                </label>
                <input
                  type="text"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="Deepak Traders"
                  className="w-full px-3 py-2 bg-white border border-ledger-line rounded-card text-sm focus:border-bahi-red outline-none"
                  required
                />
              </div>
            )}
            <div>
              <label className="block text-xs text-slate mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@business.com"
                className="w-full px-3 py-2 bg-white border border-ledger-line rounded-card text-sm focus:border-bahi-red outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-slate mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3 py-2 bg-white border border-ledger-line rounded-card text-sm focus:border-bahi-red outline-none"
                required
                minLength={6}
              />
            </div>

            {error && (
              <p className="text-sm text-bahi-red-dark bg-bahi-red/10 rounded-card px-3 py-2">
                {error}
              </p>
            )}
            {notice && (
              <p className="text-sm text-ink bg-marigold-soft rounded-card px-3 py-2">
                {notice}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-bahi-red text-white rounded-card py-2.5 text-sm font-medium hover:bg-bahi-red-dark transition-colors disabled:opacity-60"
            >
              {loading
                ? "Please wait…"
                : mode === "sign-in"
                ? "Sign in"
                : "Create account"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
