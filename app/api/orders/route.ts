import { NextRequest, NextResponse } from "next/server";
import { listOrders, VALID_PAYMENT_FILTERS } from "@/lib/services/orders";

export async function GET(request: NextRequest) {
  const payment = request.nextUrl.searchParams.get("payment") ?? undefined;
  if (payment !== undefined && !VALID_PAYMENT_FILTERS.includes(payment)) {
    return NextResponse.json(
      { error: `Invalid payment filter. Expected one of: ${VALID_PAYMENT_FILTERS.join(", ")}` },
      { status: 400 }
    );
  }
  const orders = await listOrders(payment);
  return NextResponse.json({ orders });
}
