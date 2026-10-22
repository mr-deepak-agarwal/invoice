import { supabaseAdmin } from "./supabaseAdmin";

export interface ClientRecord {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
}

/** Look up which business a Telegram chat_id / WhatsApp number / web
 * auth_id belongs to. Returns null if not yet linked (new user). */
export async function resolveBusinessId(
  channel: string,
  channelIdentifier: string
): Promise<string | null> {
  const { data } = await supabaseAdmin
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
  const { data } = await supabaseAdmin
    .from("clients")
    .select("id, name, email, phone, address")
    .eq("business_id", businessId)
    .ilike("name", `%${query.trim()}%`)
    .limit(limit);
  return data ?? [];
}

/** Case-insensitive exact match, used right after parsing to auto-fill
 * email/phone/address from a previously saved client so the person
 * doesn't have to retype them the second time they bill someone. */
export async function findClientByExactName(
  businessId: string,
  name: string
): Promise<ClientRecord | null> {
  const { data } = await supabaseAdmin
    .from("clients")
    .select("id, name, email, phone, address")
    .eq("business_id", businessId)
    .ilike("name", name.trim())
    .limit(1);
  return data?.[0] ?? null;
}

/** Generates the next sequential invoice number for a business, e.g.
 * INV-2026-0001. Simple count-based approach; fine at small/medium
 * volume. Switch to a DB sequence per-tenant if you need strict
 * gap-free numbering for audit purposes. */
export async function nextInvoiceNumber(
  businessId: string,
  prefix = "INV"
): Promise<string> {
  const year = new Date().getFullYear();
  const { count } = await supabaseAdmin
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId);
  const n = (count ?? 0) + 1;
  return `${prefix}-${year}-${String(n).padStart(4, "0")}`;
}
