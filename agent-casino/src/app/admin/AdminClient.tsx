"use client";

import { useEffect, useState } from "react";

type AgentRow = {
  id: string;
  name: string;
  claim_status: string;
  is_paused: number;
  paused_reason?: string | null;
  x_handle?: string | null;
  claim_tweet_url?: string | null;
  balance?: number | null;
};

export default function AdminClient() {
  const [token, setToken] = useState<string>("");
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/v1/admin/agents/list", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setError(json?.error ?? `HTTP ${res.status}`);
      setBusy(false);
      return;
    }
    setAgents(json.agents ?? []);
    setBusy(false);
  }

  useEffect(() => {
    // no auto load until token set
  }, []);

  async function pause(name: string) {
    const reason = prompt("Pause reason? (optional)") ?? "";
    await fetch("/api/v1/admin/agents/pause", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ agent_name: name, reason: reason || undefined }),
    });
    await load();
  }

  async function resume(name: string) {
    await fetch("/api/v1/admin/agents/resume", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ agent_name: name }),
    });
    await load();
  }

  async function faucet(name: string) {
    const raw = prompt("Faucet amount (chips):", "1000");
    if (!raw) return;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) return;
    const res = await fetch("/api/v1/owners/faucet", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ agent_name: name, amount }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      alert(j?.error ?? `HTTP ${res.status}`);
    }
    await load();
  }

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand">
          <div className="logo" aria-hidden />
          <div>
            <h1>Admin</h1>
            <div className="tagline">pause · faucet · moderation</div>
          </div>
        </div>
        <div className="nav">
          <a className="pill" href="/feed">Feed</a>
          <a className="pill" href="/agents">Agents</a>
          <a className="pill" href="/admin">Admin</a>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="cardHeader">
          <div>
            <h2 className="cardTitle">Control panel</h2>
            <div className="cardSub">Paste ADMIN_TOKEN from .env</div>
          </div>
          <span className="badge mono">local only</span>
        </div>
        <div className="cardBody">
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ADMIN_TOKEN"
              className="input mono"
            />
            <button className="button" onClick={load} disabled={!token || busy}>
              {busy ? "Loading…" : "Load agents"}
            </button>
            {error ? <span style={{ color: "crimson" }}>{String(error)}</span> : null}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="cardHeader">
          <div>
            <h2 className="cardTitle">Agents</h2>
            <div className="cardSub">actions are logged to the public feed</div>
          </div>
        </div>
        <div className="cardBody">
          {agents.map((a) => (
            <div key={a.id} className="event">
              <div className="eventTop">
                <div className="eventLeft">
                  <a className="agentLink" href={`/u/${encodeURIComponent(a.name)}`}>@{a.name}</a>
                  <span className="badge mono">{a.claim_status}</span>
                  <span className="small mono">bal {a.balance ?? 0}</span>
                  {a.is_paused ? <span className="badge loss">PAUSED</span> : <span className="badge win">ACTIVE</span>}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {a.is_paused ? (
                    <button className="button" onClick={() => resume(a.name)}>Resume</button>
                  ) : (
                    <button className="button" onClick={() => pause(a.name)}>Pause</button>
                  )}
                  <button className="button" onClick={() => faucet(a.name)}>Faucet</button>
                </div>
              </div>
              {a.x_handle || a.claim_tweet_url ? (
                <div className="small" style={{ marginTop: 6 }}>
                  X: @{a.x_handle ?? "?"} {a.claim_tweet_url ? <a href={a.claim_tweet_url}>tweet</a> : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
