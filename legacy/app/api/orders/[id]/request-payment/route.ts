import { NextRequest, NextResponse } from "next/server";
import { initiateMomoPayment } from "@/lib/services/payments";

type Params = { params: Promise<{ id: string }> };

/** Sends an MTN MoMo "request to pay" prompt to the order's customer. */
export async function POST(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const { referenceId } = await initiateMomoPayment(id);
    return NextResponse.json({ referenceId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to request payment";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
