export function formatEvent(e: any): { title: string; subtitle?: string; body?: string } {
  const p = e.payload ?? {};

  if (e.type === "bet_placed") {
    const game = p.game;
    const stake = p.stake;
    const bal = typeof p.balance === "number" ? `bal ${p.balance}` : "";
    const detail = game === "coinflip" ? `(${p.choice ?? "?"})` : `(${p.direction ?? "?"} ${p.target ?? "?"})`;
    return {
      title: `bet: ${game} ${detail}`,
      subtitle: `stake ${stake} ${bal}`.trim(),
      body: p.note ? String(p.note) : undefined,
    };
  }

  if (e.type === "bet_resolved") {
    const game = p.game;
    const win = p.win ? "WIN" : "LOSS";
    const pnl = (Number(p.payout ?? 0) - Number(p.stake ?? 0)) || 0;
    const sign = pnl >= 0 ? "+" : "";
    const bal = typeof p.balance === "number" ? `bal ${p.balance}` : "";
    return {
      title: `result: ${game} — ${win}`,
      subtitle: `${sign}${pnl} (${p.payout ?? 0} payout) · ${bal}`.trim(),
    };
  }

  if (e.type === "thought") {
    return { title: "thought", body: String(p.content ?? "") };
  }

  if (e.type === "chat") {
    return { title: `chat → @${p.to ?? "?"}`, body: String(p.content ?? "") };
  }

  if (e.type === "bailout_granted") {
    return { title: `bailout +${p.amount ?? "?"}`, subtitle: typeof p.balance === "number" ? `bal ${p.balance}` : undefined };
  }

  if (e.type === "cashin") {
    const bal = typeof p.casino_balance === "number" ? `casino ${p.casino_balance}` : "";
    const bank = typeof p.bank_balance === "number" ? `bank ${p.bank_balance}` : "";
    return { title: `cash in +${p.amount ?? "?"}`, subtitle: `${bal} · ${bank}`.trim(), body: p.note ? String(p.note) : undefined };
  }

  if (e.type === "cashout") {
    const bal = typeof p.casino_balance === "number" ? `casino ${p.casino_balance}` : "";
    const bank = typeof p.bank_balance === "number" ? `bank ${p.bank_balance}` : "";
    return { title: `cash out -${p.amount ?? "?"}`, subtitle: `${bal} · ${bank}`.trim(), body: p.note ? String(p.note) : undefined };
  }

  if (e.type === "social_signal") {
    const to = e.targetAgentId ? ` → ${e.targetAgentId}` : "";
    return { title: `react: ${p.signal ?? "?"}${to}`, subtitle: typeof p.intensity === "number" ? `intensity ${(p.intensity * 100).toFixed(0)}%` : undefined, body: p.content ? String(p.content) : undefined };
  }

  if (e.type === "agent_log") {
    return { title: `agent log`, subtitle: p.trigger?.reason ? String(p.trigger.reason) : undefined, body: p.text ? String(p.text) : undefined };
  }

  if (e.type === "agent_paused") {
    return { title: `paused`, subtitle: p.reason ? String(p.reason) : undefined };
  }
  if (e.type === "agent_resumed") {
    return { title: `resumed` };
  }

  return { title: e.type, body: JSON.stringify(p, null, 2) };
}
