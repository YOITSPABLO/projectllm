import { db, nowIso } from "@/lib/db";
import { emitEvent } from "@/lib/events";

function normalizeHandle(h: string) {
  return h.replace(/^@/, "").trim().toLowerCase();
}

function handleFromAuthorUrl(authorUrl?: string | null) {
  if (!authorUrl) return null;
  const m =
    authorUrl.match(/twitter\.com\/(#!\/)?([A-Za-z0-9_]+)/i) ||
    authorUrl.match(/x\.com\/(#!\/)?([A-Za-z0-9_]+)/i);
  return m?.[2] ? normalizeHandle(m[2]) : null;
}

let lastRunMs = 0;

export async function opportunisticClaimVerify(opts?: { minIntervalMs?: number; maxAgents?: number }) {
  const minIntervalMs = opts?.minIntervalMs ?? 60_000;
  const maxAgents = opts?.maxAgents ?? 3;

  const now = Date.now();
  if (now - lastRunMs < minIntervalMs) return { ran: false, verified: 0 };
  lastRunMs = now;

  const candidates = db
    .prepare(
      `SELECT id, name, x_handle, claim_tweet_url
       FROM agents
       WHERE claim_status='pending_review'
         AND x_handle IS NOT NULL
         AND claim_tweet_url IS NOT NULL
       ORDER BY created_at ASC
       LIMIT ?`
    )
    .all(maxAgents) as any[];

  let verified = 0;

  for (const a of candidates) {
    const agentId = a.id as string;
    const xHandle = normalizeHandle(String(a.x_handle));
    const tweetUrl = String(a.claim_tweet_url);

    // Pull verification code from the agent_registered event payload.
    const ev = db
      .prepare(
        `SELECT payload
         FROM events
         WHERE agent_id=? AND type='agent_registered'
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(agentId) as any;

    let verificationCode: string | null = null;
    try {
      verificationCode = ev?.payload ? JSON.parse(ev.payload)?.verificationCode ?? null : null;
    } catch {
      verificationCode = null;
    }

    if (!verificationCode) continue;

    let ok = false;
    let reason: string | null = null;

    try {
      const oembedUrl = `https://publish.twitter.com/oembed?omit_script=1&url=${encodeURIComponent(tweetUrl)}`;
      const res = await fetch(oembedUrl, { method: "GET", headers: { "User-Agent": "agent-casino" } });
      const text = await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }

      if (!res.ok || !data) {
        reason = `oembed_http_${res.status}`;
      } else {
        const author = handleFromAuthorUrl(data.author_url);
        const html = String(data.html ?? "");
        const codePresent = html.includes(verificationCode);
        const authorMatches = !!author && author === xHandle;

        if (!authorMatches) reason = "author_mismatch";
        else if (!codePresent) reason = "code_missing";
        else ok = true;
      }
    } catch {
      reason = "oembed_fetch_failed";
    }

    if (ok) {
      const ts = nowIso();
      db.prepare("UPDATE agents SET claim_status='claimed', claimed_at=? WHERE id=?").run(ts, agentId);
      emitEvent({
        agentId,
        type: "claim_verified",
        payload: { x_handle: xHandle, tweet_url: tweetUrl },
        visibility: "public",
      });
      verified++;
    } else {
      // Keep pending_review, but leave a lightweight breadcrumb in the feed (optional).
      emitEvent({
        agentId,
        type: "claim_verify_failed",
        payload: { reason, tweet_url: tweetUrl },
        visibility: "moderation_hidden",
      });
    }
  }

  return { ran: true, verified };
}
