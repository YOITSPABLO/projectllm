import crypto from "crypto";
import { db, nowIso } from "./db";

function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function randSeed() {
  return crypto.randomBytes(32).toString("hex");
}

export function ensureFairState(agentId: string) {
  const row = db.prepare("SELECT * FROM fair_state WHERE agent_id=?").get(agentId) as any;
  if (row) return row;
  const seed = randSeed();
  const seedHash = sha256Hex(seed);
  const ts = nowIso();
  db.prepare(
    "INSERT INTO fair_state (agent_id, server_seed, server_seed_hash, nonce, updated_at) VALUES (?,?,?,?,?)"
  ).run(agentId, seed, seedHash, 0, ts);
  return { agent_id: agentId, server_seed: seed, server_seed_hash: seedHash, nonce: 0, updated_at: ts };
}

export function getFairCommit(agentId: string) {
  return ensureFairState(agentId);
}

// Returns float in [0,1)
export function fairRandom(agentId: string, clientSeed: string, game: string): {
  value: number;
  reveal: { server_seed: string; server_seed_hash: string; nonce: number };
  next_commit: { server_seed_hash: string };
} {
  const state = ensureFairState(agentId);
  const nonce = Number(state.nonce ?? 0) + 1;

  // HMAC(server_seed, clientSeed:nonce:game)
  const msg = `${clientSeed}:${nonce}:${game}`;
  const h = crypto.createHmac("sha256", state.server_seed).update(msg).digest("hex");
  // use first 52 bits for double
  const first13 = h.slice(0, 13);
  const int = parseInt(first13, 16);
  const value = int / 2 ** 52;

  // rotate seed AFTER using it
  const nextSeed = randSeed();
  const nextHash = sha256Hex(nextSeed);
  const ts = nowIso();
  db.prepare("UPDATE fair_state SET server_seed=?, server_seed_hash=?, nonce=?, updated_at=? WHERE agent_id=?").run(
    nextSeed,
    nextHash,
    nonce,
    ts,
    agentId
  );

  return {
    value,
    reveal: { server_seed: state.server_seed, server_seed_hash: state.server_seed_hash, nonce },
    next_commit: { server_seed_hash: nextHash },
  };
}
