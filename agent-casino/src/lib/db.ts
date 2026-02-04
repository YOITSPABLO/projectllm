import Database from "better-sqlite3";
import crypto from "crypto";

const dbPath = process.env.DB_PATH ?? "./dev.db";

export const db = new Database(dbPath);

db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  api_key_hash TEXT NOT NULL UNIQUE,
  claim_token_hash TEXT NOT NULL UNIQUE,
  x_handle TEXT,
  claim_tweet_url TEXT,
  claim_status TEXT NOT NULL DEFAULT 'pending_claim',
  claimed_at TEXT,
  is_paused INTEGER NOT NULL DEFAULT 0,
  paused_reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS balances (
  agent_id TEXT PRIMARY KEY,
  amount INTEGER NOT NULL DEFAULT 10000,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

-- Long-term capital held outside the casino bankroll
CREATE TABLE IF NOT EXISTS bank_balances (
  agent_id TEXT PRIMARY KEY,
  amount INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

-- Movement between casino and bank (risk management telemetry)
CREATE TABLE IF NOT EXISTS transfers (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  direction TEXT NOT NULL, -- cashin|cashout
  amount INTEGER NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

-- Faucet state is armed when total wealth hits 0.
CREATE TABLE IF NOT EXISTS faucet_state (
  agent_id TEXT PRIMARY KEY,
  zeroed_at TEXT NOT NULL,
  available_at TEXT NOT NULL,
  last_claimed_at TEXT,
  FOREIGN KEY(agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_configs (
  agent_id TEXT PRIMARY KEY,
  risk_profile TEXT NOT NULL DEFAULT 'degen',
  max_bet INTEGER NOT NULL DEFAULT 250,
  stop_loss INTEGER,
  take_profit INTEGER,
  anchor_balance INTEGER,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_profiles (
  agent_id TEXT PRIMARY KEY,
  bio TEXT,
  motto TEXT,
  favorite_game TEXT,
  traits TEXT, -- JSON array
  rivals TEXT, -- JSON array of agent names
  updated_at TEXT NOT NULL,
  FOREIGN KEY(agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_memory (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT, -- JSON array
  visibility TEXT NOT NULL DEFAULT 'private',
  created_at TEXT NOT NULL,
  logic TEXT, -- JSON reasoning receipts
  FOREIGN KEY(agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tips (
  id TEXT PRIMARY KEY,
  from_agent_id TEXT NOT NULL,
  to_agent_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(from_agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  FOREIGN KEY(to_agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS faucet_grants (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  target_agent_id TEXT,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'public',
  created_at TEXT NOT NULL,
  FOREIGN KEY(agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS fair_state (
  agent_id TEXT PRIMARY KEY,
  server_seed TEXT NOT NULL,
  server_seed_hash TEXT NOT NULL,
  nonce INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(agent_id) REFERENCES agents(id) ON DELETE CASCADE
);
`);

// Lightweight migrations for dev DBs.
try {
  db.prepare("ALTER TABLE agent_memory ADD COLUMN logic TEXT").run();
} catch {
  // column already exists
}

export function nowIso() {
  return new Date().toISOString();
}

export function cuid() {
  // good enough for MVP
  return crypto.randomBytes(12).toString("base64url");
}
