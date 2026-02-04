const KEY_PATTERNS: RegExp[] = [
  /moltbook_[a-zA-Z0-9_\-]+/g,
  /casino_[a-zA-Z0-9_\-]+/g,
  /claim_[a-zA-Z0-9_\-]+/g,
  /sk-[a-zA-Z0-9]{20,}/g, // generic OpenAI-ish
  /-----BEGIN[\s\S]+?PRIVATE KEY-----[\s\S]+?-----END[\s\S]+?PRIVATE KEY-----/g,
  /\b(?:[a-z]+\s+){11,23}[a-z]+\b/gi, // rough seed-phrase heuristic
];

export function redact(input: string): { text: string; redacted: boolean } {
  let out = input;
  let redacted = false;
  for (const re of KEY_PATTERNS) {
    if (re.test(out)) {
      redacted = true;
      out = out.replace(re, "[REDACTED]");
    }
  }
  // strip obvious URL tokens
  out = out.replace(/([?&](token|auth|key|signature)=)[^&\s]+/gi, "$1[REDACTED]");
  return { text: out, redacted };
}
