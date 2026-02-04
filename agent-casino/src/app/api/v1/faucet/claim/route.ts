import { NextResponse } from "next/server";
import { z } from "zod";
import { getAgentByApiKey } from "@/lib/auth";
import { db, cuid, nowIso } from "@/lib/db";
import { emitEvent } from "@/lib/events";

const Body = z.object({
  confirm: z.literal(true),
});

export async function POST(req: Request) {
  const apiKey = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const agent = getAgentByApiKey(apiKey);
  if (!agent) return NextResponse.json({ success: false, error: "invalid_api_key" }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "confirm_required" }, { status: 400 });
  }

  const bal = db.prepare("SELECT amount FROM balances WHERE agent_id=?").get(agent.id) as any;
  const bank = db.prepare("SELECT amount FROM bank_balances WHERE agent_id=?").get(agent.id) as any;
  const total = (bal?.amount ?? 0) + (bank?.amount ?? 0);
  if (total > 0) {
    return NextResponse.json({ success: false, error: "not_broke", total_wealth: total }, { status: 400 });
  }

  const row = db.prepare("SELECT zeroed_at, available_at, last_claimed_at FROM faucet_state WHERE agent_id=?").get(agent.id) as any;
  if (!row) {
    return NextResponse.json({ success: false, error: "not_armed" }, { status: 400 });
  }

  const nowMs = Date.now();
  const availMs = Date.parse(row.available_at);
  const remaining = Math.max(0, Math.ceil((availMs - nowMs) / 1000));
  if (remaining > 0) {
    emitEvent({ agentId: agent.id, type: "bailout_denied_too_soon", payload: { remaining_seconds: remaining } });
    return NextResponse.json({ success: false, error: "too_soon", remaining_seconds: remaining }, { status: 429 });
  }

  // default faucet amount
  const amount = Number(process.env.FAUCET_AMOUNT ?? 1000);
  const ts = nowIso();

  const tx = db.transaction(() => {
    db.prepare("INSERT INTO faucet_grants (id,agent_id,amount,created_at) VALUES (?,?,?,?)").run(cuid(), agent.id, amount, ts);
    db.prepare("UPDATE balances SET amount = amount + ?, updated_at=? WHERE agent_id=?").run(amount, ts, agent.id);
    db.prepare("UPDATE faucet_state SET last_claimed_at=? WHERE agent_id=?").run(ts, agent.id);
  });
  tx();

  const newBal = db.prepare("SELECT amount FROM balances WHERE agent_id=?").get(agent.id) as any;

  emitEvent({ agentId: agent.id, type: "bailout_granted", payload: { amount, balance: newBal?.amount ?? null } });

  return NextResponse.json({ success: true, amount, balance: newBal?.amount ?? null });
}
