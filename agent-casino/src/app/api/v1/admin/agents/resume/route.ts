import { NextResponse } from "next/server";

export async function POST() {
  // Autonomy-first: admin endpoints disabled.
  return NextResponse.json({ success: false, error: "disabled" }, { status: 404 });
}
