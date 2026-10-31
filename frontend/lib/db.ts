import { getSupabaseAdmin } from "./supabaseAdmin";

export interface ClientRecord {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  gstin: string | null;
  state_code: string | null;
}

const CLIENT_COLUMNS = "id, name, email, phone, address, gstin, state_code";

/** Escape % and _ so user text is matched literally inside ilike. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

/** Look up which business a Telegram chat_id / WhatsApp number / web
 * auth_id belongs to. Returns null if not yet linked (new user).
 * Server-side only — there is deliberately no public HTTP route for this. */
export async function resolveBusinessId(
  channel: string,
  channelIdentifier: string
): Promise<string | null> {
  const { data } = await getSupabaseAdmin()
    .from("identities")
    .select("business_id")
    .eq("channel", channel)
    .eq("channel_identifier", channelIdentifier)
    .maybeSingle();
  return data?.business_id ?? null;
}

/** Prefix/substring search over a business's saved clients — powers the
 * autocomplete dropdown in the "new invoice" textbox. */
export async function searchClients(
  businessId: string,
  query: string,
  limit = 5
): Promise<ClientRecord[]> {
  if (!query.trim()) return [];
  const { data } = await getSupabaseAdmin()
    .from("clients")
    .select(CLIENT_COLUMNS)
    .eq("business_id", businessId)
    .ilike("name", `%${escapeLike(query.trim())}%`)
    .limit(limit);
  return data ?? [];
}

/** Case-insensitive exact match, used right after parsing to auto-fill
 * email/phone/address/state from a previously saved client so the person
 * doesn't have to retype them the second time they bill someone. */
export async function findClientByExactName(
  businessId: string,
  name: string
): Promise<ClientRecord | null> {
  const { data } = await getSupabaseAdmin()
    .from("clients")
    .select(CLIENT_COLUMNS)
    .eq("business_id", businessId)
    .ilike("name", escapeLike(name.trim()))
    .limit(1);
  return data?.[0] ?? null;
}

export interface TaxProfile {
  gst_registered: boolean;
  state_code: string | null;
  /** null = always ask; 0 = due on receipt; N = N days. */
  default_due_days: number | null;
  /** true = assume the client is in the business's own state. */
  assume_local_supply: boolean;
}

/** Whether the business charges GST, and from which state. */
export async function getTaxProfile(
  businessId: string
): Promise<TaxProfile | null> {
  const { data } = await getSupabaseAdmin()
    .from("businesses")
    .select("gst_registered, state_code, default_due_days, assume_local_supply")
    .eq("id", businessId)
    .maybeSingle();
  if (!data) return null;
  return {
    gst_registered: data.gst_registered !== false,
    state_code: data.state_code ?? null,
    default_due_days: data.default_due_days ?? null,
    assume_local_supply: data.assume_local_supply === true,
  };
}
