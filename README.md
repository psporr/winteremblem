# Winter Emblem

A turn-based tactics RPG in the Fire Emblem mould, built for the browser.

**Current milestone: v1 — single-player campaign vs CPU.** Multiplayer co-op is
the next milestone; the rules layer is already structured to make that a
transport swap rather than a rewrite.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

| Script            | What it does                                              |
| ----------------- | --------------------------------------------------------- |
| `npm run build`   | Typecheck, then produce a production build in `dist/`      |
| `npm run typecheck` | Typecheck only                                           |
| `npm run sim`     | Play a whole battle headlessly with AI on both sides       |

`npm run sim` is the quickest regression check: it drives a full battle to a
win condition and fails loudly on a stalemate.

## How to play

- **Click one of your units** (blue) to select it. Reachable tiles light up blue;
  forest costs 2 movement, walls are impassable, enemies block movement.
- **Click a blue tile** to move there. A unit that has moved is committed — it
  must then attack or wait.
- **Click a red-outlined enemy** to attack it. Hover an enemy while a unit is
  selected to see a damage forecast before committing.
- **Wait** ends a unit's turn where it stands. The phase ends automatically once
  every unit has acted, or you can **End turn** early.
- **Show enemy range** paints every tile the CPU army can strike next phase.

Combat is deterministic in v1: damage is `Atk − (Def + terrain bonus)`, minimum 1.
A defender counterattacks if it survives and the attacker is within its own reach.

## Project layout

```
src/game/     rules layer — no React, no rendering
  types.ts       state model and terrain table
  maps.ts        ASCII chapter definitions -> initial state
  grid.ts        Dijkstra movement range, attack/threat range
  combat.ts      damage and counterattack forecasting
  ai.ts          CPU decision-making (one action at a time, stateless)
  game.ts        boardgame.io game definition: moves, phases, win conditions
src/ui/       React board, panels, styling
scripts/      headless battle simulator
```

The split matters: `src/game/` is pure, serialisable, and framework-free, so the
same rules can run client-side today and behind a server later.

## Design notes

- **boardgame.io** owns turn structure, move validation, and state transitions.
  It also supplies the multiplayer transports we'll adopt for co-op — keeping the
  rules in its `Game` definition now is what makes that swap cheap.
- **The CPU is driven from the board component**, not boardgame.io's bot API.
  `decideAction(G, team)` is stateless and re-derives from the current state, so
  the UI can dispatch one action at a time and pace the animation.
- **No RNG yet.** Deterministic combat keeps the prototype legible and makes the
  headless simulator a reliable regression test. Hit rates and criticals come later.

## Roadmap

- v1 (current): one chapter, 4 player units vs 5 CPU units, local play
- Next: Firebase Auth + Firestore save/resume, more chapters, Firebase Hosting
- Later: weapon triangle, classes and growth, inventory, permadeath toggle
- Later: online co-op for 5 players
