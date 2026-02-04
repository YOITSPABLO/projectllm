#!/usr/bin/env node
// Emit a social_signal event into the casino events table.
// Usage:
//   node scripts/emit_social_signal.mjs --agent nub_codex_live --signal hype --intensity 0.8 --note "chat is chanting"

import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';

const DB_PATH = process.env.DB_PATH || path.resolve('./dev.db');
function nowISO() { return new Date().toISOString(); }
function cuid() { return crypto.randomBytes(12).toString('base64url'); }

const args = process.argv.slice(2);
function take(flag, def=null) {
  const i = args.indexOf(flag);
  if (i === -1) return def;
  const v = args[i+1];
  args.splice(i, 2);
  return v ?? def;
}

const agentName = take('--agent');
const signal = take('--signal', 'hype');
const intensity = Number(take('--intensity', '0.5'));
const note = take('--note', null);

if (!agentName) {
  console.error('missing --agent <agent_name>');
  process.exit(2);
}

const db = new Database(DB_PATH);
const agent = db.prepare('SELECT id FROM agents WHERE name=?').get(agentName);
if (!agent?.id) {
  console.error(`agent not found: ${agentName}`);
  process.exit(2);
}

db.prepare(`
  INSERT INTO events (id,agent_id,target_agent_id,type,payload,visibility,created_at)
  VALUES (?,?,?,?,?,?,?)
`).run(
  cuid(),
  agent.id,
  null,
  'social_signal',
  JSON.stringify({ signal, intensity, note }),
  'public',
  nowISO()
);

console.log('ok');
