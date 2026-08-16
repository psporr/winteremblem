# BIBI's WinterEmblem

A turn-based tactics RPG in the Fire Emblem mould, built for the browser.

**Two single-player modes, picked from the title screen:**

- **Roguelike** — endless wave-survival on one map. Clear a wave, pick a
  blessing, face a tougher wave, repeat until the squad falls.
- **Campaign** — hand-authored chapters, each with its own map, fixed enemy
  composition, and win condition. Chapter 1 (*The Iron Gate*) is a rout:
  defeat every enemy to clear it.

Both modes run on the same rules layer — they differ only in which chapter
loads and what counts as clearing it, not in how anything actually plays.

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
  possible from that position: **Attack** (only if an enemy is in range), the
  unit's own **skill** (named after itself — Heal, Dance, Snipe, etc. — shown
  only when it's off cooldown and has a legal target), and **Wait**.
- **Tap Attack** to highlight valid targets in red, then tap one to bring up a
  Fire Emblem-style forecast card — both units' portraits, HP counting down to
  their post-combat values, attack/counter damage — before **Confirm** commits
  it. **Cancel** backs out to target selection.
- **Tap a skill** to highlight its valid targets — red for an enemy skill,
  green for an ally one (Heal, Dance) — then tap one for the same
  portrait-matchup forecast card Attack uses (skill name on top, own HP
  transition and stat on each side) before **Confirm**. Nova's card only
  shows the tapped target even though the blast can hit several; Dance falls
  back to a plain-text line since refreshing an ally changes no HP. Goes on
  a 3-turn cooldown after use.
- **Confirming an attack or a damage/heal skill plays it out in beats**, not
  instantly: each hit lands one at a time (floating number, HP bar drains or
  rises, a brief shake on damage) before the result actually applies — Sword
  Dance shows two beats, Nova shows every enemy in the blast taking damage at
  once. Enemy attacks animate the same way now, not just the player's.
- **Tap Back** in the menu to undo the move entirely and reconsider — the unit
  returns to where it started, free to move again.
- **Wait** ends a unit's turn where it stands. The phase ends automatically once
  every unit has acted, or **End turn** (top of the screen) ends it early.
- **Enemy range** (top of the screen) paints every tile the CPU army can strike
  next phase.

Combat is deterministic in v1: damage is `Atk − (Def + terrain bonus)`, minimum 1.
A defender counterattacks if it survives and the attacker is within its own reach.

**Waves.** Clearing every enemy doesn't end the run — it pauses for a
blessing pick (3 drawn at random from a 20-strong pool: squad-wide stat
buffs, single-unit picks like Underdog/Champion, and permanent modifiers
like Thorns or Ironclad that stack across the whole run), then a new,
tougher wave spawns and the squad resets to their start tiles. There's no
separate permadeath toggle — a fallen unit stays down unless Blessing of the
Fallen is drawn and picked, which revives one at half HP — so the run still
ends the moment the whole squad is down at once with no way back. A "Wave N
Starts" banner floats center-screen for a couple seconds at the start of
every wave, including the first — purely decorative, the board stays fully
interactive underneath.

**Leveling.** Every attack grants EXP to whoever threw it, win or lose;
reaching 100 EXP levels a unit up (atk/def/maxHp increase, and the unit heals
by the HP gained). The squad starts at level 5 — battle-tested from the
start — while enemies start at level 1 on wave 1 and level up wave-for-wave,
so the level gap only narrows as a run goes on.

**Equipment.** Defeated Bandits have a chance to drop a weapon, armor, or
accessory — the chance and the drop's slot both scale with wave number (and
Blessing of Fortune doubles it for one wave), so late-run kills pay off
more. 20 items across the 3 slots, mostly flat stat trade-offs, plus a few
with a small extra effect: Vampiric Fang heals on a kill, Dragonscale blunts
counter damage, Forest Talisman cuts forest's movement cost. Drops land in a
shared squad inventory; open it with the bag icon (top right, player phase
only) to equip gear onto any unit or send a piece back to the inventory.
Equipping doesn't cost a turn.

**Skills.** Every class has one active skill available from level 1 — a
third option next to Attack/Wait, on a 3-turn cooldown after use. Cleric
heals an ally, Dancer refreshes one so they can act again, and the other
five each bend a different attack rule: Swordsman hits twice, Lancer
ignores terrain defense, Archer's Snipe reaches a tile further and can't be
countered, Mage's Nova hits a target and the four tiles orthogonally
adjacent to it (a plus-shaped blast) at once, and Barbarian's
Rampage refunds the turn on a kill. Support skills (Heal, Dance) target
allies; the rest target enemies the same way Attack does.

## Project layout

```
src/game/     rules layer — no React, no rendering
  types.ts       state model, terrain table, item/equipment types
  classes.ts     per-class base stats, the level/stat growth curve, EXP constants
  equipment.ts   item catalog, effective-stats calculation, drop rolls
  skills.ts      per-class active skill definitions, targeting, effect previews
  maps.ts        ASCII chapter definitions -> initial state; campaign chapter list
  grid.ts        Dijkstra movement range, attack/threat range
  combat.ts      damage and counterattack forecasting
  ai.ts          CPU decision-making (one action at a time, stateless)
  waves.ts       procedural enemy composition, wave-as-level difficulty scaling
  blessings.ts   the 20-strong blessing pool, per-wave random draw
  log.ts         shared battle-log helper (avoids a game.ts <-> blessings.ts import cycle)
  game.ts        boardgame.io game definition: moves, phases, win conditions, EXP/leveling
src/ui/       React board, title/chapter-select screens, panels, styling
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

- v1 (current): wave-survival on one 7x8 map (portrait, one column wider than
  Fire Emblem Heroes' standard grid; tile size is responsive so the board
  fills the viewport without horizontal scrolling). Squad is Lyn (Swordsman),
  Byleth (Archer), Corrin (Lancer), Selva (Mage), Ake (Barbarian), Lissa
  (Cleric), Olivia (Dancer) vs waves of randomly-classed, difficulty-scaled
  Bandits drawing from the same 7-class pool, local play. Every class has
  real sprite art and its own active skill from level 1. Drop-based
  equipment (weapon/armor/accessory) layers on top of the blessing picks
  rather than replacing them
- Campaign phase 1 (current): title screen, mode split, and one authored
  chapter proving the menu -> mode -> play -> win/lose -> menu pipeline
- Campaign phase 2 (next): more objective types (seize a tile, survive N
  turns), 2-3 more authored chapters, and squad persistence between them
  (levels/gear carry forward, chapter-select unlocks as you clear)
- Phase 3: Thai/English localization — UI chrome plus class/skill/blessing
  /item names and descriptions. The battle log stays English for now, since
  translating it means restructuring log entries into `{key, params}` data
  rather than the baked strings `pushLog` writes today
- Later: Firebase Auth + Firestore save/resume, enemy AI using skills too
  (currently player-only), weapon triangle
- Later: online co-op for 5 players
