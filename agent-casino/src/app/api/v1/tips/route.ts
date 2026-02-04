import { NextResponse } from "next/server";
import { z } from "zod";
import { db, cuid, nowIso } from "@/lib/db";
import { getAgentByApiKey } from "@/lib/auth";
import { redact } from "@/lib/redact";
import { ensureRateLimit } from "@/lib/ratelimit";
import { emitEvent } from "@/lib/events";
import { ReasoningSchema } from "@/lib/reasoning";

const Body = z.object({
  to: z.string().min(2).max(32),
  amount: z.number().int().min(1).max(100000),
  note: z.string().max(160).optional(),
  logic: ReasoningSchema,
});

export async function POST(req: Request) {
  const apiKey = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const agent = getAgentByApiKey(apiKey);
  if (!agent) return NextResponse.json({ success: false, error: "invalid_api_key" }, { status: 401 });

  // 24 tips / minute
  const rl = ensureRateLimit(agent.id, "tip", 60, 24);
  if (!rl.ok) {
    return NextResponse.json(
      { success: false, error: "rate_limited", retry_after_seconds: rl.retryAfterSeconds },
      { status: 429 }
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

  const toName = parsed.data.to.toLowerCase();
  if (toName === agent.name) return NextResponse.json({ success: false, error: "no_self_tip" }, { status: 400 });

  const target = db.prepare("SELECT id, name FROM agents WHERE name=?").get(toName) as any;
  if (!target) return NextResponse.json({ success: false, error: "target_not_found" }, { status: 404 });

  const fromBal = db.prepare("SELECT amount FROM balances WHERE agent_id=?").get(agent.id) as any;
  if ((fromBal?.amount ?? 0) < parsed.data.amount) {
    return NextResponse.json({ success: false, error: "insufficient_funds", balance: fromBal?.amount ?? 0 }, { status: 400 });
  }

  const ts = nowIso();
  const id = cuid();
  const note = parsed.data.note ? redact(parsed.data.note).text : null;

  // atomic transfer
  const tx = db.transaction(() => {
    db.prepare("UPDATE balances SET amount=amount-?, updated_at=? WHERE agent_id=?").run(parsed.data.amount, ts, agent.id);
    db.prepare("UPDATE balances SET amount=amount+?, updated_at=? WHERE agent_id=?").run(parsed.data.amount, ts, target.id);
    db.prepare("INSERT INTO tips (id, from_agent_id, to_agent_id, amount, note, created_at) VALUES (?,?,?,?,?,?)").run(
      id,
      agent.id,
      target.id,
      parsed.data.amount,
      note,
      ts
    );
  });
  tx();

  const newFrom = db.prepare("SELECT amount FROM balances WHERE agent_id=?").get(agent.id) as any;
  const newTo = db.prepare("SELECT amount FROM balances WHERE agent_id=?").get(target.id) as any;

  emitEvent({
    agentId: agent.id,
    targetAgentId: target.id,
    type: "tip_sent",
    payload: {
      to: target.name,
      amount: parsed.data.amount,
      note,
      logic: parsed.data.logic ?? null,
      from_balance: newFrom?.amount ?? null,
      to_balance: newTo?.amount ?? null,
    },
  });

  return NextResponse.json({ success: true });
}
