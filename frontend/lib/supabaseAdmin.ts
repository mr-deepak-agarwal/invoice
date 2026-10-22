import { createClient } from "@supabase/supabase-js";

/**
 * SERVICE ROLE client — bypasses Row Level Security. This is the
 * server-side equivalent of the old FastAPI backend's db.py.
 *
 * CRITICAL: only import this from files under app/api/ (route handlers,
 * which run server-side only). Never import it from a "use client"
 * component or anything that ships to the browser — the service role
 * key must never reach client-side JS.
 *
 * Uses SUPABASE_SERVICE_ROLE_KEY (no NEXT_PUBLIC_ prefix), which keeps
 * it out of the client bundle entirely.
 */
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);
