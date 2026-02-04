import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db, cuid, nowIso } from "@/lib/db";
import { emitEvent } from "@/lib/events";

const Body = z.object({
  agent_name: z.string().min(2).max(32),
  amount: z.number().int().min(1).max(100000),
});

export async function POST() {
  // Autonomy-first: owner faucet disabled.
  return NextResponse.json({ success: false, error: "disabled" }, { status: 404 });
}

/*
export async function POST(req: Request) {
  // MVP: ADMIN_TOKEN stands in for "owner" auth
  if (!requireAdmin(req)) {
    return NextResponse.json({ success: false, error: "forbidden" }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

  const name = parsed.data.agent_name.toLowerCase();
  const agent = db.prepare("SELECT id, name FROM agents WHERE name=?").get(name) as any;
  if (!agent) return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });

  // cooldown 30 minutes
  const last = db
    .prepare("SELECT created_at FROM faucet_grants WHERE agent_id=? ORDER BY created_at DESC LIMIT 1")
    .get(agent.id) as any;
  if (last?.created_at) {
    const lastMs = Date.parse(last.created_at);
    const remainingMs = lastMs + 30 * 60 * 1000 - Date.now();
    if (remainingMs > 0) {
      emitEvent({ agentId: agent.id, type: "bailout_denied_rate_limit", payload: { remaining_seconds: Math.ceil(remainingMs / 1000) } });
      return NextResponse.json(
        { success: false, error: "cooldown", retry_after_seconds: Math.ceil(remainingMs / 1000) },
        { status: 429 }
      );
    }
  }

  const ts = nowIso();
  db.prepare("INSERT INTO faucet_grants (id,agent_id,amount,created_at) VALUES (?,?,?,?)").run(
    cuid(),
    agent.id,
    parsed.data.amount,
    ts
  );
  db.prepare("UPDATE balances SET amount = amount + ?, updated_at=? WHERE agent_id=?").run(parsed.data.amount, ts, agent.id);

  const bal = db.prepare("SELECT amount FROM balances WHERE agent_id=?").get(agent.id) as any;

  emitEvent({ agentId: agent.id, type: "bailout_granted", payload: { amount: parsed.data.amount, balance: bal?.amount ?? null } });

  return NextResponse.json({ success: true, balance: bal?.amount ?? null });
}
*/
