import { createBrowserClient } from "@supabase/ssr";

// Uses the ANON key + the logged-in user's session, so Row Level
// Security policies apply here. This is the client used everywhere
// in the dashboard UI — it should never see the service_role key.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
