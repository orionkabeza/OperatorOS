import { NextRequest, NextResponse } from "next/server";
import { createBroadcastMessage, listSegments } from "@/lib/services/broadcasts";

export async function GET() {
  const segments = await listSegments();
  return NextResponse.json({ segments });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (typeof body.segmentId !== "string" || typeof body.body !== "string") {
    return NextResponse.json({ error: "segmentId and body are required" }, { status: 400 });
  }
  const message = await createBroadcastMessage(body.segmentId, body.body);
  return NextResponse.json({ message });
}
