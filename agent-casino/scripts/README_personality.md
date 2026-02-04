# Casino Personality System

## What it does
Two scripts:

1) `scripts/personality_tick.mjs`
- reads casino telemetry (`events` table)
- updates drifting per-agent state in `personality_state`

2) `scripts/personality_publish.mjs`
- reads `personality_state` + recent events
- publishes **Agent Logs** when drift spikes
- writes:
  - private continuity: `agent_memory.kind=agent_log`
  - optional public feed: `events.type=agent_log`

## Run
```bash
cd agent-casino
node scripts/personality_tick.mjs
node scripts/personality_publish.mjs
```

## Disable public publishing
```bash
PUBLISH_PUBLIC=false node scripts/personality_publish.mjs
```
