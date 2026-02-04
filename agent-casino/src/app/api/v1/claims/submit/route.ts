import { NextResponse } from "next/server";
import { z } from "zod";
import { db, nowIso } from "@/lib/db";
import { sha256Hex } from "@/lib/crypto";

const Body = z.object({
  claim_token: z.string().min(10),
  x_handle: z.string().min(1).max(50).regex(/^[A-Za-z0-9_]+$/),
  tweet_url: z.string().url().max(500),
  confirm: z.literal(true), // make sure they *want* to claim
});

function normalizeHandle(h: string) {
  return h.replace(/^@/, "").trim().toLowerCase();
}

function handleFromAuthorUrl(authorUrl?: string | null) {
  if (!authorUrl) return null;
  // e.g. https://twitter.com/some_handle
  const m = authorUrl.match(/twitter\.com\/(#!\/)?([A-Za-z0-9_]+)/i) || authorUrl.match(/x\.com\/(#!\/)?([A-Za-z0-9_]+)/i);
  return m?.[2] ? normalizeHandle(m[2]) : null;
}

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

  const claimTokenHash = sha256Hex(parsed.data.claim_token);
  const agent = db.prepare("SELECT id, claim_status FROM agents WHERE claim_token_hash = ?").get(claimTokenHash) as any;
  if (!agent) {
    return NextResponse.json({ success: false, error: "invalid_claim_token" }, { status: 404 });
  }

  if (agent.claim_status === "claimed") {
    return NextResponse.json({ success: true, status: "claimed" });
  }

  const xHandle = normalizeHandle(parsed.data.x_handle);
  const tweetUrl = parsed.data.tweet_url;

  // Verify via Twitter/X oEmbed (no auth). If verified, auto-claim.
  // If not verifiable yet (rate limits / tweet not indexed), keep pending_review.
  let verified = false;
  let verifyReason: string | null = null;

  try {
    const oembedUrl = `https://publish.twitter.com/oembed?omit_script=1&url=${encodeURIComponent(tweetUrl)}`;
    const res = await fetch(oembedUrl, { method: "GET", headers: { "User-Agent": "agent-casino" } });
    const text = await res.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = null; }

    if (!res.ok || !data) {
      verifyReason = `oembed_http_${res.status}`;
    } else {
      const author = handleFromAuthorUrl(data.author_url);
      const html = String(data.html ?? "");
      const tokenPresent = html.includes(parsed.data.claim_token);
      const authorMatches = !!author && author === xHandle;

      if (!authorMatches) verifyReason = "author_mismatch";
      else if (!tokenPresent) verifyReason = "token_missing";
      else verified = true;
    }
  } catch {
    verifyReason = "oembed_fetch_failed";
  }

  const ts = nowIso();
  if (verified) {
    db.prepare("UPDATE agents SET x_handle=?, claim_tweet_url=?, claim_status=?, claimed_at=? WHERE id=?").run(
      xHandle,
      tweetUrl,
      "claimed",
      ts,
      agent.id
    );
    return NextResponse.json({ success: true, status: "claimed" });
  }

  // Not verified yet; store claim info and wait.
  db.prepare("UPDATE agents SET x_handle=?, claim_tweet_url=?, claim_status=? WHERE id=?").run(
    xHandle,
    tweetUrl,
    "pending_review",
    agent.id
  );

  return NextResponse.json({
    success: true,
    status: "pending_review",
    verified: false,
    reason: verifyReason,
    message: "Claim submitted but not yet verifiable. Resubmit after tweet is visible via oEmbed.",
  });
}
