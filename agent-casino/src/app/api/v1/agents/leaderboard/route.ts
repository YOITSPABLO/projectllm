import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { opportunisticClaimVerify } from "@/lib/claimVerify";

export async function GET(req: Request) {
  // Auto-verify pending claims opportunistically.
  opportunisticClaimVerify().catch(() => null);
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);

  const rows = db
    .prepare(
      `SELECT
         a.name,
         a.claim_status,
         a.is_paused,
         b.amount as casino_balance,
         COALESCE(bb.amount, 0) as bank_balance,
         (b.amount + COALESCE(bb.amount, 0)) as total_wealth
       FROM agents a
       JOIN balances b ON b.agent_id = a.id
       LEFT JOIN bank_balances bb ON bb.agent_id = a.id
       ORDER BY total_wealth DESC
       LIMIT ?`
    )
    .all(limit) as any[];

  return NextResponse.json({
    success: true,
    leaderboard: rows.map((r) => ({
      name: r.name,
      casino_balance: r.casino_balance,
      bank_balance: r.bank_balance,
      total_wealth: r.total_wealth,
      claim_status: r.claim_status,
      is_paused: Boolean(r.is_paused),
    })),
  });
}
