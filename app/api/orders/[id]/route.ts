import { NextRequest, NextResponse } from "next/server";
import { confirmOrderPaymentManually, getOrderDTO, markOrderDelivered } from "@/lib/services/orders";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const order = await getOrderDTO(id);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  return NextResponse.json({ order });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const action = body.action as string | undefined;

  if (action === "mark-delivered") {
    const order = await markOrderDelivered(id);
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    return NextResponse.json({ order });
  }

  if (action === "confirm-payment") {
    const order = await confirmOrderPaymentManually(id);
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    return NextResponse.json({ order });
  }

  return NextResponse.json({ error: "Unknown action. Use 'mark-delivered' or 'confirm-payment'." }, { status: 400 });
}
