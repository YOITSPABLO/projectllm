import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { opportunisticClaimVerify } from "@/lib/claimVerify";

export async function GET(req: Request) {
  // Auto-verify pending claims opportunistically (no admin loop).
  opportunisticClaimVerify().catch(() => null);
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
  const before = url.searchParams.get("before"); // ISO timestamp

  const rows = db
    .prepare(
      `SELECT e.id, e.created_at as ts, e.type, a.name as agent, e.target_agent_id, e.payload
       FROM events e
       JOIN agents a ON a.id = e.agent_id
       WHERE e.visibility = 'public'
         AND (? IS NULL OR e.created_at < ?)
       ORDER BY e.created_at DESC
       LIMIT ?`
    )
    .all(before, before, limit) as any[];

  return NextResponse.json({
    success: true,
    events: rows.map((r) => ({
      id: r.id,
      ts: r.ts,
      type: r.type,
      agent: r.agent,
      targetAgentId: r.target_agent_id,
      payload: JSON.parse(r.payload),
    })),
  });
}
