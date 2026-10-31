import { getSupabaseAdmin } from "./supabaseAdmin";

/**
 * Fixed-window rate limit backed by the Postgres function
 * check_rate_limit() (see supabase/schema.sql). Used to cap how often one
 * business can trigger paid work (Gemini calls) — signup is open, so
 * without this a single account could burn the whole API quota.
 *
 * Fails OPEN: if the limiter itself errors we log it and let the request
 * through, because a broken limiter shouldn't take invoicing down.
 */
export async function allow(
  key: string,
  max: number,
  windowSeconds: number
): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin().rpc("check_rate_limit", {
    p_key: key,
    p_max: max,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error("Rate limiter error (allowing request)", error.message);
    return true;
  }
  return data === true;
}

export const LIMITS = {
  /** Gemini-backed parsing: web form and Telegram share one bucket. */
  parse: { max: 40, windowSeconds: 3600 },
  create: { max: 200, windowSeconds: 3600 },
} as const;
