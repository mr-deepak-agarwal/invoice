import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * SERVICE ROLE client — bypasses Row Level Security. Used by the API
 * routes (Telegram/WhatsApp have no Supabase session).
 *
 * CRITICAL: only import this from files under app/api/ (or lib files
 * those routes use). Never import it from a "use client" component —
 * the service role key must never reach client-side JS.
 *
 * Created lazily on first use, NOT at import time. Next.js imports every
 * route module during `next build` to collect page data; creating the
 * client at module load would crash the build whenever env vars aren't
 * available yet ("supabaseUrl is required").
 */
let client: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
      );
    }
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}
