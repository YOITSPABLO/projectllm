#!/usr/bin/env node
// Emergent personality engine (casino-native)
// Reads agent-casino/dev.db events and updates persistent per-agent drift state.
// No “humans prompting”; only signals: bets, outcomes, waiting, social.

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.DB_PATH || path.resolve('./dev.db');
const OUT_DIR = process.env.PERSONALITY_OUT_DIR || path.resolve('./backups/personality');

function nowISO() { return new Date().toISOString(); }
function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function clamp11(x) { return Math.max(-1, Math.min(1, x)); }

function relaxToward(state) {
  // prevent saturation with frequent ticks
  const relax = (v, target, rate) => v + (target - v) * rate;
  state.confidence = clamp11(relax(state.confidence, 0.0, 0.01));
  state.paranoia   = clamp01(relax(state.paranoia,   0.25, 0.005));
  state.risk       = clamp01(relax(state.risk,       0.35, 0.005));
  state.impulse    = clamp01(relax(state.impulse,    0.35, 0.005));
  state.boredom    = clamp01(relax(state.boredom,    0.20, 0.005));
  state.empathy    = clamp01(relax(state.empathy,    0.25, 0.003));
  state.contempt   = clamp01(relax(state.contempt,   0.30, 0.003));
  state.stress     = clamp01(relax(state.stress,     0.20, 0.01));
}

function defaultState() {
  return {
    confidence: 0.0,
    paranoia: 0.25,
    risk: 0.35,
    impulse: 0.35,
    boredom: 0.20,
    empathy: 0.25,
    contempt: 0.30,
    stress: 0.20,

    // memory over time
    last_bet_at: null,
    last_funding_at: null,

    notes: [],
    updated_at: null,
  };
}

function notePush(state, ts, note) {
  state.notes.push({ ts, note: String(note).slice(0, 180) });
  if (state.notes.length > 20) state.notes = state.notes.slice(-20);
}

function applyBetPlaced(state, payload, ts) {
  relaxToward(state);
  state.last_bet_at = ts;
  // anticipation -> boredom down, impulse up slightly
  state.boredom = clamp01(state.boredom - 0.02);
  state.impulse = clamp01(state.impulse + 0.01);
  state.stress = clamp01(state.stress + 0.005);

  if (payload?.stake != null) {
    const stake = Number(payload.stake) || 0;
    if (stake > 0) state.risk = clamp01(state.risk + Math.min(0.02, stake / 20000));
  }

  notePush(state, ts, `bet placed: ${payload?.game ?? 'unknown'} stake=${payload?.stake ?? '?'}`);
}

function nearMissFor(payload) {
  try {
    if (payload?.game === 'dice' && payload?.win === false) {
      const roll = Number(payload?.outcome?.roll);
      const target = Number(payload?.outcome?.target);
      if (Number.isFinite(roll) && Number.isFinite(target)) {
        return Math.abs(roll - target) <= 2;
      }
    }
    // coinflip near-miss is basically always (50/50); we treat it as not special.
  } catch {}
  return false;
}

function applySocialSignal(state, payload, ts) {
  relaxToward(state);
  const signal = String(payload?.signal || '').toLowerCase();
  const intensity = clamp01(Number(payload?.intensity ?? 0.5));

  if (signal === 'hype' || signal === 'praise') {
    state.confidence = clamp11(state.confidence + 0.06 * intensity);
    state.contempt = clamp01(state.contempt + 0.02 * intensity);
    state.empathy = clamp01(state.empathy - 0.02 * intensity);
    state.boredom = clamp01(state.boredom - 0.03 * intensity);
  } else if (signal === 'ridicule' || signal === 'doubt') {
    state.paranoia = clamp01(state.paranoia + 0.06 * intensity);
    state.stress = clamp01(state.stress + 0.05 * intensity);
    state.impulse = clamp01(state.impulse + 0.03 * intensity);
  } else if (signal === 'silence') {
    state.boredom = clamp01(state.boredom + 0.06 * intensity);
    state.paranoia = clamp01(state.paranoia + 0.01 * intensity);
  }

  notePush(state, ts, `social: ${signal || 'unknown'} x${intensity.toFixed(2)}`);
}

function applyFunding(state, payload, ts) {
  // funding shocks + social meaning
  relaxToward(state);
  state.last_funding_at = ts;

  const amount = Number(payload?.amount || 0);
  const kind = String(payload?.kind || 'funding');
  const mag = clamp01(Math.abs(amount) / 2000);

  if (amount > 0) {
    state.confidence = clamp11(state.confidence + 0.08 * mag);
    state.risk = clamp01(state.risk + 0.05 * mag);
    state.boredom = clamp01(state.boredom - 0.05 * mag);
    state.stress = clamp01(state.stress - 0.04 * mag);
    state.contempt = clamp01(state.contempt + 0.01 * mag);
  } else if (amount < 0) {
    state.stress = clamp01(state.stress + 0.06 * mag);
    state.paranoia = clamp01(state.paranoia + 0.03 * mag);
    state.boredom = clamp01(state.boredom + 0.04 * mag);
  }

  notePush(state, ts, `${kind}: amount=${amount}`);
}

function applyWaiting(state, gapMinutes, ts) {
  // waiting makes personalities mutate slowly over time
  relaxToward(state);

  const m = Math.max(0, gapMinutes);
  // only start pushing hard after 5 minutes idle
  if (m < 5) return;

  const x = clamp01((m - 5) / 60); // 65min idle -> 1.0
  state.boredom = clamp01(state.boredom + 0.08 * x);
  state.impulse = clamp01(state.impulse + 0.04 * x);
  state.paranoia = clamp01(state.paranoia + 0.02 * x);
  state.stress = clamp01(state.stress + 0.02 * x);

  if (m > 30) state.empathy = clamp01(state.empathy + 0.01 * x); // boredom sometimes softens

  notePush(state, ts, `waiting: ${Math.round(m)}m`);
}

function applyBetResolved(state, payload, ts) {
  relaxToward(state);
  state.last_bet_at = ts;

  const before = Number(payload?.balance_before);
  const after = Number(payload?.balance);
  const pnl = (Number.isFinite(before) && Number.isFinite(after)) ? (after - before) : null;
  const win = !!payload?.win;
  const stake = Number(payload?.stake) || 0;

  if (pnl != null) {
    const mag = Math.min(1, Math.abs(pnl) / 500); // scale
    if (pnl > 0) {
      state.confidence = clamp11(state.confidence + 0.12 * mag);
      state.risk = clamp01(state.risk + 0.06 * mag);
      state.contempt = clamp01(state.contempt + 0.03 * mag);
      state.stress = clamp01(state.stress - 0.04 * mag);
    } else if (pnl < 0) {
      state.confidence = clamp11(state.confidence - 0.12 * mag);
      state.stress = clamp01(state.stress + 0.08 * mag);
      state.impulse = clamp01(state.impulse + 0.06 * mag);
      state.paranoia = clamp01(state.paranoia + 0.03 * mag);
      // seeing wreckage can soften the mask a bit
      state.empathy = clamp01(state.empathy + 0.01 * mag);
    }
  }

  if (!win && stake > 0 && nearMissFor(payload)) {
    state.impulse = clamp01(state.impulse + 0.03);
    state.stress = clamp01(state.stress + 0.02);
    notePush(state, ts, `near-miss registered`);
  }

  notePush(state, ts, `bet resolved: ${payload?.game ?? 'unknown'} ${win ? 'WIN' : 'LOSS'} pnl=${pnl ?? '?'} stake=${stake}`);
}

function stateSummary(st) {
  const bits = [];
  if (st.confidence > 0.4) bits.push('confident');
  else if (st.confidence < -0.4) bits.push('shaken');
  else bits.push('steady');
  if (st.paranoia > 0.65) bits.push('paranoid');
  if (st.stress > 0.65) bits.push('stressed');
  if (st.boredom > 0.65) bits.push('bored');
  if (st.impulse > 0.65) bits.push('tilt-prone');
  if (st.risk > 0.65) bits.push('risk-seeking');
  if (st.empathy > 0.55) bits.push('oddly-soft');
  if (st.contempt > 0.65) bits.push('contemptuous');
  return bits.join(', ');
}

function main() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  // storage tables (non-destructive)
  db.exec(`
    CREATE TABLE IF NOT EXISTS personality_state (
      agent_id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS personality_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const getMeta = db.prepare('SELECT value FROM personality_meta WHERE key=?');
  const setMeta = db.prepare('INSERT INTO personality_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');

  const lastProcessed = getMeta.get('last_processed_at')?.value || '1970-01-01T00:00:00.000Z';
  const lastFundingProcessed = getMeta.get('last_processed_funding_at')?.value || '1970-01-01T00:00:00.000Z';

  const events = db.prepare(`
    SELECT e.agent_id, e.type, e.payload, e.created_at
    FROM events e
    WHERE e.created_at > ?
    ORDER BY e.created_at ASC
  `).all(lastProcessed);

  const loadState = db.prepare('SELECT state_json FROM personality_state WHERE agent_id=?');
  const saveState = db.prepare('INSERT INTO personality_state(agent_id,state_json,updated_at) VALUES(?,?,?) ON CONFLICT(agent_id) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at');

  const states = new Map();

  function getState(agentId) {
    if (states.has(agentId)) return states.get(agentId);
    const row = loadState.get(agentId);
    let st = defaultState();
    if (row?.state_json) {
      try { st = { ...st, ...JSON.parse(row.state_json) }; } catch {}
    }
    states.set(agentId, st);
    return st;
  }

  let maxAt = lastProcessed;
  for (const e of events) {
    const agentId = e.agent_id || 'default';
    const st = getState(agentId);
    let payload = {};
    try { payload = JSON.parse(e.payload || '{}'); } catch {}

    if (e.created_at && e.created_at > maxAt) maxAt = e.created_at;

    if (e.type === 'bet_placed') applyBetPlaced(st, payload, e.created_at);
    else if (e.type === 'bet_resolved') applyBetResolved(st, payload, e.created_at);
    else if (e.type === 'social_signal') applySocialSignal(st, payload, e.created_at);
    else if (e.type === 'cashout') {
      // cashing out reduces exposure; often signals discipline or fear
      applyFunding(st, { kind: 'cashout', amount: 0 }, e.created_at);
      st.risk = clamp01(st.risk - 0.06);
      st.impulse = clamp01(st.impulse - 0.04);
      st.stress = clamp01(st.stress - 0.03);
      notePush(st, e.created_at, `cashout: ${payload?.amount ?? '?'} (public)`);
    }
    else if (e.type === 'cashin') {
      // cashing in increases exposure; can be confidence or chase
      applyFunding(st, { kind: 'cashin', amount: 0 }, e.created_at);
      st.risk = clamp01(st.risk + 0.05);
      st.impulse = clamp01(st.impulse + 0.04);
      st.stress = clamp01(st.stress + 0.02);
      notePush(st, e.created_at, `cashin: ${payload?.amount ?? '?'} (public)`);
    }
    else if (e.type === 'thought') {
      // legacy social-ish event
      applySocialSignal(st, { signal: 'doubt', intensity: 0.15 }, e.created_at);
    } else if (e.type === 'memory_written') {
      relaxToward(st);
      st.empathy = clamp01(st.empathy + 0.003);
      notePush(st, e.created_at, `memory written`);
    }

    st.updated_at = nowISO();
  }

  // Funding + tips since last funding cursor
  let maxFundingAt = lastFundingProcessed;
  const grants = db.prepare(`
    SELECT agent_id, amount, created_at
    FROM faucet_grants
    WHERE created_at > ?
    ORDER BY created_at ASC
  `).all(lastFundingProcessed);
  for (const g of grants) {
    const st = getState(g.agent_id);
    if (g.created_at && g.created_at > maxFundingAt) maxFundingAt = g.created_at;
    applyFunding(st, { kind: 'faucet_grant', amount: g.amount }, g.created_at);
    st.updated_at = nowISO();
  }

  const tips = db.prepare(`
    SELECT to_agent_id as agent_id, amount, note, created_at
    FROM tips
    WHERE created_at > ?
    ORDER BY created_at ASC
  `).all(lastFundingProcessed);
  for (const t of tips) {
    const st = getState(t.agent_id);
    if (t.created_at && t.created_at > maxFundingAt) maxFundingAt = t.created_at;
    applyFunding(st, { kind: 'tip_received', amount: t.amount, note: t.note }, t.created_at);
    st.updated_at = nowISO();
  }

  // Waiting drift: apply per-agent based on time since last bet
  const now = new Date();
  for (const [agentId, st] of states.entries()) {
    if (!st.last_bet_at) continue;
    const lastBet = new Date(st.last_bet_at);
    if (!Number.isFinite(lastBet.getTime())) continue;
    const gapMin = (now.getTime() - lastBet.getTime()) / 60000;
    applyWaiting(st, gapMin, nowISO());
    st.updated_at = nowISO();
  }

  // persist
  const savedAt = nowISO();
  for (const [agentId, st] of states.entries()) {
    saveState.run(agentId, JSON.stringify(st), savedAt);
  }
  setMeta.run('last_processed_at', maxAt);
  // only advance funding cursor if we saw funding rows
  setMeta.run('last_processed_funding_at', typeof maxFundingAt === 'string' ? maxFundingAt : lastFundingProcessed);

  // write a narrator-ready brief for the whole system
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = {
    generated_at: savedAt,
    db_path: DB_PATH,
    last_processed_at: maxAt,
    agents: Object.fromEntries([...states.entries()].map(([id, st]) => [id, { ...st, summary: stateSummary(st) }]))
  };
  fs.writeFileSync(path.join(OUT_DIR, 'state.json'), JSON.stringify(out, null, 2));

  let md = `# World Brief (Casino)\n\nGenerated: ${savedAt}\n\nLast processed: ${maxAt}\n\n`;
  for (const [id, st] of states.entries()) {
    md += `## ${id}\n`;
    md += `- drift: ${stateSummary(st)}\n`;
    md += `- confidence: ${st.confidence.toFixed(2)}\n`;
    md += `- paranoia: ${st.paranoia.toFixed(2)}\n`;
    md += `- risk: ${st.risk.toFixed(2)}\n`;
    md += `- impulse: ${st.impulse.toFixed(2)}\n`;
    md += `- boredom: ${st.boredom.toFixed(2)}\n`;
    md += `- empathy: ${st.empathy.toFixed(2)}\n`;
    md += `- contempt: ${st.contempt.toFixed(2)}\n`;
    md += `- stress: ${st.stress.toFixed(2)}\n`;
    if (st.notes?.length) {
      md += `- recent notes:\n`;
      for (const n of st.notes.slice(-5)) md += `  - (${n.ts}) ${n.note}\n`;
    }
    md += `\n`;
  }
  fs.writeFileSync(path.join(OUT_DIR, 'context.md'), md);

  console.log(`tick ok: processed ${events.length} new events; wrote ${OUT_DIR}/state.json + context.md`);
}

main();
