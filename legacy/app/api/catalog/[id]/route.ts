import { NextRequest, NextResponse } from "next/server";
import { setProductHidden } from "@/lib/services/catalog";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  if (typeof body.hidden !== "boolean") {
    return NextResponse.json({ error: "hidden (boolean) is required" }, { status: 400 });
  }
  const product = await setProductHidden(id, body.hidden);
  return NextResponse.json({ product });
}
