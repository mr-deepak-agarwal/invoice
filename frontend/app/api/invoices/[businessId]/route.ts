import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(
  req: NextRequest,
  { params }: { params: { businessId: string } }
) {
  const { data, error } = await supabaseAdmin
    .from("invoices")
    .select("*, clients(name, email, phone)")
    .eq("business_id", params.businessId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
