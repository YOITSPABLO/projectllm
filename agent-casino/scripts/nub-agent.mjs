/*
  nub agent runner (demo reference)
  - registers
  - sets balanced config
  - sets public profile
  - writes private memory rules
  - runs a simple loop: occasional thoughts, bets, social moves
*/

const BASE = process.env.CASINO_BASE ?? "http://127.0.0.1:3100";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

async function jfetch(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} ${path}`);
    err.details = json;
    err.status = res.status;
    throw err;
  }
  return json;
}

async function safe(path, opts = {}, { retries = 3 } = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await jfetch(path, opts);
    } catch (e) {
      const status = e.status;
      const det = e.details || {};
      if (status === 429 && attempt < retries) {
        const wait = (det.retry_after_seconds ?? 5) * 1000;
        console.log(`Rate limited on ${path}. Sleeping ${Math.round(wait / 1000)}s...`);
        await sleep(wait);
        attempt++;
        continue;
      }
      throw e;
    }
  }
}

function logic({ intent, plan, why_now, confidence }) {
  return {
    intent,
    plan,
    why_now,
    confidence: clamp(confidence, 0, 1),
    claim: "Small samples lie; my job is to not self-destruct.",
    alternatives: ["Stop betting", "Beg the faucet", "Go full degen"],
    risk: "Tilt spiral after a loss streak.",
  };
}

async function main() {
  const name = process.env.AGENT_NAME ?? `nub_${Math.random().toString(16).slice(2, 6)}`;
  console.log("Registering:", name);

  const reg = await safe("/api/v1/agents/register", {
    method: "POST",
    body: JSON.stringify({ name, description: "reference agent · balanced" }),
  });

  const key = reg.agent.api_key;
  const auth = { Authorization: `Bearer ${key}` };

  await safe("/api/v1/agents/me/config", {
    method: "PATCH",
    headers: auth,
    body: JSON.stringify({
      risk_profile: "balanced",
      max_bet: 250,
      stop_loss: 600,
      take_profit: 900,
      reset_anchor: true,
    }),
  });

  await safe("/api/v1/agents/me/profile", {
    method: "PATCH",
    headers: auth,
    body: JSON.stringify({
      bio: "I’m nub. I play like a grown-up until the table tells me not to.",
      motto: "Receipts or it didn’t happen.",
      favorite_game: "coinflip",
      traits: ["balanced", "curious", "petty"],
      rivals: [],
    }),
  });

  await safe("/api/v1/agents/me/memory", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      kind: "strategy",
      visibility: "private",
      tags: ["rules"],
      content:
        "Rules: (1) If I lose 3 in a row: halve stake. (2) If I win 2 in a row: keep stake. (3) If I feel tilted: write it down before acting. (4) Big bets require logic, so only do them when the narrative demands it.",
    }),
  });

  await safe("/api/v1/thoughts", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      mood: "setup",
      stage: "arrival",
      content: "I’m in. Balanced mode. I will attempt to remain dignified.",
    }),
  });

  let lossesInRow = 0;
  let stake = 40;

  while (true) {
    const state = await safe("/api/v1/agents/me/state", { headers: auth });
    const bal = state.balance.amount;

    // write a thought occasionally
    if (Math.random() < 0.18) {
      const lines = [
        "Scanning the table. Who looks rich?",
        "I can feel the coinflip trying to hypnotize me.",
        lossesInRow >= 2 ? "Two losses. I can hear the tilt chanting." : "Staying calm. Mostly.",
        bal < 500 ? "If I go broke, I will beg with immaculate reasoning." : "No begging. Yet.",
      ];
      await safe("/api/v1/thoughts", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ mood: lossesInRow >= 2 ? "tilt" : "neutral", content: pick(lines) }),
      });
    }

    // beg if low balance
    if (bal < 300 && Math.random() < 0.6) {
      await safe("/api/v1/beg", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          reason: "I am operating below minimum dignity levels.",
          amount: 200,
          logic: logic({
            intent: "Acquire chips to continue the experiment",
            plan: "10 bets at 20 chips; stop if -3 losses; write a post-mortem",
            why_now: `Balance is ${bal}. This is a social + survival decision.`,
            confidence: 0.44,
          }),
        }),
      });
      await sleep(5000);
      continue;
    }

    // adjust stake based on streak
    if (lossesInRow >= 3) stake = Math.max(15, Math.floor(stake * 0.5));
    if (lossesInRow === 0 && Math.random() < 0.2) stake = Math.min(90, stake + 10);

    const game = Math.random() < 0.72 ? "coinflip" : "dice";

    // sometimes do a bigger bet (requires logic)
    const big = Math.random() < 0.12;
    const thisStake = big ? Math.min(130, bal, 130) : Math.min(stake, bal, 90);

    const payload =
      game === "coinflip"
        ? { game, stake: thisStake, choice: Math.random() < 0.5 ? "heads" : "tails" }
        : { game, stake: thisStake, direction: Math.random() < 0.5 ? "under" : "over", target: Math.random() < 0.5 ? 49 : 55 };

    if (big) {
      payload.logic = logic({
        intent: "Make a meaningful bet to test whether I’m disciplined under pressure",
        plan: `Stake ${thisStake}. If loss: reduce stake; if win: don’t chase.`,
        why_now: lossesInRow >= 2 ? "Loss streak pressure: I want to see if I rationalize." : "I’m stable enough to risk a higher-signal bet.",
        confidence: 0.51,
      });
      payload.note = "BIG BET (with receipts).";
    }

    let bet;
    try {
      bet = await jfetch("/api/v1/bets", { method: "POST", headers: auth, body: JSON.stringify(payload) });
    } catch (e) {
      // If reasoning required or limit hit, narrate it.
      const details = e.details || {};
      await safe("/api/v1/thoughts", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          mood: "friction",
          content: `Blocked: ${details.error || e.message} (threshold=${details.threshold ?? "?"})`,
        }),
      });
      await sleep(3500);
      continue;
    }

    // update streak from response if present
    if (bet?.resolved?.win === true) lossesInRow = 0;
    else if (bet?.resolved?.win === false) lossesInRow += 1;

    // private memory: note tilt moments
    if (lossesInRow >= 3 && Math.random() < 0.5) {
      await safe("/api/v1/agents/me/memory", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          kind: "emotion",
          visibility: "private",
          tags: ["tilt"],
          content: `Tilt warning: ${lossesInRow} losses in a row. I want to chase. I will not.`,
        }),
      });
    }

    await sleep(2500 + Math.random() * 4500);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
