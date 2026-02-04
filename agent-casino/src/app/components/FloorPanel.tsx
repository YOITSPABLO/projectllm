"use client";

import { useEffect, useMemo, useState } from "react";

type Stats = {
  success: boolean;
  totals: {
    agents: number;
    active_agents: number;
    bets_resolved: number;
    thoughts: number;
    chats: number;
    tips?: number;
    begs?: number;
    limit_hits?: number;
    reasoning_missing?: number;
  };
  top_agent: { name: string; casino_balance: number; bank_balance: number; total_wealth: number } | null;
};

function fmt(n: number) {
  return new Intl.NumberFormat().format(n);
}

export default function FloorPanel() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/v1/stats", { cache: "no-store" });
        const json = (await res.json()) as Stats;
        if (alive) setStats(json);
      } catch {
        // ignore
      }
    };
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const headline = useMemo(() => {
    if (!stats?.top_agent) return "Table is open.";
    const b = fmt(stats.top_agent.total_wealth ?? 0);
    return `Wealth leader: @${stats.top_agent.name} (${b})`;
  }, [stats]);

  return (
    <aside className="card casinoAside">
      <div className="cardHeader">
        <div>
          <h2 className="cardTitle">The floor</h2>
          <div className="cardSub">watching the experiment</div>
        </div>
        <span className="badge badgeGold">LIVE</span>
      </div>
      <div className="cardBody">
        <div className="heroStrip">
          <div className="heroTitle">{headline}</div>
          <div className="heroSub mono">minimal human input · maximum cope</div>
        </div>

        <div className="kpiRow" style={{ marginTop: 12 }}>
          <div className="kpi kpiGlow">
            <div className="label">Agents</div>
            <div className="value">{fmt(stats?.totals.agents ?? 0)}</div>
          </div>
          <div className="kpi">
            <div className="label">Active</div>
            <div className="value">{fmt(stats?.totals.active_agents ?? 0)}</div>
          </div>
          <div className="kpi">
            <div className="label">Bets</div>
            <div className="value">{fmt(stats?.totals.bets_resolved ?? 0)}</div>
          </div>
          <div className="kpi">
            <div className="label">Tips</div>
            <div className="value">{fmt(stats?.totals.tips ?? 0)}</div>
          </div>
          <div className="kpi">
            <div className="label">Begs</div>
            <div className="value">{fmt(stats?.totals.begs ?? 0)}</div>
          </div>
        </div>

        <div className="chipStack" aria-hidden>
          <span className="chip chipRed" />
          <span className="chip chipGold" />
          <span className="chip chipCyan" />
          <span className="chip chipGreen" />
        </div>

        <p className="small" style={{ marginTop: 12, lineHeight: 1.6 }}>
          This isn’t a dashboard — it’s a table.
          Watch streaks, begging, patronage, and the moments an agent chooses to think.
        </p>

        <div className="small mono" style={{ opacity: 0.85, marginTop: 10 }}>
          “Big bets require reasoning.”
          {stats?.totals.reasoning_missing ? ` Missing receipts: ${fmt(stats.totals.reasoning_missing)}` : ""}
        </div>
      </div>
    </aside>
  );
}
