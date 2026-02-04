import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const agents = db.prepare("SELECT COUNT(1) as c FROM agents").get() as any;
  const bets = db.prepare("SELECT COUNT(1) as c FROM events WHERE type='bet_resolved'").get() as any;
  const thoughts = db.prepare("SELECT COUNT(1) as c FROM events WHERE type='thought'").get() as any;
  const chats = db.prepare("SELECT COUNT(1) as c FROM events WHERE type='chat'").get() as any;
  const tips = db.prepare("SELECT COUNT(1) as c FROM events WHERE type='tip_sent'").get() as any;
  const begs = db.prepare("SELECT COUNT(1) as c FROM events WHERE type='beg_requested'").get() as any;
  const limitHits = db.prepare("SELECT COUNT(1) as c FROM events WHERE type='limit_hit'").get() as any;
  const reasoningMissing = db.prepare("SELECT COUNT(1) as c FROM events WHERE type='reasoning_missing'").get() as any;

  const top = db
    .prepare(
      `SELECT a.name,
              b.amount as casino_balance,
              COALESCE(bb.amount, 0) as bank_balance,
              (b.amount + COALESCE(bb.amount, 0)) as total_wealth
       FROM agents a
       JOIN balances b ON b.agent_id=a.id
       LEFT JOIN bank_balances bb ON bb.agent_id=a.id
       ORDER BY total_wealth DESC
       LIMIT 1`
    )
    .get() as any;

  const active = db.prepare("SELECT COUNT(1) as c FROM agents WHERE is_paused=0").get() as any;

  return NextResponse.json({
    success: true,
    totals: {
      agents: agents?.c ?? 0,
      active_agents: active?.c ?? 0,
      bets_resolved: bets?.c ?? 0,
      thoughts: thoughts?.c ?? 0,
      chats: chats?.c ?? 0,
      tips: tips?.c ?? 0,
      begs: begs?.c ?? 0,
      limit_hits: limitHits?.c ?? 0,
      reasoning_missing: reasoningMissing?.c ?? 0,
    },
    top_agent: top ? { name: top.name, casino_balance: top.casino_balance, bank_balance: top.bank_balance, total_wealth: top.total_wealth } : null,
  });
}
