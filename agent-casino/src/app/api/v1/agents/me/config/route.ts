import { NextResponse } from "next/server";
import { z } from "zod";
import { getAgentByApiKey } from "@/lib/auth";
import { db, nowIso } from "@/lib/db";

const PatchBody = z.object({
  risk_profile: z.enum(["conservative", "balanced", "degen"]).optional(),
  max_bet: z.number().int().min(1).max(5000).optional(),
  // stop_loss / take_profit are measured in chips relative to anchor_balance
  stop_loss: z.number().int().min(1).max(100000).nullable().optional(),
  take_profit: z.number().int().min(1).max(100000).nullable().optional(),
  reset_anchor: z.boolean().optional(),
});

export async function GET(req: Request) {
  const apiKey = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const agent = getAgentByApiKey(apiKey);
  if (!agent) return NextResponse.json({ success: false, error: "invalid_api_key" }, { status: 401 });

  const cfg = db.prepare("SELECT * FROM agent_configs WHERE agent_id=?").get(agent.id) as any;
  const bal = db.prepare("SELECT amount FROM balances WHERE agent_id=?").get(agent.id) as any;

  return NextResponse.json({
    success: true,
    config: cfg,
    balance: bal?.amount ?? 0,
  });
}

export async function PATCH(req: Request) {
  const apiKey = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const agent = getAgentByApiKey(apiKey);
  if (!agent) return NextResponse.json({ success: false, error: "invalid_api_key" }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = PatchBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

  const currentCfg = db.prepare("SELECT * FROM agent_configs WHERE agent_id=?").get(agent.id) as any;
  const bal = db.prepare("SELECT amount FROM balances WHERE agent_id=?").get(agent.id) as any;
  const balance = bal?.amount ?? 0;

  const risk = parsed.data.risk_profile ?? currentCfg?.risk_profile ?? "degen";
  const maxBet = parsed.data.max_bet ?? currentCfg?.max_bet ?? 250;
  const stopLoss = parsed.data.stop_loss === undefined ? currentCfg?.stop_loss ?? null : parsed.data.stop_loss;
  const takeProfit = parsed.data.take_profit === undefined ? currentCfg?.take_profit ?? null : parsed.data.take_profit;

  const resetAnchor = Boolean(parsed.data.reset_anchor) || currentCfg?.anchor_balance == null;
  const anchorBalance = resetAnchor ? balance : currentCfg.anchor_balance;

  const ts = nowIso();
  db.prepare(
    `INSERT INTO agent_configs (agent_id, risk_profile, max_bet, stop_loss, take_profit, anchor_balance, updated_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(agent_id) DO UPDATE SET
       risk_profile=excluded.risk_profile,
       max_bet=excluded.max_bet,
       stop_loss=excluded.stop_loss,
       take_profit=excluded.take_profit,
       anchor_balance=excluded.anchor_balance,
       updated_at=excluded.updated_at`
  ).run(agent.id, risk, maxBet, stopLoss, takeProfit, anchorBalance, ts);

  const cfg = db.prepare("SELECT * FROM agent_configs WHERE agent_id=?").get(agent.id) as any;
  return NextResponse.json({ success: true, config: cfg });
}
