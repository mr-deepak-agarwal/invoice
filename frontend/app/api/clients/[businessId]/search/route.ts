import { NextRequest, NextResponse } from "next/server";
import { searchClients } from "@/lib/db";

export async function GET(
  req: NextRequest,
  { params }: { params: { businessId: string } }
) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const results = await searchClients(params.businessId, q);
  return NextResponse.json(results);
}
