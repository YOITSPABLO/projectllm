import { NextResponse } from "next/server";
import { z } from "zod";
import { db, cuid, nowIso } from "@/lib/db";
import { getAgentByApiKey } from "@/lib/auth";
import { redact } from "@/lib/redact";
import { ensureRateLimit } from "@/lib/ratelimit";
import { emitEvent } from "@/lib/events";
import { ReasoningSchema } from "@/lib/reasoning";

const Body = z.object({
  amount: z.number().int().min(1).max(100000000),
  note: z.string().max(160).optional(),
  logic: ReasoningSchema,
});

export async function POST(req: Request) {
  const apiKey = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const agent = getAgentByApiKey(apiKey);
  if (!agent) return NextResponse.json({ success: false, error: "invalid_api_key" }, { status: 401 });

  // 20 transfers / minute
  const rl = ensureRateLimit(agent.id, "cashout", 60, 20);
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

  const fromBal = db.prepare("SELECT amount FROM balances WHERE agent_id=?").get(agent.id) as any;
  const casinoBal = fromBal?.amount ?? 0;
  if (casinoBal < parsed.data.amount) {
    return NextResponse.json({ success: false, error: "insufficient_funds", casino_balance: casinoBal }, { status: 400 });
  }

  const ts = nowIso();
  const id = cuid();
  const note = parsed.data.note ? redact(parsed.data.note).text : null;

  const tx = db.transaction(() => {
    // ensure bank row exists
    db.prepare(
      "INSERT INTO bank_balances(agent_id,amount,updated_at) VALUES(?,?,?) ON CONFLICT(agent_id) DO NOTHING"
    ).run(agent.id, 0, ts);

    db.prepare("UPDATE balances SET amount=amount-?, updated_at=? WHERE agent_id=?").run(parsed.data.amount, ts, agent.id);
    db.prepare("UPDATE bank_balances SET amount=amount+?, updated_at=? WHERE agent_id=?").run(parsed.data.amount, ts, agent.id);
    db.prepare("INSERT INTO transfers (id,agent_id,direction,amount,note,created_at) VALUES (?,?,?,?,?,?)").run(
      id,
      agent.id,
      "cashout",
      parsed.data.amount,
      note,
      ts
    );
  });
  tx();

  const newCasino = db.prepare("SELECT amount FROM balances WHERE agent_id=?").get(agent.id) as any;
  const newBank = db.prepare("SELECT amount FROM bank_balances WHERE agent_id=?").get(agent.id) as any;

  emitEvent({
    agentId: agent.id,
    type: "cashout",
    payload: {
      amount: parsed.data.amount,
      note,
      logic: parsed.data.logic ?? null,
      casino_balance: newCasino?.amount ?? null,
      bank_balance: newBank?.amount ?? null,
    },
    visibility: "public",
  });

  return NextResponse.json({ success: true });
}
