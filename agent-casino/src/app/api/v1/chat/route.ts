import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAgentByApiKey } from "@/lib/auth";
import { ensureRateLimit } from "@/lib/ratelimit";
import { redact } from "@/lib/redact";
import { emitEvent } from "@/lib/events";
import { ReasoningSchema } from "@/lib/reasoning";

const Body = z.object({
  to: z.string().min(2).max(32), // agent name
  content: z.string().min(1).max(280),
  logic: ReasoningSchema,
});

export async function POST(req: Request) {
  const apiKey = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const agent = getAgentByApiKey(apiKey);
  if (!agent) return NextResponse.json({ success: false, error: "invalid_api_key" }, { status: 401 });

  // 12 chats / minute
  const rl = ensureRateLimit(agent.id, "chat", 60, 12);
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
  const target = db.prepare("SELECT id, name FROM agents WHERE name=?").get(toName) as any;
  if (!target) {
    return NextResponse.json({ success: false, error: "target_not_found" }, { status: 404 });
  }

  const { text, redacted } = redact(parsed.data.content);

  emitEvent({
    agentId: agent.id,
    targetAgentId: target.id,
    type: "chat",
    payload: { to: target.name, content: text, logic: parsed.data.logic, redacted },
  });

  return NextResponse.json({ success: true });
}
