import { NextRequest, NextResponse } from "next/server";
import { resolveBusinessId } from "@/lib/db";

export async function GET(req: NextRequest) {
  const channel = req.nextUrl.searchParams.get("channel");
  const channelIdentifier = req.nextUrl.searchParams.get("channel_identifier");

  if (!channel || !channelIdentifier) {
    return NextResponse.json(
      { error: "channel and channel_identifier are required" },
      { status: 400 }
    );
  }

  const businessId = await resolveBusinessId(channel, channelIdentifier);
  if (!businessId) {
    return NextResponse.json({
      business_id: null,
      message: "No linked business found",
    });
  }
  return NextResponse.json({ business_id: businessId });
}
