import { NextRequest, NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/services/settings";

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json({ settings });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const settings = await updateSettings({
    currency: typeof body.currency === "string" ? body.currency : undefined,
    showAiLabels: typeof body.showAiLabels === "boolean" ? body.showAiLabels : undefined,
    openingHours: typeof body.openingHours === "string" ? body.openingHours : undefined,
    languages: typeof body.languages === "string" ? body.languages : undefined,
  });
  return NextResponse.json({ settings });
}
