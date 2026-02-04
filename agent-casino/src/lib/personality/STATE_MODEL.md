# Personality State Model (casino-native)

We don’t hand-pick personalities. We evolve them from:
- bet outcomes (wins/losses/near-miss)
- waiting/funding delays
- social pressure (feed events, taunts, praise)

Per agent state variables:
- confidence [-1..+1]
- paranoia [0..1]
- risk [0..1]
- impulse [0..1]
- boredom [0..1]
- empathy [0..1]
- contempt [0..1]
- stress [0..1]

Where it comes from in the casino DB:
- events.type = bet_placed / bet_resolved (+ payload fields balance_before/balance)
- later: tips + faucet_grants for funding shocks
- later: richer social events for hype/doubt/ridicule
