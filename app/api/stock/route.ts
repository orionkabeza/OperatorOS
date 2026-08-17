import { NextResponse } from "next/server";
import { listStock } from "@/lib/services/stock";

export async function GET() {
  const stock = await listStock();
  return NextResponse.json({ stock });
}
