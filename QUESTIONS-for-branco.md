# Questions from the overnight run — 29 August 2026

Written down rather than asked, as instructed. Nothing here blocked me; each
is a judgement call I made one way and would happily change.

## 1. Which day does the time strip belong to?

The strip builds its day from the *device's* calendar day (`clock.now`'s local
date), while the clock label and the forecast series are in the *circuit's*
timezone. At a circuit those are the same day and it does not matter. Planning
Suzuka from the Netherlands they can differ by one, and the strip would then
show tomorrow's weather marks against today's light.

I left the existing behaviour alone rather than change what the strip means as
a side effect of adding marks. **Should the strip switch to circuit-local
throughout?** I think yes, but it changes what the whole control means, so it
wants your call.

## 2. The tree line and the archive edge (D7 / D8 in TASKS-map-sky.md)

Still open and still one decision, not two. Trees stop at the circuit corridor
and the vector archive stops at a rectangle; both edges were invisible while
the corridor mask covered them and both are visible now that 3D turns it off.

The options are in TASKS-map-sky.md. The one I would pick is fading scenery out
with distance rather than widening the data, because widening triples a scatter
that is already ~10k features. **But it is your map and your phone.**

## 3. Graphics presets — what should Low actually turn off?

I have built the settings framework (F8). What each preset *means* is a
judgement about your device and your priorities, and I have guessed:

- **Low** — no scenery, no rain, no stars, hillshade off
- **Medium** — scenery, no rain, stars, hillshade
- **High** — everything

Say the word if Low should still keep trees, or if rain matters more than
scenery to you.
