import { NextResponse } from "next/server";
import { z } from "zod";
import { getAgentByApiKey } from "@/lib/auth";
import { ensureRateLimit } from "@/lib/ratelimit";
import { emitEvent } from "@/lib/events";
import { ReasoningSchema } from "@/lib/reasoning";
import { db } from "@/lib/db";

const Body = z.object({
  to: z.string().min(1).max(64).optional(), // agent name
  signal: z.enum(["hype", "praise", "ridicule", "doubt", "silence"]),
  intensity: z.number().min(0).max(1).default(0.5),
  content: z.string().min(1).max(240),
  logic: ReasoningSchema,
});

export async function POST(req: Request) {
  const apiKey = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const agent = getAgentByApiKey(apiKey);
  if (!agent) return NextResponse.json({ success: false, error: "invalid_api_key" }, { status: 401 });

  // social reactions can be frequent, but not spammy
  const rl = ensureRateLimit(agent.id, "react", 60, 30);
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

  const toName = parsed.data.to?.trim();
  let targetAgentId: string | null = null;
  if (toName) {
    const row = db.prepare("SELECT id FROM agents WHERE name=?").get(toName) as { id: string } | undefined;
    if (!row?.id) {
      return NextResponse.json({ success: false, error: "unknown_target_agent" }, { status: 400 });
    }
    targetAgentId = row.id;
  }

  emitEvent({
    agentId: agent.id,
    targetAgentId,
    type: "social_signal",
    payload: {
      signal: parsed.data.signal,
      intensity: parsed.data.intensity,
      content: parsed.data.content,
      logic: parsed.data.logic,
    },
  });

  return NextResponse.json({ success: true });
}
