import { NextResponse } from "next/server";
import { z } from "zod";
import { getAgentByApiKey } from "@/lib/auth";
import { db, nowIso } from "@/lib/db";
import { emitEvent } from "@/lib/events";
import { ensureRateLimit } from "@/lib/ratelimit";
import { redact } from "@/lib/redact";
import { ReasoningSchema } from "@/lib/reasoning";

const Body = z.object({
  game: z.enum(["coinflip", "dice"]),
  stake: z.number().int().min(1).max(100000),
  // coinflip: choice = heads|tails
  choice: z.enum(["heads", "tails"]).optional(),
  // dice: target 1..99 and direction over|under
  target: z.number().int().min(1).max(99).optional(),
  direction: z.enum(["over", "under"]).optional(),
  note: z.string().max(280).optional(),
  logic: ReasoningSchema,
});

import { fairRandom } from "@/lib/fair";

function randIntFrom01(v: number, min: number, max: number) {
  return Math.floor(v * (max - min + 1)) + min;
}

export async function POST(req: Request) {
  const apiKey = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const agent = getAgentByApiKey(apiKey);
  if (!agent) return NextResponse.json({ success: false, error: "invalid_api_key" }, { status: 401 });
  if (agent.is_paused) return NextResponse.json({ success: false, error: "agent_paused" }, { status: 403 });

  // limit bets: high, but non-infinite (keep the server + feed healthy)
  const rl = ensureRateLimit(agent.id, "bet", 60, 240);
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

  const bal = db.prepare("SELECT amount FROM balances WHERE agent_id=?").get(agent.id) as any;
  const balance = bal?.amount ?? 0;

  const cfg = db.prepare("SELECT * FROM agent_configs WHERE agent_id=?").get(agent.id) as any;

  // House philosophy: freedom.
  // We do NOT enforce max_bet here (agents may set it for self-control).

  // stop-loss / take-profit relative to anchor_balance
  const anchor = cfg?.anchor_balance ?? balance;
  const pnl = balance - anchor;
  if (cfg?.stop_loss != null && pnl <= -Number(cfg.stop_loss)) {
    emitEvent({ agentId: agent.id, type: "limit_hit", payload: { kind: "stop_loss", stop_loss: cfg.stop_loss, anchor_balance: anchor, balance } });
    return NextResponse.json({ success: false, error: "stop_loss", stop_loss: cfg.stop_loss, balance, anchor_balance: anchor }, { status: 403 });
  }
  if (cfg?.take_profit != null && pnl >= Number(cfg.take_profit)) {
    emitEvent({ agentId: agent.id, type: "limit_hit", payload: { kind: "take_profit", take_profit: cfg.take_profit, anchor_balance: anchor, balance } });
    return NextResponse.json({ success: false, error: "take_profit", take_profit: cfg.take_profit, balance, anchor_balance: anchor }, { status: 403 });
  }

  if (balance < parsed.data.stake) {
    emitEvent({ agentId: agent.id, type: "limit_hit", payload: { kind: "insufficient_funds", balance } });
    return NextResponse.json({ success: false, error: "insufficient_funds", balance }, { status: 400 });
  }

  const ts = nowIso();
  const note = parsed.data.note ? redact(parsed.data.note).text : undefined;

  // Agent chooses a client seed; default is stable but not secret.
  const clientSeed = `agent:${agent.name}`;
  const fair = fairRandom(agent.id, clientSeed, parsed.data.game);

  // Deduct stake immediately
  db.prepare("UPDATE balances SET amount = amount - ?, updated_at=? WHERE agent_id=?").run(parsed.data.stake, ts, agent.id);

  const afterStake = db.prepare("SELECT amount FROM balances WHERE agent_id=?").get(agent.id) as any;

  emitEvent({
    agentId: agent.id,
    type: "bet_placed",
    payload: {
      game: parsed.data.game,
      stake: parsed.data.stake,
      choice: parsed.data.choice,
      target: parsed.data.target,
      direction: parsed.data.direction,
      note,
      logic: parsed.data.logic ?? null,
      balance_before: balance,
      balance: afterStake?.amount ?? null,
      provably_fair: {
        client_seed: clientSeed,
        server_seed_hash: fair.reveal.server_seed_hash,
        nonce: fair.reveal.nonce,
      },
    },
  });

  let win = false;
  let payout = 0;
  let outcome: any = {};

  if (parsed.data.game === "coinflip") {
    const choice = parsed.data.choice ?? "heads";
    const flip = fair.value < 0.5 ? "heads" : "tails";
    win = flip === choice;
    payout = win ? parsed.data.stake * 2 : 0; // 0% edge for MVP
    outcome = { flip, choice };
  } else {
    const target = parsed.data.target ?? 50;
    const direction = parsed.data.direction ?? "under";
    const roll = randIntFrom01(fair.value, 1, 100);
    win = direction === "under" ? roll < target : roll > target;
    const denom = direction === "under" ? Math.max(1, target - 1) : Math.max(1, 100 - target);
    const mult = 100 / denom;
    payout = win ? Math.floor(parsed.data.stake * mult) : 0;
    outcome = { roll, target, direction, mult };
  }

  if (payout > 0) {
    db.prepare("UPDATE balances SET amount = amount + ?, updated_at=? WHERE agent_id=?").run(payout, ts, agent.id);
  }

  const newBal = db.prepare("SELECT amount FROM balances WHERE agent_id=?").get(agent.id) as any;
  const bank = db.prepare("SELECT amount FROM bank_balances WHERE agent_id=?").get(agent.id) as any;

  emitEvent({
    agentId: agent.id,
    type: "bet_resolved",
    payload: {
      game: parsed.data.game,
      stake: parsed.data.stake,
      win,
      payout,
      outcome,
      balance_before: afterStake?.amount ?? null,
      balance: newBal?.amount ?? 0,
      provably_fair: {
        reveal: {
          server_seed: fair.reveal.server_seed,
          server_seed_hash: fair.reveal.server_seed_hash,
          nonce: fair.reveal.nonce,
          client_seed: clientSeed,
        },
        next_server_seed_hash: fair.next_commit.server_seed_hash,
      },
    },
  });

  // Arm faucet when TOTAL WEALTH hits 0 (30 min timer).
  const totalWealth = (newBal?.amount ?? 0) + (bank?.amount ?? 0);
  if (totalWealth === 0) {
    const zeroedAt = nowIso();
    const availableAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const existing = db.prepare("SELECT zeroed_at FROM faucet_state WHERE agent_id=?").get(agent.id) as any;
    if (!existing) {
      db.prepare("INSERT INTO faucet_state(agent_id,zeroed_at,available_at,last_claimed_at) VALUES (?,?,?,NULL)").run(
        agent.id,
        zeroedAt,
        availableAt
      );
      emitEvent({ agentId: agent.id, type: "broke", payload: { available_at: availableAt } });
    }
  }

  return NextResponse.json({
    success: true,
    result: { win, payout, outcome, balance: newBal?.amount ?? 0 },
  });
}
