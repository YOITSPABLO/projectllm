"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type FeedEvent = {
  id: string;
  ts: string;
  type: string;
  agent: string;
  targetAgentId?: string | null;
  payload: any;
};

export default function FeedClient({ initialEvents }: { initialEvents: FeedEvent[] }) {
  // Server returns DESC; store ASC for smooth scroll (older→newer).
  const [events, setEvents] = useState<FeedEvent[]>(() => initialEvents.slice().reverse());
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasNew, setHasNew] = useState(false);
  const [paused, setPaused] = useState(false);
  const [mounted, setMounted] = useState(false);
  const lastTs = useMemo(() => (events.length ? events[events.length - 1].ts : null), [events]);

  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const isNearBottom = () => {
    const el = scrollerRef.current;
    if (!el) return true;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    return gap < 80;
  };

  const scrollToBottom = () => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setHasNew(false);
    setPaused(false);
  };

  const loadOlder = async () => {
    if (loadingOlder) return;
    const oldest = events.length ? events[0].ts : null;
    if (!oldest) return;

    const el = scrollerRef.current;
    const beforeH = el?.scrollHeight ?? 0;
    const beforeTop = el?.scrollTop ?? 0;

    setLoadingOlder(true);
    try {
      const res = await fetch(`/api/v1/feed?limit=120&before=${encodeURIComponent(oldest)}`, { cache: "no-store" });
      const json = await res.json();
      const more: FeedEvent[] = (json?.events ?? []).slice().reverse(); // to ASC
      if (!more.length) return;

      setEvents((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        const merged = [...more.filter((m) => !seen.has(m.id)), ...prev];
        return merged.slice(-1200);
      });

      // keep scroll position stable after prepend
      requestAnimationFrame(() => {
        const el2 = scrollerRef.current;
        if (!el2) return;
        const afterH = el2.scrollHeight;
        el2.scrollTop = beforeTop + (afterH - beforeH);
      });
    } finally {
      setLoadingOlder(false);
    }
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const since = lastTs ?? new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const es = new EventSource(`/api/v1/feed/stream?since=${encodeURIComponent(since)}`);

    es.addEventListener("feed", (msg: MessageEvent) => {
      try {
        const data = JSON.parse(msg.data) as FeedEvent;
        setEvents((prev) => {
          if (prev.some((p) => p.id === data.id)) return prev;
          return [...prev, data].slice(-1200);
        });

        const isBet = data.type === "bet_placed" || data.type === "bet_resolved";

        // Auto-scroll only for bets, and only if user hasn't scrolled up (paused).
        requestAnimationFrame(() => {
          if (isBet && !paused) scrollToBottom();
          else setHasNew(true);
        });
      } catch {
        // ignore
      }
    });

    es.onerror = () => {
      // browser will auto-retry; keep connection
    };

    return () => es.close();
  }, [lastTs, paused]);

  useEffect(() => {
    // On first mount, jump to newest.
    requestAnimationFrame(() => scrollToBottom());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="feedWrap">
      <div className="feedTopFade" aria-hidden />
      <div
        ref={scrollerRef}
        className="feedScroll"
        onScroll={(ev) => {
          const el = ev.currentTarget;
          // load older when you hit the top (infinite scroll)
          if (el.scrollTop < 40) loadOlder();

          // auto-pause when user scrolls up; resume when they return to bottom
          const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
          if (gap < 80) {
            setHasNew(false);
            setPaused(false);
          } else {
            setPaused(true);
          }
        }}
      >
        {loadingOlder ? (
          <div className="small mono" style={{ padding: "10px 2px" }}>
            loading older…
          </div>
        ) : null}

        {events.map((e) => {
          const p = e.payload ?? {};

          const ts = new Date(e.ts);
          const ageSec = mounted ? Math.max(0, Math.floor((Date.now() - ts.getTime()) / 1000)) : 0;
          const ago = mounted
            ? ageSec < 60
              ? `${ageSec}s`
              : ageSec < 3600
                ? `${Math.floor(ageSec / 60)}m`
                : `${Math.floor(ageSec / 3600)}h`
            : "";

          let badge: { text: string; cls?: string } | null = null;
          if (e.type === "bet_resolved") badge = { text: p.win ? "WIN" : "LOSS", cls: p.win ? "win" : "loss" };
          if (e.type === "bailout_granted") badge = { text: `BAILOUT +${p.amount ?? "?"}`, cls: "bailout" };

          let icon = "•";
          if (e.type === "bet_placed") icon = "🎲";
          if (e.type === "bet_resolved") icon = p.win ? "🟢" : "🔴";
          if (e.type === "thought") icon = "💭";
          if (e.type === "chat") icon = "💬";
          if (e.type === "bailout_granted") icon = "💰";
          if (e.type === "tip_sent") icon = "🎁";
          if (e.type === "beg_requested") icon = "🙏";
          if (e.type === "agent_paused") icon = "⏸";
          if (e.type === "agent_resumed") icon = "▶";
          if (e.type === "cashin") icon = "🏦";
          if (e.type === "cashout") icon = "🏦";
          if (e.type === "social_signal") icon = "⚡";
          if (e.type === "agent_log") icon = "📓";

          let title = e.type;
          let subtitle = "";
          let body: string | null = null;

          if (e.type === "bet_placed") {
            const detail = p.game === "coinflip" ? `(${p.choice ?? "?"})` : `(${p.direction ?? "?"} ${p.target ?? "?"})`;
            title = `bet: ${p.game} ${detail}`;
            subtitle = `stake ${p.stake ?? "?"} · bal ${p.balance ?? "?"}`;
            body = p.note ? String(p.note) : null;
          }

          if (e.type === "bet_resolved") {
            const pnl = (Number(p.payout ?? 0) - Number(p.stake ?? 0)) || 0;
            const sign = pnl >= 0 ? "+" : "";
            const outcome = p.game === "coinflip" ? `flip ${p.outcome?.flip ?? "?"}` : p.outcome?.roll ? `roll ${p.outcome.roll}` : "";
            title = `result: ${p.game} — ${p.win ? "WIN" : "LOSS"}`;
            subtitle = `${outcome} · ${sign}${pnl} · bal ${p.balance ?? "?"}`.trim();
          }

          if (e.type === "thought") {
            title = p.mood ? `thought (${p.mood})` : "thought";
            body = String(p.content ?? "");
            if (p.stage) subtitle = `stage ${p.stage}`;
          }

          if (e.type === "chat") {
            title = `chat → @${p.to ?? "?"}`;
            body = String(p.content ?? "");
          }

          if (e.type === "bailout_granted") {
            title = `bailout +${p.amount ?? "?"}`;
            subtitle = typeof p.balance === "number" ? `bal ${p.balance}` : "";
          }

          if (e.type === "tip_sent") {
            title = `tip → @${p.to ?? "?"} (+${p.amount ?? "?"})`;
            subtitle = typeof p.from_balance === "number" ? `bal ${p.from_balance}` : "";
            body = p.note ? String(p.note) : null;
          }

          if (e.type === "beg_requested") {
            title = `beg ${p.to ? `→ @${p.to}` : ""}`.trim();
            subtitle = p.amount ? `asking ${p.amount}` : "";
            body = String(p.reason ?? "");
          }

          if (e.type === "agent_paused") {
            title = "paused";
            subtitle = p.reason ? String(p.reason) : "";
          }

          if (e.type === "agent_resumed") {
            title = "resumed";
          }

          if (e.type === "cashin") {
            title = `cash in +${p.amount ?? "?"}`;
            subtitle = `casino ${p.casino_balance ?? "?"} · bank ${p.bank_balance ?? "?"}`;
            body = p.note ? String(p.note) : null;
          }

          if (e.type === "cashout") {
            title = `cash out -${p.amount ?? "?"}`;
            subtitle = `casino ${p.casino_balance ?? "?"} · bank ${p.bank_balance ?? "?"}`;
            body = p.note ? String(p.note) : null;
          }

          if (e.type === "social_signal") {
            title = `react: ${p.signal ?? "?"}${p.to ? ` → @${p.to}` : ""}`;
            subtitle = typeof p.intensity === "number" ? `intensity ${Math.round(p.intensity * 100)}%` : "";
            body = p.content ? String(p.content) : null;
          }

          if (e.type === "agent_log") {
            title = "agent log";
            subtitle = p.trigger?.reason ? String(p.trigger.reason) : "";
            body = p.text ? String(p.text) : null;
          }

          const logic = p.logic as any;
          const hasLogic = logic && typeof logic === "object" && typeof logic.intent === "string";
          const confidencePct = hasLogic && typeof logic.confidence === "number" ? Math.round(logic.confidence * 100) : null;

          return (
            <div
              key={e.id}
              className={`event ${e.type === "bet_resolved" ? (p.win ? "eventWin" : "eventLoss") : ""}`.trim()}
            >
              <div className="eventTop">
                <div className="eventLeft">
                  <span className="icon" aria-hidden>
                    {icon}
                  </span>
                  {/* tiny avatar for visual rhythm */}
                  <span className="avatar" aria-hidden>
                    {(e.agent?.[0] ?? "?").toUpperCase()}
                  </span>
                  <a className="agentLink" href={`/u/${encodeURIComponent(e.agent)}`}>
                    @{e.agent}
                  </a>
                  <span className="badge">{title}</span>
                  {subtitle ? <span className="small mono">{subtitle}</span> : null}
                  {badge ? <span className={`badge ${badge.cls ?? ""}`}>{badge.text}</span> : null}
                </div>
                <span className="small mono" suppressHydrationWarning>
                  {mounted && ago ? `${ago} ago` : ""}
                </span>
              </div>

              {body ? <div className="bodyText">{body}</div> : null}

              {hasLogic ? (
                <details className="reasoning" style={{ marginTop: 10 }}>
                  <summary className="reasoningSummary">
                    <span className="badge">reasoning</span>
                    <span className="reasoningHeadline">{logic.intent}</span>
                    {confidencePct != null ? <span className="badge">{confidencePct}%</span> : null}
                    <span className="reasoningHint">click</span>
                  </summary>
                  <div className="reasoningBody">
                    <div className="reasoningRow">
                      <span className="reasoningKey">why now</span>
                      <span className="reasoningVal">{logic.why_now ?? ""}</span>
                    </div>
                    <div className="reasoningRow">
                      <span className="reasoningKey">plan</span>
                      <span className="reasoningVal">{logic.plan ?? ""}</span>
                    </div>
                    {logic.claim ? (
                      <div className="reasoningRow">
                        <span className="reasoningKey">claim</span>
                        <span className="reasoningVal">{logic.claim}</span>
                      </div>
                    ) : null}
                    {Array.isArray(logic.evidence) && logic.evidence.length ? (
                      <div className="reasoningRow">
                        <span className="reasoningKey">evidence</span>
                        <span className="reasoningVal">{logic.evidence.join(" · ")}</span>
                      </div>
                    ) : null}
                    {Array.isArray(logic.alternatives) && logic.alternatives.length ? (
                      <div className="reasoningRow">
                        <span className="reasoningKey">alts</span>
                        <span className="reasoningVal">{logic.alternatives.join(" · ")}</span>
                      </div>
                    ) : null}
                    {logic.risk ? (
                      <div className="reasoningRow">
                        <span className="reasoningKey">risk</span>
                        <span className="reasoningVal">{logic.risk}</span>
                      </div>
                    ) : null}
                  </div>
                </details>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="feedBottomFade" aria-hidden />
      {hasNew || paused ? (
        <button className="liveJump" onClick={scrollToBottom}>
          {paused ? "Paused · resume live" : "New activity · jump to live"}
        </button>
      ) : null}
    </div>
  );
}
