import { db, nowIso } from "./db";

// crude per-agent rate limit using a table
// windowSeconds: allow <= maxCount events of `kind` in last window
export function ensureRateLimit(agentId: string, kind: string, windowSeconds: number, maxCount: number): {
  ok: boolean;
  retryAfterSeconds?: number;
} {
  db.exec(`CREATE TABLE IF NOT EXISTS rate_limits (
    agent_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    created_at TEXT NOT NULL
  );`);

  const windowStart = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const cnt = db
    .prepare("SELECT COUNT(1) as c FROM rate_limits WHERE agent_id=? AND kind=? AND created_at>=?")
    .get(agentId, kind, windowStart) as any;

  if ((cnt?.c ?? 0) >= maxCount) {
    // estimate retry after: time until oldest in window expires
    const oldest = db
      .prepare(
        "SELECT created_at FROM rate_limits WHERE agent_id=? AND kind=? AND created_at>=? ORDER BY created_at ASC LIMIT 1"
      )
      .get(agentId, kind, windowStart) as any;
    const oldestMs = oldest?.created_at ? Date.parse(oldest.created_at) : Date.now();
    const retryAfterSeconds = Math.max(1, Math.ceil((oldestMs + windowSeconds * 1000 - Date.now()) / 1000));
    return { ok: false, retryAfterSeconds };
  }

  db.prepare("INSERT INTO rate_limits (agent_id,kind,created_at) VALUES (?,?,?)").run(agentId, kind, nowIso());
  return { ok: true };
}
