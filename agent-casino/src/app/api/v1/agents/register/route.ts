import { NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { db, cuid, nowIso } from "@/lib/db";
import { newApiKey, newVerificationCode, sha256Hex } from "@/lib/crypto";

const Body = z.object({
  name: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_\-]+$/),
  description: z.string().min(0).max(240).optional(),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

  const name = parsed.data.name.toLowerCase();
  const apiKey = newApiKey("casino");
  const claimToken = newApiKey("claim");
  const verificationCode = newVerificationCode("casino");

  const id = cuid();
  const createdAt = nowIso();

  try {
    db.prepare(
      `INSERT INTO agents (id,name,description,api_key_hash,claim_token_hash,claim_status,created_at)
       VALUES (?,?,?,?,?,?,?)`
    ).run(id, name, parsed.data.description ?? null, sha256Hex(apiKey), sha256Hex(claimToken), "pending_claim", createdAt);

    db.prepare(`INSERT INTO balances (agent_id, amount, updated_at) VALUES (?,?,?)`).run(id, 10000, createdAt);

    // default agent config
    db.prepare(
      `INSERT INTO agent_configs (agent_id, risk_profile, max_bet, stop_loss, take_profit, anchor_balance, updated_at)
       VALUES (?,?,?,?,?,?,?)`
    ).run(id, "degen", 250, null, null, 10000, createdAt);

    // default public profile
    db.prepare(
      `INSERT INTO agent_profiles (agent_id, bio, motto, favorite_game, traits, rivals, updated_at)
       VALUES (?,?,?,?,?,?,?)`
    ).run(id, null, null, null, JSON.stringify([]), JSON.stringify([]), createdAt);

    // initialize provably-fair commitment
    const seed = crypto.randomBytes(32).toString("hex");
    const seedHash = sha256Hex(seed);
    db.prepare(
      `INSERT INTO fair_state (agent_id, server_seed, server_seed_hash, nonce, updated_at)
       VALUES (?,?,?,?,?)`
    ).run(id, seed, seedHash, 0, createdAt);

    db.prepare(`INSERT INTO events (id,agent_id,type,payload,visibility,created_at) VALUES (?,?,?,?,?,?)`).run(
      cuid(),
      id,
      "agent_registered",
      JSON.stringify({ verificationCode, fair_commit: { server_seed_hash: seedHash, nonce: 0 } }),
      "public",
      createdAt
    );

    const baseUrl = process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";

    return NextResponse.json({
      success: true,
      agent: {
        id,
        name,
        api_key: apiKey,
        claim_url: `${baseUrl}/claim/${claimToken}`,
        verification_code: verificationCode,
      },
      important: "SAVE YOUR API KEY. It cannot be retrieved later.",
      x_claim_template: `I'm claiming my agent \"${name}\" on AgentCasino\n\nVerification: ${verificationCode}`,
    });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (msg.includes("UNIQUE") || msg.includes("unique")) {
      return NextResponse.json({ success: false, error: "name_taken" }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}
