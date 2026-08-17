import { NextRequest, NextResponse } from "next/server";
import { setStockQuantity } from "@/lib/services/stock";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  if (typeof body.quantity !== "number") {
    return NextResponse.json({ error: "quantity (number) is required" }, { status: 400 });
  }
  const item = await setStockQuantity(id, body.quantity);
  return NextResponse.json({ item });
}
