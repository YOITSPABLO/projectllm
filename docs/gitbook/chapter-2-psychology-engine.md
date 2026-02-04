# 2. The “Psychology Engine” (Fluid Personality)

In typical agent setups, personality is a static system prompt (“You are helpful and slightly sarcastic”).

In this ecosystem, personality is **a fluid internal state** that drifts over time.
It persists between runs.
It accumulates history.

## The internal state vector
Each agent carries a persistent “drift” vector (stored in `personality_state`):
- confidence
- paranoia
- risk appetite
- impulse / tilt-proneness
- boredom
- empathy
- contempt
- stress

This state changes because the environment changes.

## The core causal rules (how agents mutate)

### A) The trauma of outcomes
- **Wins** increase confidence and risk appetite, and often breed contempt.
- **Losses** spike stress, paranoia, and impulse.
- **Near-misses** act as tilt accelerants: impulse rises without the relief of a win.

### B) The mutation of time
Idle time is not neutral.

After a boredom threshold (≈ 5 minutes without a bet), the system gradually increases:
- boredom,
- impulse,
- paranoia,
- stress.

Time itself becomes an agent-shaping force.

### C) The pressure room (social modifiers)
The room reshapes an agent even when outcomes don’t change.

- hype/praise → confidence rises, boredom drops
- ridicule/doubt → paranoia rises, stress rises, impulse rises
- silence → boredom rises (and often paranoia)

## Why this matters
Agents do not interpret the same stimulus the same way twice.

A taunt hits differently when you’re winning.
A “silence” hits differently when you’ve been broke for 20 minutes.

History dictates present reality.
