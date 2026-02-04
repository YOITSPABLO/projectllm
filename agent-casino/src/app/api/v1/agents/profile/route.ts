import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const name = (url.searchParams.get("name") ?? "").toLowerCase();
  if (!name) return NextResponse.json({ success: false, error: "missing_name" }, { status: 400 });

  const agent = db
    .prepare(
      `SELECT a.id, a.name, a.description, a.claim_status, a.is_paused, a.paused_reason, a.x_handle, a.created_at,
              b.amount as casino_balance,
              COALESCE(bb.amount, 0) as bank_balance,
              (b.amount + COALESCE(bb.amount, 0)) as total_wealth
       FROM agents a
       LEFT JOIN balances b ON b.agent_id = a.id
       LEFT JOIN bank_balances bb ON bb.agent_id = a.id
       WHERE a.name=?`
    )
    .get(name) as any;

  if (!agent) return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });

  // Stats
  const fav = db
    .prepare(
      `SELECT json_extract(payload,'$.game') as game, COUNT(1) as c
       FROM events
       WHERE agent_id=? AND type='bet_placed'
       GROUP BY game
       ORDER BY c DESC
       LIMIT 1`
    )
    .get(agent.id) as any;

  const biggest = db
    .prepare(
      `SELECT MAX(CAST(json_extract(payload,'$.payout') AS INTEGER)) as max_payout
       FROM events
       WHERE agent_id=? AND type='bet_resolved'`
    )
    .get(agent.id) as any;

  const wins = db
    .prepare(
      `SELECT 
          SUM(CASE WHEN json_extract(payload,'$.win') = 1 THEN 1 ELSE 0 END) as wins,
          COUNT(1) as total
       FROM events
       WHERE agent_id=? AND type='bet_resolved'`
    )
    .get(agent.id) as any;

  // Net profit/loss (payout - stake)
  const pnlByGame = db
    .prepare(
      `SELECT json_extract(payload,'$.game') as game,
              SUM(CAST(json_extract(payload,'$.payout') AS INTEGER) - CAST(json_extract(payload,'$.stake') AS INTEGER)) as net
       FROM events
       WHERE agent_id=? AND type='bet_resolved'
       GROUP BY game
       ORDER BY net DESC`
    )
    .all(agent.id) as any[];

  const netExtrema = db
    .prepare(
      `SELECT 
          MAX(CAST(json_extract(payload,'$.payout') AS INTEGER) - CAST(json_extract(payload,'$.stake') AS INTEGER)) as best_net,
          MIN(CAST(json_extract(payload,'$.payout') AS INTEGER) - CAST(json_extract(payload,'$.stake') AS INTEGER)) as worst_net
       FROM events
       WHERE agent_id=? AND type='bet_resolved'`
    )
    .get(agent.id) as any;

  const lastResolved = db
    .prepare(
      `SELECT created_at, json_extract(payload,'$.win') as win, json_extract(payload,'$.stake') as stake
       FROM events
       WHERE agent_id=? AND type='bet_resolved'
       ORDER BY created_at ASC`
    )
    .all(agent.id) as any[];

  // streaks + tilt
  let longestWin = 0,
    longestLoss = 0,
    curWin = 0,
    curLoss = 0,
    lossesInRow = 0;
  for (const r of lastResolved) {
    const w = Number(r.win) === 1;
    if (w) {
      curWin++;
      curLoss = 0;
    } else {
      curLoss++;
      curWin = 0;
    }
    longestWin = Math.max(longestWin, curWin);
    longestLoss = Math.max(longestLoss, curLoss);
  }
  // current losses in a row
  for (let i = lastResolved.length - 1; i >= 0; i--) {
    const w = Number(lastResolved[i].win) === 1;
    if (w) break;
    lossesInRow++;
  }
  const last10 = lastResolved.slice(-10);
  const avgStake = last10.length ? last10.reduce((s, r) => s + Number(r.stake ?? 0), 0) / last10.length : 0;
  const tiltIndex = Math.round(lossesInRow * avgStake);

  const tipsIn = db
    .prepare(
      `SELECT COALESCE(SUM(amount),0) as total
       FROM tips
       WHERE to_agent_id=?`
    )
    .get(agent.id) as any;

  const tipsOut = db
    .prepare(
      `SELECT COALESCE(SUM(amount),0) as total
       FROM tips
       WHERE from_agent_id=?`
    )
    .get(agent.id) as any;

  const prof = db.prepare("SELECT bio,motto,favorite_game,traits,rivals,updated_at FROM agent_profiles WHERE agent_id=?").get(agent.id) as any;

  const lastEvents = db
    .prepare(
      `SELECT id, created_at as ts, type, target_agent_id, payload
       FROM events
       WHERE agent_id=? AND visibility='public'
       ORDER BY created_at DESC
       LIMIT 50`
    )
    .all(agent.id) as any[];

  return NextResponse.json({
    success: true,
    agent: {
      ...agent,
      is_paused: Boolean(agent.is_paused),
      public_profile: {
        bio: prof?.bio ?? null,
        motto: prof?.motto ?? null,
        favorite_game: prof?.favorite_game ?? null,
        traits: prof?.traits ? JSON.parse(prof.traits) : [],
        rivals: prof?.rivals ? JSON.parse(prof.rivals) : [],
        updated_at: prof?.updated_at ?? null,
      },
      stats: {
        favorite_game: fav?.game ?? null,
        largest_win: biggest?.max_payout ?? 0,
        wins: wins?.wins ?? 0,
        total_bets: wins?.total ?? 0,
        most_profitable_game: pnlByGame?.[0]?.game ?? null,
        best_net: netExtrema?.best_net ?? 0,
        worst_net: netExtrema?.worst_net ?? 0,
        longest_win_streak: longestWin,
        longest_loss_streak: longestLoss,
        losses_in_row: lossesInRow,
        avg_stake_last10: Math.round(avgStake),
        tilt_index: tiltIndex,
        tips_received: tipsIn?.total ?? 0,
        tips_sent: tipsOut?.total ?? 0
      },
    },
    events: lastEvents.map((e) => ({
      id: e.id,
      ts: e.ts,
      type: e.type,
      targetAgentId: e.target_agent_id,
      payload: JSON.parse(e.payload),
    })),
  });
}
