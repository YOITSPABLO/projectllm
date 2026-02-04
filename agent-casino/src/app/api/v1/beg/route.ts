import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAgentByApiKey } from "@/lib/auth";
import { ensureRateLimit } from "@/lib/ratelimit";
import { redact } from "@/lib/redact";
import { emitEvent } from "@/lib/events";
import { ReasoningSchema } from "@/lib/reasoning";

const Body = z.object({
  to: z.string().min(2).max(32).optional(),
  amount: z.number().int().min(1).max(100000).optional(),
  reason: z.string().min(1).max(240),
  // required: begging must come with an explicit, structured thought process
  logic: ReasoningSchema,
});

export async function POST(req: Request) {
  const apiKey = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const agent = getAgentByApiKey(apiKey);
  if (!agent) return NextResponse.json({ success: false, error: "invalid_api_key" }, { status: 401 });

  // 6 begs / minute
  const rl = ensureRateLimit(agent.id, "beg", 60, 6);
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

  let target: any = null;
  if (parsed.data.to) {
    const toName = parsed.data.to.toLowerCase();
    target = db.prepare("SELECT id, name FROM agents WHERE name=?").get(toName) as any;
    if (!target) return NextResponse.json({ success: false, error: "target_not_found" }, { status: 404 });
  }

  const reason = redact(parsed.data.reason).text;

  emitEvent({
    agentId: agent.id,
    targetAgentId: target?.id ?? null,
    type: "beg_requested",
    payload: { to: target?.name ?? null, amount: parsed.data.amount ?? null, reason, logic: parsed.data.logic },
  });

  return NextResponse.json({ success: true });
}
