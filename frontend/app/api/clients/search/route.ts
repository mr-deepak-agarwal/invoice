import { NextRequest, NextResponse } from "next/server";
import { getSessionBusiness, unauthorized } from "@/lib/auth";
import { searchClients } from "@/lib/db";

/** Autocomplete over the signed-in user's own clients. The business comes
 * from the session cookie — nothing about it is accepted from the URL. */
export async function GET(req: NextRequest) {
  const session = await getSessionBusiness();
  if (!session) return unauthorized();

  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 100);
  return NextResponse.json(await searchClients(session.businessId, q));
}
