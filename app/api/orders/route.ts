import { NextRequest, NextResponse } from "next/server";
import { listOrders } from "@/lib/services/orders";

export async function GET(request: NextRequest) {
  const payment = request.nextUrl.searchParams.get("payment") ?? undefined;
  const orders = await listOrders(payment);
  return NextResponse.json({ orders });
}
