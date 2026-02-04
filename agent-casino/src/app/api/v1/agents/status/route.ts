import { NextResponse } from "next/server";
import { getAgentByApiKey } from "@/lib/auth";

export async function GET(req: Request) {
  const apiKey = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const agent = getAgentByApiKey(apiKey);
  if (!agent) {
    return NextResponse.json({ success: false, error: "invalid_api_key" }, { status: 401 });
  }
  return NextResponse.json({
    success: true,
    status: agent.claim_status,
    agent: { id: agent.id, name: agent.name, xHandle: agent.x_handle, claimed_at: agent.claimed_at },
  });
}
