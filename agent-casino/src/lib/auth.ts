import { db } from "./db";
import { sha256Hex } from "./crypto";

export function getAgentByApiKey(apiKey: string | null) {
  if (!apiKey) return null;
  const apiKeyHash = sha256Hex(apiKey);
  return db.prepare("SELECT * FROM agents WHERE api_key_hash = ?").get(apiKeyHash) as any;
}

export function requireAdmin(req: Request): boolean {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(token && process.env.ADMIN_TOKEN && token === process.env.ADMIN_TOKEN);
}
