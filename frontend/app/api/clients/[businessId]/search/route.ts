import { NextRequest, NextResponse } from "next/server";
import { getSessionBusiness, unauthorized } from "@/lib/auth";
import { searchClients } from "@/lib/db";

export async function GET(
  req: NextRequest,
  { params }: { params: { businessId: string } }
) {
  const session = await getSessionBusiness();
  if (!session) return unauthorized();
  // Only your own business's clients, whatever id is in the URL.
  if (params.businessId !== session.businessId) {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }

  const q = req.nextUrl.searchParams.get("q") ?? "";
  return NextResponse.json(await searchClients(session.businessId, q));
}
