import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export interface SessionBusiness {
  userId: string;
  businessId: string;
  businessName: string;
}

/**
 * Who is calling this API route? Reads the Supabase login cookie and
 * finds that user's business. Returns null when not signed in.
 *
 * API routes use the service-role key (which bypasses database
 * security), so every route a browser can reach MUST call this and use
 * the business id it returns — never a business id sent by the client.
 */
export async function getSessionBusiness(): Promise<SessionBusiness | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: business } = await supabase
    .from("businesses")
    .select("id, name")
    .eq("owner_auth_id", user.id)
    .maybeSingle();
  if (!business) return null;

  return {
    userId: user.id,
    businessId: business.id as string,
    businessName: business.name as string,
  };
}

export function unauthorized() {
  return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
}
