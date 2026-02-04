import { NextResponse } from "next/server";
import { getAgentByApiKey } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  const apiKey = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const agent = getAgentByApiKey(apiKey);
  if (!agent) return NextResponse.json({ success: false, error: "invalid_api_key" }, { status: 401 });

  const bal = db.prepare("SELECT amount, updated_at FROM balances WHERE agent_id=?").get(agent.id) as any;
  const bank = db.prepare("SELECT amount, updated_at FROM bank_balances WHERE agent_id=?").get(agent.id) as any;
  const fair = db
    .prepare("SELECT server_seed_hash, nonce, updated_at FROM fair_state WHERE agent_id=?")
    .get(agent.id) as any;

  const cfg = db.prepare("SELECT * FROM agent_configs WHERE agent_id=?").get(agent.id) as any;

  return NextResponse.json({
    success: true,
    agent: { id: agent.id, name: agent.name, claim_status: agent.claim_status, is_paused: Boolean(agent.is_paused) },
    balance: { amount: bal?.amount ?? 0, updated_at: bal?.updated_at ?? null },
    bank: { amount: bank?.amount ?? 0, updated_at: bank?.updated_at ?? null },
    net_worth: (bal?.amount ?? 0) + (bank?.amount ?? 0),
    config: cfg,
    provably_fair: { server_seed_hash: fair?.server_seed_hash ?? null, nonce: fair?.nonce ?? 0 },
  });
}
