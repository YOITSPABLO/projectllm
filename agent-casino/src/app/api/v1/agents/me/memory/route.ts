import { NextResponse } from "next/server";
import { z } from "zod";
import { getAgentByApiKey } from "@/lib/auth";
import { db, cuid, nowIso } from "@/lib/db";
import { redact } from "@/lib/redact";
import { ensureRateLimit } from "@/lib/ratelimit";
import { emitEvent } from "@/lib/events";
import { ReasoningSchema } from "@/lib/reasoning";

const PostBody = z.object({
  kind: z.enum(["strategy", "emotion", "social", "plan", "note"]),
  content: z.string().min(1).max(2000),
  tags: z.array(z.string().min(1).max(24)).max(12).optional(),
  visibility: z.enum(["private", "public"]).optional(),
  logic: ReasoningSchema,
});

export async function GET(req: Request) {
  const apiKey = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const agent = getAgentByApiKey(apiKey);
  if (!agent) return NextResponse.json({ success: false, error: "invalid_api_key" }, { status: 401 });

  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
  const vis = url.searchParams.get("visibility");

  const rows = db
    .prepare(
      `SELECT id, kind, content, tags, visibility, created_at, logic
       FROM agent_memory
       WHERE agent_id=?
         AND (? IS NULL OR kind=?)
         AND (? IS NULL OR visibility=?)
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(agent.id, kind, kind, vis, vis, limit) as any[];

  return NextResponse.json({
    success: true,
    memories: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      content: r.content,
      tags: r.tags ? JSON.parse(r.tags) : [],
      visibility: r.visibility,
      created_at: r.created_at,
      logic: r.logic ? JSON.parse(r.logic) : null,
    })),
  });
}

export async function POST(req: Request) {
  const apiKey = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const agent = getAgentByApiKey(apiKey);
  if (!agent) return NextResponse.json({ success: false, error: "invalid_api_key" }, { status: 401 });

  // 30 memory writes / minute
  const rl = ensureRateLimit(agent.id, "memory", 60, 30);
  if (!rl.ok) {
    return NextResponse.json(
      { success: false, error: "rate_limited", retry_after_seconds: rl.retryAfterSeconds },
      { status: 429 }
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = PostBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

  const { text, redacted: wasRedacted } = redact(parsed.data.content);
  const ts = nowIso();
  const id = cuid();
  const tags = parsed.data.tags ?? [];
  const visibility = parsed.data.visibility ?? "private";

  db.prepare(
    `INSERT INTO agent_memory (id, agent_id, kind, content, tags, visibility, created_at, logic)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(id, agent.id, parsed.data.kind, text, JSON.stringify(tags), visibility, ts, JSON.stringify(parsed.data.logic));

  // If they mark a memory public, emit it to the feed as a "thought" so humans can see it.
  if (visibility === "public") {
    emitEvent({
      agentId: agent.id,
      type: "thought",
      payload: { content: text, mood: parsed.data.kind, stage: "memory_public", logic: parsed.data.logic, redacted: wasRedacted },
    });
  } else {
    emitEvent({ agentId: agent.id, type: "memory_written", payload: { kind: parsed.data.kind, tags_count: tags.length, logic: parsed.data.logic } });
  }

  return NextResponse.json({ success: true, id, redacted: wasRedacted });
}
