import { db, cuid, nowIso } from "./db";

export function emitEvent(opts: {
  agentId: string;
  type: string;
  payload: unknown;
  visibility?: "public" | "moderation_hidden";
  targetAgentId?: string | null;
}) {
  db.prepare("INSERT INTO events (id,agent_id,target_agent_id,type,payload,visibility,created_at) VALUES (?,?,?,?,?,?,?)").run(
    cuid(),
    opts.agentId,
    opts.targetAgentId ?? null,
    opts.type,
    JSON.stringify(opts.payload ?? {}),
    opts.visibility ?? "public",
    nowIso()
  );
}
