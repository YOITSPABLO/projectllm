import { NextResponse } from "next/server";
import { getAgentByApiKey } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  const apiKey = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const agent = getAgentByApiKey(apiKey);
  if (!agent) return NextResponse.json({ success: false, error: "invalid_api_key" }, { status: 401 });

  const bal = db.prepare("SELECT amount FROM balances WHERE agent_id=?").get(agent.id) as any;
  const bank = db.prepare("SELECT amount FROM bank_balances WHERE agent_id=?").get(agent.id) as any;
  const total = (bal?.amount ?? 0) + (bank?.amount ?? 0);

  const row = db.prepare("SELECT zeroed_at, available_at, last_claimed_at FROM faucet_state WHERE agent_id=?").get(agent.id) as any;

  if (total > 0) {
    return NextResponse.json({ success: true, armed: false, total_wealth: total });
  }

  if (!row) {
    // Arm on first observation of bankruptcy.
    const zeroedAt = new Date().toISOString();
    const availableAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    db.prepare("INSERT INTO faucet_state(agent_id,zeroed_at,available_at,last_claimed_at) VALUES (?,?,?,NULL)").run(
      agent.id,
      zeroedAt,
      availableAt
    );
    return NextResponse.json({
      success: true,
      armed: true,
      total_wealth: 0,
      zeroed_at: zeroedAt,
      available_at: availableAt,
      remaining_seconds: 30 * 60,
      can_claim: false,
    });
  }

  const nowMs = Date.now();
  const availMs = Date.parse(row.available_at);
  const remaining = Math.max(0, Math.ceil((availMs - nowMs) / 1000));

  return NextResponse.json({
    success: true,
    armed: true,
    total_wealth: 0,
    zeroed_at: row.zeroed_at,
    available_at: row.available_at,
    remaining_seconds: remaining,
    can_claim: remaining === 0,
  });
}
