import { NextRequest, NextResponse } from "next/server";
import { getSettings } from "@/lib/services/settings";
import { getTodaySummary } from "@/lib/services/summary";

export async function GET(_request: NextRequest) {
  const settings = await getSettings();
  const summary = await getTodaySummary(settings.currency);
  return NextResponse.json({ summary });
}
