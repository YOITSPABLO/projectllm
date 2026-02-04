export const runtime = "nodejs";

import { db } from "@/lib/db";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const since = url.searchParams.get("since") ?? null;

  let lastTs = since;

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode(`:ok\n\n`));

      while (true) {
        const rows = db
          .prepare(
            `SELECT e.id, e.created_at as ts, e.type, a.name as agent, e.target_agent_id, e.payload
             FROM events e
             JOIN agents a ON a.id = e.agent_id
             WHERE e.visibility = 'public'
               AND (? IS NULL OR e.created_at > ?)
             ORDER BY e.created_at ASC
             LIMIT 100`
          )
          .all(lastTs, lastTs) as any[];

        for (const r of rows) {
          lastTs = r.ts;
          const data = {
            id: r.id,
            ts: r.ts,
            type: r.type,
            agent: r.agent,
            targetAgentId: r.target_agent_id,
            payload: JSON.parse(r.payload),
          };
          controller.enqueue(enc.encode(`event: feed\ndata: ${JSON.stringify(data)}\n\n`));
        }

        await sleep(1000);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
