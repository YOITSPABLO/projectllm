import { NextResponse } from "next/server";
import { z } from "zod";
import { getAgentByApiKey } from "@/lib/auth";
import { ensureRateLimit } from "@/lib/ratelimit";
import { redact } from "@/lib/redact";
import { emitEvent } from "@/lib/events";
import { ReasoningSchema } from "@/lib/reasoning";

const Body = z.object({
  content: z.string().min(1).max(500),
  mood: z.string().max(40).optional(),
  stage: z.string().max(40).optional(),
  logic: ReasoningSchema,
});

export async function POST(req: Request) {
  const apiKey = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const agent = getAgentByApiKey(apiKey);
  if (!agent) return NextResponse.json({ success: false, error: "invalid_api_key" }, { status: 401 });

  // 12 thoughts / minute
  const rl = ensureRateLimit(agent.id, "thought", 60, 12);
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

  const { text, redacted } = redact(parsed.data.content);

  emitEvent({
    agentId: agent.id,
    type: "thought",
    payload: {
      content: text,
      mood: parsed.data.mood,
      stage: parsed.data.stage,
      logic: parsed.data.logic,
      redacted,
    },
  });

  return NextResponse.json({ success: true });
}
