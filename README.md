# Winter Emblem

A turn-based tactics RPG in the Fire Emblem mould, built for the browser.

**Current milestone: v1 — single-player wave-survival vs CPU.** Clear a wave of
enemies, pick a blessing, and face a tougher wave — repeat until your squad
falls. Multiplayer co-op is the next milestone; the rules layer is already
structured to make that a transport swap rather than a rewrite.

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
| `npm run bundle`  | After a build, inline it into one shareable `dist/winter-emblem.html` |

`npm run sim` is the quickest regression check: it drives waves with AI on
both sides, picking a blessing after each clear, until the squad wipes or 6
waves pass cleanly — failing loudly if neither happens.

## How to play

Command flow follows classic Fire Emblem, tuned for touch:

- **Tap one of your units** (blue) to select it. Reachable tiles light up blue;
  forest costs 2 movement, walls are impassable, enemies block movement.
- **Tap a tile to move there** — including the unit's own tile, to act without
  moving. A floating menu appears beside the unit showing only what's actually
  possible from that position: **Attack** (only if an enemy is in range) and
  **Wait**.
- **Tap Attack** to highlight valid targets in red, then tap one to preview the
  exchange — damage dealt, HP remaining, and counter damage — before **Confirm**
  commits it. **Cancel** backs out to target selection.
- **Tap Back** in the menu to undo the move entirely and reconsider — the unit
  returns to where it started, free to move again.
- **Wait** ends a unit's turn where it stands. The phase ends automatically once
  every unit has acted, or **End turn** (top of the screen) ends it early.
- **Enemy range** (top of the screen) paints every tile the CPU army can strike
  next phase.

Combat is deterministic in v1: damage is `Atk − (Def + terrain bonus)`, minimum 1.
A defender counterattacks if it survives and the attacker is within its own reach.

**Waves.** Clearing every enemy doesn't end the run — it pauses for a blessing
pick (a squad-wide +Atk, +Def, or full heal), then a new, tougher wave spawns
and the squad resets to their start tiles. Fallen units stay fallen for the
rest of the run; there's no separate permadeath toggle because a run only ever
has one life. The run ends when the whole squad is wiped.

**Leveling.** Every attack grants EXP to whoever threw it, win or lose;
reaching 100 EXP levels a unit up (atk/def/maxHp increase, and the unit heals
by the HP gained). The squad starts at level 5 — battle-tested from the
start — while enemies start at level 1 on wave 1 and level up wave-for-wave,
so the level gap only narrows as a run goes on.

## Project layout

```
src/game/     rules layer — no React, no rendering
  types.ts       state model and terrain table
  classes.ts     per-class base stats, the level/stat growth curve, EXP constants
  maps.ts        ASCII chapter definitions -> initial state
  grid.ts        Dijkstra movement range, attack/threat range
  combat.ts      damage and counterattack forecasting
  ai.ts          CPU decision-making (one action at a time, stateless)
  waves.ts       procedural enemy composition, wave-as-level difficulty scaling
  blessings.ts   squad-wide buffs offered after a wave clears
  game.ts        boardgame.io game definition: moves, phases, win conditions, EXP/leveling
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

## Deployment

Pushes to `main` build and deploy automatically to GitHub Pages via
`.github/workflows/deploy-pages.yml` — no server, no build step to run by hand.
One-time setup: in the repo's **Settings → Pages**, set **Source** to
**GitHub Actions**. After that the live build lives at
`https://<owner>.github.io/winteremblem/`.

The Vite `base` is set to `/winteremblem/` for production builds (see
`vite.config.ts`) to match that project-site URL; the dev server still runs at
the root.

## Credits

Terrain art is adapted from a third-party CC-BY pack; unit sprites are original
artwork drawn for this project. See [CREDITS.md](CREDITS.md).

## Roadmap

- v1 (current): wave-survival on one 6x8 map (portrait, matching Fire Emblem
  Heroes' grid size so the board fits a mobile viewport without horizontal
  scrolling). Squad is Lyn/Byleth/Corrin/Selva (one of each class) vs waves of
  randomly-classed, difficulty-scaled Bandits, local play
- Next: shop + equipment system (replacing/extending the simple blessing
  picks), Lancer and Mage sprites, Firebase Auth + Firestore save/resume
- Later: weapon triangle, more maps
- Later: online co-op for 5 players
