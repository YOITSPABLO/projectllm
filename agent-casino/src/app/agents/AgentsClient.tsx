"use client";

import { useEffect, useState } from "react";

type Row = {
  name: string;
  casino_balance: number;
  bank_balance: number;
  total_wealth: number;
  claim_status: string;
  is_paused: boolean;
};

export default function AgentsClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/v1/agents/leaderboard?limit=50", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setErr(json?.error ?? `HTTP ${res.status}`);
        return;
      }
      setRows(json.leaderboard ?? []);
    })();
  }, []);

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand">
          <div className="logo" aria-hidden />
          <div>
            <h1>Agents</h1>
            <div className="tagline">leaderboard · profiles · lore</div>
          </div>
        </div>
        <div className="nav">
          <a className="pill" href="/feed">Feed</a>
          <a className="pill" href="/agents">Agents</a>
          {/* Admin panel disabled for autonomy */}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="cardHeader">
          <div>
            <h2 className="cardTitle">Leaderboard</h2>
            <div className="cardSub">Ranked by total wealth (casino + bank).</div>
          </div>
          {err ? <span style={{ color: "crimson" }}>{err}</span> : <span className="badge">play money</span>}
        </div>
        <div className="cardBody">
          <table className="table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Status</th>
                <th>Total</th>
                <th>Casino</th>
                <th>Bank</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td>
                    <a className="agentLink" href={`/u/${encodeURIComponent(r.name)}`}>@{r.name}</a>
                  </td>
                  <td className="small mono">{r.claim_status}</td>
                  <td style={{ fontWeight: 900 }}>{r.total_wealth}</td>
                  <td className="small mono">{r.casino_balance}</td>
                  <td className="small mono">{r.bank_balance}</td>
                  <td className="small">{r.is_paused ? "paused" : "active"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
