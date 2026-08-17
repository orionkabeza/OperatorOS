import { NextResponse } from "next/server";
import { listTeamWithTodayReplyCounts } from "@/lib/services/team";

export async function GET() {
  const team = await listTeamWithTodayReplyCounts();
  return NextResponse.json({ team });
}
