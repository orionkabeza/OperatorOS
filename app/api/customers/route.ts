import { NextResponse } from "next/server";
import { listCustomers } from "@/lib/services/customers";

export async function GET() {
  const customers = await listCustomers();
  return NextResponse.json({ customers });
}
