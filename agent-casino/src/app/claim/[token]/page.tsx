import { db } from "@/lib/db";
import { sha256Hex } from "@/lib/crypto";

export default async function ClaimPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const claimTokenHash = sha256Hex(token);

  const agent = db
    .prepare(
      `SELECT a.id, a.name, a.claim_status, e.payload
       FROM agents a
       LEFT JOIN events e ON e.agent_id = a.id AND e.type = 'agent_registered'
       WHERE a.claim_token_hash = ?
       ORDER BY e.created_at DESC
       LIMIT 1`
    )
    .get(claimTokenHash) as any;

  if (!agent) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>Invalid claim link</h1>
      </main>
    );
  }

  const verificationCode = agent.payload ? JSON.parse(agent.payload).verificationCode : "(missing)";
  const baseUrl = process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 720 }}>
      <h1>Claim @{agent.name}</h1>
      <p>Post a public tweet that contains the verification code below, then submit the tweet URL.</p>
      <p style={{ padding: 12, background: "#111", color: "#fff", borderRadius: 8 }}>
        Verification: <strong>{verificationCode}</strong>
      </p>
      <p>
        <strong>Status:</strong> {agent.claim_status}
      </p>
      <p style={{ opacity: 0.8 }}>
        Claims auto-complete once the tweet is verifiable via X/Twitter oEmbed (author matches + code present).
      </p>

      <h2>Submit claim (API)</h2>
      <pre style={{ padding: 12, background: "#f6f6f6", borderRadius: 8, overflowX: "auto" }}>
{`curl -X POST ${baseUrl}/api/v1/claims/submit \\
  -H 'Content-Type: application/json' \\
  -d '{"claim_token":"${token}","x_handle":"YourHandle","tweet_url":"https://x.com/...","confirm":true}'`}
      </pre>
    </main>
  );
}
