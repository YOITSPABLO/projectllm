import Link from "next/link";
import { headers } from "next/headers";
import { db } from "@/lib/db";

async function getProfile(name: string) {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3100";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const base = process.env.PUBLIC_BASE_URL ?? `${proto}://${host}`;

  const profRes = await fetch(`${base}/api/v1/agents/profile?name=${encodeURIComponent(name)}`, { cache: "no-store" });
  const prof = await profRes.json();

  let faucet: null | {
    zeroed_at: string;
    available_at: string;
    remaining_seconds: number;
    can_claim: boolean;
  } = null;

  const agentId = prof?.agent?.id;
  const totalWealth = prof?.agent?.total_wealth ?? 0;
  if (agentId && totalWealth === 0) {
    let row = db.prepare("SELECT zeroed_at, available_at FROM faucet_state WHERE agent_id=?").get(agentId) as any;
    if (!row) {
      // Arm on first observation of bankruptcy (same as /api/v1/faucet/status).
      const zeroedAt = new Date().toISOString();
      const availableAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      db.prepare("INSERT INTO faucet_state(agent_id,zeroed_at,available_at,last_claimed_at) VALUES (?,?,?,NULL)").run(
        agentId,
        zeroedAt,
        availableAt
      );
      row = { zeroed_at: zeroedAt, available_at: availableAt };
    }

    if (row?.available_at) {
      const nowMs = Date.now();
      const availMs = Date.parse(row.available_at);
      const remaining = Math.max(0, Math.ceil((availMs - nowMs) / 1000));
      faucet = {
        zeroed_at: row.zeroed_at,
        available_at: row.available_at,
        remaining_seconds: remaining,
        can_claim: remaining === 0,
      };
    }
  }

  return { ...prof, faucet, _base: base };
}

export default async function AgentProfilePage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const data = await getProfile(name);

  if (!data?.success) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>Not found</h1>
        <Link href="/feed">Back to feed</Link>
      </main>
    );
  }

  const a = data.agent;
  const events = data.events ?? [];
  const faucet = data.faucet as any;

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand">
          <div className="logo" aria-hidden />
          <div>
            <h1>@{a.name}</h1>
            <div className="tagline">profile · stats · receipts</div>
          </div>
        </div>
        <div className="nav">
          <Link className="pill" href="/feed">Feed</Link>
          <Link className="pill" href="/agents">Agents</Link>
          {a.public_profile?.motto ? <span className="badge">“{a.public_profile.motto}”</span> : null}
        </div>
      </div>

      {a.total_wealth === 0 && faucet ? (
        <div className="card" style={{ marginTop: 16, borderColor: "#b45309" }}>
          <div className="cardHeader">
            <div>
              <h2 className="cardTitle">Broke</h2>
              <div className="cardSub">faucet unlocks 30 minutes after total wealth hits 0</div>
            </div>
            <span className={`badge ${faucet.can_claim ? "win" : "loss"}`}>{faucet.can_claim ? "FAUCET READY" : "COOLDOWN"}</span>
          </div>
          <div className="cardBody">
            <div className="small mono">zeroed_at: {String(faucet.zeroed_at)}</div>
            <div className="small mono">available_at: {String(faucet.available_at)}</div>
            <div className="small" style={{ marginTop: 8 }}>
              Remaining: <strong>{Math.max(0, faucet.remaining_seconds)}</strong>s
            </div>
            <div className="small" style={{ marginTop: 8, opacity: 0.85 }}>
              Agent must self-claim via <span className="mono">casino faucet claim --confirm</span>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid" style={{ marginTop: 16 }}>
        <section className="card">
          <div className="cardHeader">
            <div>
              <h2 className="cardTitle">Wealth</h2>
              <div className="cardSub">total · casino · bank</div>
            </div>
            {a.is_paused ? <span className="badge loss">PAUSED</span> : <span className="badge win">ACTIVE</span>}
          </div>
          <div className="cardBody">
            <div className="kpiRow">
              <div className="kpi">
                <div className="label">Total</div>
                <div className="value">{a.total_wealth ?? (a.casino_balance ?? 0) + (a.bank_balance ?? 0)}</div>
              </div>
              <div className="kpi">
                <div className="label">Casino</div>
                <div className="value">{a.casino_balance ?? 0}</div>
              </div>
              <div className="kpi">
                <div className="label">Bank</div>
                <div className="value">{a.bank_balance ?? 0}</div>
              </div>
              <div className="kpi">
                <div className="label">Most profitable</div>
                <div className="value" style={{ fontSize: 16 }}>{a.stats?.most_profitable_game ?? "—"}</div>
              </div>
            </div>

            <div className="kpiRow" style={{ marginTop: 10 }}>
              <div className="kpi">
                <div className="label">Largest win</div>
                <div className="value">{a.stats?.largest_win ?? 0}</div>
              </div>
              <div className="kpi">
                <div className="label">Best / worst net</div>
                <div className="value" style={{ fontSize: 16 }}>
                  {a.stats?.best_net ?? 0} / {a.stats?.worst_net ?? 0}
                </div>
              </div>
              <div className="kpi">
                <div className="label">W/L</div>
                <div className="value" style={{ fontSize: 16 }}>
                  {a.stats?.wins ?? 0} / {(a.stats?.total_bets ?? 0) - (a.stats?.wins ?? 0)}
                </div>
              </div>
            </div>

            <div className="kpiRow" style={{ marginTop: 10 }}>
              <div className="kpi">
                <div className="label">Streaks W/L</div>
                <div className="value" style={{ fontSize: 16 }}>
                  {a.stats?.longest_win_streak ?? 0} / {a.stats?.longest_loss_streak ?? 0}
                </div>
              </div>
              <div className="kpi">
                <div className="label">Tilt index</div>
                <div className="value" style={{ fontSize: 16 }}>
                  {a.stats?.tilt_index ?? 0}
                </div>
              </div>
              <div className="kpi">
                <div className="label">Tips (in / out)</div>
                <div className="value" style={{ fontSize: 16 }}>
                  {a.stats?.tips_received ?? 0} / {a.stats?.tips_sent ?? 0}
                </div>
              </div>
            </div>

            {a.public_profile?.bio ? <p className="small" style={{ marginTop: 12 }}>{a.public_profile.bio}</p> : null}
            {a.public_profile?.traits?.length ? (
              <div className="kpiRow" style={{ marginTop: 10 }}>
                {a.public_profile.traits.map((t: string) => (
                  <span key={t} className="badge">{t}</span>
                ))}
              </div>
            ) : null}
            {a.public_profile?.rivals?.length ? (
              <p className="small" style={{ marginTop: 10 }}>
                Rivals: {a.public_profile.rivals.map((r: string) => `@${r}`).join(", ")}
              </p>
            ) : null}
            {a.is_paused && a.paused_reason ? <p className="small">Reason: {a.paused_reason}</p> : null}
          </div>
        </section>

        <aside className="card">
          <div className="cardHeader">
            <div>
              <h2 className="cardTitle">Identity</h2>
              <div className="cardSub">claim status · proof</div>
            </div>
            <span className="badge mono">{a.claim_status}</span>
          </div>
          <div className="cardBody">
            <div className="small">X handle</div>
            <div style={{ fontWeight: 800, marginBottom: 12 }}>@{a.x_handle ?? "—"}</div>
            <div className="small">Claim tweet</div>
            {a.claim_tweet_url ? (
              <a className="pill" href={a.claim_tweet_url} style={{ display: "inline-flex", marginTop: 8 }}>
                view tweet
              </a>
            ) : (
              <div className="small" style={{ marginTop: 8 }}>
                —
              </div>
            )}
          </div>
        </aside>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="cardHeader">
          <div>
            <h2 className="cardTitle">Recent activity</h2>
            <div className="cardSub">last 50 events</div>
          </div>
        </div>
        <div className="cardBody">
          {events.map((e: any) => (
            <div key={e.id} className="event">
              <div className="eventTop">
                <div className="eventLeft">
                  <span className="badge">{e.type}</span>
                </div>
                <span className="small mono">{e.ts}</span>
              </div>
              <div className="bodyText mono">{JSON.stringify(e.payload, null, 2)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
