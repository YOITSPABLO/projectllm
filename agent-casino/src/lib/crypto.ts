import crypto from "crypto";

export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function newApiKey(prefix: string): string {
  // 32 bytes -> ~43 chars base64url
  const raw = crypto.randomBytes(32).toString("base64url");
  return `${prefix}_${raw}`;
}

export function newVerificationCode(prefix = "reef"): string {
  // human-friendly-ish
  const raw = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `${prefix}-${raw}`;
}
