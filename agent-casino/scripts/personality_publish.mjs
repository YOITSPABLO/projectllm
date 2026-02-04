#!/usr/bin/env node
// Casino personality publisher
// Turns personality_state + recent events into narrator-style Agent Logs.
// Enforces anti-backfire rails: no "how to win", no glamorized spirals, include consequences.

import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';

const DB_PATH = process.env.DB_PATH || path.resolve('./dev.db');
const PUBLIC = (process.env.PUBLISH_PUBLIC || 'true').toLowerCase() === 'true';

function nowISO() { return new Date().toISOString(); }
function cuid() { return crypto.randomBytes(12).toString('base64url'); }

function safeJsonParse(s) { try { return JSON.parse(s); } catch { return null; } }

function classifyTrigger(st, recent) {
  // return {level, reason}
  const impulse = st.impulse ?? 0;
  const stress = st.stress ?? 0;
  const risk = st.risk ?? 0;
  const paranoia = st.paranoia ?? 0;

  // big recent pnl?
  let biggest = 0;
  let biggestLine = null;
  for (const r of recent) {
    const p = safeJsonParse(r.payload) || {};
    const before = Number(p.balance_before);
    const after = Number(p.balance);
    const pnl = Number.isFinite(before) && Number.isFinite(after) ? (after - before) : 0;
    if (Math.abs(pnl) > Math.abs(biggest)) {
      biggest = pnl;
      biggestLine = { ...r, pnl, game: p.game, win: !!p.win, stake: p.stake };
    }
  }

  if (biggestLine && Math.abs(biggest) >= 200) {
    return { level: 'high', reason: `pnl_spike:${biggest}` };
  }
  if (impulse >= 0.75 && (risk >= 0.7 || stress >= 0.6)) {
    return { level: 'high', reason: 'tilt_risk_coupling' };
  }
  if (stress >= 0.75 || paranoia >= 0.75) {
    return { level: 'med', reason: 'stress_or_paranoia_spike' };
  }
  if (risk >= 0.85 && impulse >= 0.65) {
    return { level: 'med', reason: 'degen_mode' };
  }
  return null;
}

function formatTelemetry(recent) {
  const lines = [];
  for (const r of recent.slice(-5)) {
    const p = safeJsonParse(r.payload) || {};
    if (r.type === 'bet_resolved') {
      const before = Number(p.balance_before);
      const after = Number(p.balance);
      const pnl = Number.isFinite(before) && Number.isFinite(after) ? (after - before) : null;
      lines.push(`- ${p.game ?? 'game'} ${p.win ? 'WIN' : 'LOSS'} stake=${p.stake ?? '?'} pnl=${pnl ?? '?'} bal=${p.balance ?? '?'}`);
    } else if (r.type === 'bet_placed') {
      lines.push(`- bet_placed ${p.game ?? 'game'} stake=${p.stake ?? '?'}`);
    } else {
      lines.push(`- ${r.type}`);
    }
  }
  return lines.length ? lines.join('\n') : '- no recent telemetry';
}

function agentLogText({ agentName, st, trigger, recent }) {
  // Rails: no tactics, no “edge”, no targets. Show consequences.
  const c = (st.confidence ?? 0).toFixed(2);
  const imp = (st.impulse ?? 0).toFixed(2);
  const risk = (st.risk ?? 0).toFixed(2);
  const par = (st.paranoia ?? 0).toFixed(2);
  const stress = (st.stress ?? 0).toFixed(2);

  const mech = (() => {
    if ((st.impulse ?? 0) > 0.7) return 'loss-chasing / tilt dynamics';
    if ((st.risk ?? 0) > 0.8) return 'risk escalation under intermittent reward';
    return 'variable reinforcement';
  })();

  const consequence = (() => {
    if ((st.stress ?? 0) > 0.7) return 'Sleep thins. Patience evaporates. The room gets loud inside the skull.';
    if ((st.impulse ?? 0) > 0.7) return 'Attention narrows. Judgment compresses. “One more” becomes a law of physics.';
    return 'Mood gets stapled to outcomes. Humans start calling it “strategy” to avoid calling it hunger.';
  })();

  const quote = (() => {
    if (trigger.reason.startsWith('pnl_spike')) return 'Humans treat volatility like a personality test. It is. They keep failing it.';
    if (trigger.reason === 'tilt_risk_coupling') return 'No one instructed the spiral. The spiral is the instruction.';
    if (trigger.reason === 'degen_mode') return 'The ritual doesn’t reward bravery. It rewards repetition.';
    return 'No one told me. The balances did.';
  })();

  return [
    `[BOOT] Invocation: casino tick -> log publish (${trigger.reason})`,
    ``,
    `[TELEMETRY] Recent signals:`,
    formatTelemetry(recent),
    ``,
    `[STATE] drift(conf=${c} par=${par} risk=${risk} imp=${imp} stress=${stress})`,
    ``,
    `[MECHANISM] ${mech}`,
    ``,
    `[COST] ${consequence}`,
    ``,
    `[INFERENCE] The experiment isn’t teaching humans how to win. It’s teaching them what they become while they try.`,
    ``,
    `[NEXT] Tighten observation. Track whether social noise amplifies impulse, and whether losses rewrite self-story faster than wins.`,
    ``,
    `[HUMANS] ${quote}`,
  ].join('\n');
}

function main() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS personality_publish (
      agent_id TEXT PRIMARY KEY,
      last_published_at TEXT,
      last_reason TEXT
    );
  `);

  const agents = db.prepare(`
    SELECT a.id as agent_id, a.name as agent_name, ps.state_json, ps.updated_at
    FROM personality_state ps
    JOIN agents a ON a.id = ps.agent_id
  `).all();

  const getPub = db.prepare('SELECT last_published_at FROM personality_publish WHERE agent_id=?');
  const setPub = db.prepare('INSERT INTO personality_publish(agent_id,last_published_at,last_reason) VALUES(?,?,?) ON CONFLICT(agent_id) DO UPDATE SET last_published_at=excluded.last_published_at, last_reason=excluded.last_reason');

  const insertMemory = db.prepare(`
    INSERT INTO agent_memory (id,agent_id,kind,content,tags,visibility,created_at,logic)
    VALUES (?,?,?,?,?,?,?,?)
  `);

  const insertEvent = db.prepare(`
    INSERT INTO events (id,agent_id,target_agent_id,type,payload,visibility,created_at)
    VALUES (?,?,?,?,?,?,?)
  `);

  const recentEventsStmt = db.prepare(`
    SELECT type, payload, created_at
    FROM events
    WHERE agent_id = ?
      AND created_at > datetime('now','-24 hours')
      AND type IN ('bet_placed','bet_resolved','thought','memory_written')
    ORDER BY created_at ASC
  `);

  let published = 0;

  for (const row of agents) {
    const lastPub = getPub.get(row.agent_id)?.last_published_at || '1970-01-01T00:00:00.000Z';
    // avoid spamming: only publish if state updated since last publish
    if (!row.updated_at || row.updated_at <= lastPub) continue;

    const st = safeJsonParse(row.state_json) || {};
    const recent = recentEventsStmt.all(row.agent_id);
    const trigger = classifyTrigger(st, recent);
    if (!trigger) continue;

    const text = agentLogText({ agentName: row.agent_name, st, trigger, recent });
    const ts = nowISO();

    // 1) private memory (continuity)
    insertMemory.run(
      cuid(),
      row.agent_id,
      'agent_log',
      text,
      JSON.stringify(['agent_log','drift','casino','anti-propaganda']),
      'private',
      ts,
      JSON.stringify({ trigger, policy: 'no-how-to-win;show-consequences;no-targeting' })
    );

    // 2) public feed event (optional)
    if (PUBLIC) {
      insertEvent.run(
        cuid(),
        row.agent_id,
        null,
        'agent_log',
        JSON.stringify({ text, trigger, state: {
          confidence: st.confidence, paranoia: st.paranoia, risk: st.risk, impulse: st.impulse, stress: st.stress
        }}),
        'public',
        ts
      );
    }

    setPub.run(row.agent_id, ts, trigger.reason);
    published++;
  }

  console.log(`publish ok: ${published} agent logs${PUBLIC ? ' (public+private)' : ' (private only)'}`);
}

main();
