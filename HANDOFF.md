# Handoff: WinterEmblem → Phaser 4 rebuild

This document exists to carry the **design, rules, and hard-won lessons** of
the WinterEmblem prototype into a fresh project built on **Phaser 4**. It is
deliberately *not* a porting guide — most of the old rendering code should be
thrown away, and this document says which parts and why.

**Read this first, then ignore the old repo's UI layer entirely.**

Source project: `psporr/winteremblem` (React + TypeScript + Vite +
boardgame.io, CSS-grid board). Roughly 5,600 lines, ~26 versions, playable and
deployed. It proved the design works; it also proved the rendering approach
was the wrong long-term foundation.

---

## 1. How to use this document

The new project has two knowledge sources that complement each other:

| Source | Covers |
| --- | --- |
| **Phaser's own 28 official skills** (`github.com/phaserjs/phaser/skills/`) | *How the engine works* — scenes, tweens, particles, tilemaps, cameras, input, audio, physics, filters. Standard Agent Skills format, so Claude Code picks them up natively. |
| **This document** | *What we are building and what we already learned* — game rules, content, conventions, and the specific bugs that cost real time. |

Do not ask Phaser's skills about the game design, and do not ask this document
how to write a tween. Copy Phaser's `skills/` folder into the new repo (e.g.
`.claude/skills/phaser/`) so any session working there has both.

---

## 2. The game

A **turn-based tactics RPG** in the Fire Emblem lineage: a grid battlefield,
one squad of named units versus a CPU army, alternating team phases, movement
constrained by terrain cost, combat resolved on contact with counterattacks.

Working title was *BIBI's WinterEmblem*; the rename in progress leans toward
something ending in **"Tactics"** (candidates: *Frostmarch Tactics*, *Iron
Gate Tactics*). Pick the final name before scaffolding, since it lands in
`package.json`, the title screen, and the repo name.

### Two modes, one rule set

Both modes share **every** rule below. They differ only in how a battle
starts and what counts as clearing it. This was a deliberate and successful
design decision — keep it.

- **Roguelike** — endless wave survival on a single 7×8 map. Clearing a wave
  pauses for a **blessing** pick (a permanent run-wide buff), then spawns a
  bigger wave. Ends only when the squad wipes. No story.
- **Campaign** — hand-authored chapters, each with its own map, fixed enemy
  composition, objective, and dialogue. Squad carries level/exp/equipment
  between chapters. Progress saves to `localStorage`.

---

## 3. Rules reference

This section is the actual design. It is worth reimplementing faithfully —
these numbers were playtested and balanced, and the headless simulator (§6)
was used to confirm the roguelike loop survives 7+ waves.

### Classes

Seven classes. A unit's class fully determines its base stats — player and
enemy units of the same class share identical numbers, so balance lives in one
table.

| Class | HP | Atk | Def | Move | Range |
| --- | --- | --- | --- | --- | --- |
| Swordsman | 24 | 9 | 5 | 3 | 1 |
| Archer | 18 | 8 | 3 | 3 | 2 |
| Lancer | 22 | 8 | 6 | 3 | 1 |
| Mage | 16 | 9 | 2 | 3 | 2 |
| Barbarian | 27 | 11 | 3 | 3 | 1 |
| Cleric | 18 | 6 | 4 | 3 | 1 |
| Dancer | 16 | 6 | 2 | 4 | 1 |

### Levelling

- Flat growth per level, same curve for every class: **+1 Atk, +1 Def, +2 max HP**.
- Move and range never scale with level — this keeps map pacing intact as the
  squad grows.
- `EXP_TO_LEVEL = 100`. Gains: **attack 20, kill 50, heal 50**.
- Only the player squad earns exp; enemy stats are fixed by wave/chapter.
- A level-up heals by the max-HP gained, so levelling never feels like a step back.
- Player squad starts at **level 5**; a fresh wave-1 enemy is level 1.
- In campaign Chapter Select, a directly-picked chapter starts the squad at
  `5 + chapterIndex` so jumping to a later chapter isn't under-levelled.

### Combat

Deterministic — **no hit rate, no random crits**. This was a conscious v1 call
that made the game readable and the AI honest; revisit only deliberately.

```
damage = attacker.atk - (defender.def + terrainDefBonus)
damage = max(1, damage)          // never zero; prevents unbreakable stalls
```

- **Counterattack**: the defender strikes back if the attacker is within the
  *defender's* range. A killing blow prevents any counter.
- All damage flows through one `computeDamage` / `computeCounterDamage` /
  `forecastCombat` trio. `forecastCombat` is **pure** and is used by *both*
  the UI preview panel and the enemy AI — so the number the player is shown
  can never disagree with what actually happens. Preserve this property.

### Terrain

| Type | Move cost | Passable | Def bonus |
| --- | --- | --- | --- |
| Plain | 1 | yes | 0 |
| Forest | 2 | yes | +2 |
| Wall | — | no | — |
| Water | — | no | — |

Movement is **Dijkstra over move costs**, Fire Emblem rules: allied units can
be passed *through* but not landed on; enemy units block entirely. A unit that
has already moved is pinned to its tile.

Maps are authored as **ASCII art** (`.` plain, `f` forest, `#` wall, `w`
water) — this was excellent for iteration and should absolutely be kept, even
though Phaser has a proper Tilemap system. Consider ASCII → Tiled JSON at
build time, keeping ASCII as the authoring format.

### Skills

One signature active skill per class, usable from level 1, **3-turn cooldown**.
Designed so each breaks a *different* rule rather than being a stat tweak:

| Class | Skill | Effect |
| --- | --- | --- |
| Cleric | Heal | Restore `atk + 4` HP to an ally in range |
| Dancer | Dance | Refresh an ally who already acted — they move and act again |
| Swordsman | Sword Dance | Two hits on one target in a single action |
| Lancer | Guard Break | Attack ignoring the target's terrain def bonus |
| Archer | Snipe | +1 range, +4 damage, target cannot counter |
| Mage | Nova | Plus-shaped 5-tile blast, ×0.6 damage each |
| Barbarian | Rampage | Normal attack; **a kill refunds the turn** |

### Equipment

Three slots per unit — weapon / armor / accessory — from a shared squad
inventory. Items only modify atk/def/move/range plus a few special effects
(kill-heal, counter-reduction, forest move cost). **No item touches max HP** —
reconciling current-HP against a changing max on every equip/unequip is
bookkeeping that isn't worth it. Keep that rule.

Drops roll on enemy death: `chance = min((0.25 + wave × 0.03) × fortuneMult, 0.9)`.

### Blessings (roguelike only)

20 blessings, drawn 3 at a time after each wave clear. Each is a function
taking the whole game state, not a per-unit shape — some buff the squad, some
target one unit, some bump a running modifier total. That generality was the
right call after the original 3-blessing design outgrew its per-unit shape.

Running modifiers worth knowing about (they touch combat math):
`counterBonus` (Thorns), `cooldownReduction` (Focus), `healPerTurn` (Mending),
`terrainDefMultiplier` (Ironclad), `executionerBonus`, `guardianAngelCharges`,
`dropChanceMultiplier` (Fortune).

### Turn structure

- Two sides: player `'0'`, enemy `'1'`.
- On turn begin: reset `hasMoved`/`hasActed` for that team, tick down skill
  cooldowns, apply per-turn regen.
- Turn **ends automatically** once every unit on the active side has acted.
- Battle ends: squad wipe → defeat, always. Objective `rout` → victory when
  the last enemy falls. Objective `waves` never ends in victory.

### Enemy AI

Deliberately **stateless** — it re-derives its decision from the game state on
every call and returns *one* action, so the caller can dispatch one action at
a time and animate between them. This is a good pattern; keep it.

Scoring: `damage × 10`, `+1000` for a kill, `−500` if the counter would kill
the attacker, `−counterDamage`, `+2 × damage already taken` (finish the
wounded). No attack available → move toward the nearest enemy. Nothing
reachable → wait.

**The AI is team-agnostic** (`decideAction(state, team)`), which is what made
the "Auto-play the player's turn" feature nearly free. Preserve that.

---

## 4. Campaign content

Three maps exist and are worth carrying over:

- **The Frozen Pass** — 7×8, roguelike, wave survival.
- **Chapter 1: The Iron Gate** — 7×8, rout. Wall band splits the field into
  two chokepoints; a stream and ford.
- **Chapter 2: The Long March** — 11×14, rout. Three bands of wall with gaps
  at centre and flanks, two river crossings.

Squad: Eirika (Swordsman), Byleth (Archer), Corrin (Lancer), Selva (Mage),
Ike (Barbarian), Lissa (Cleric), Olivia (Dancer).

**Enemy naming rule**: roguelike enemies are anonymous — display name is always
`"<Class> Shadow"`. Campaign enemies keep their authored names (Gate Chief,
Vale Captain), because chapters carry story around named individuals.

### Story system

Chapters carry optional `intro` / `outro` dialogue scripts plus mid-battle
**map events**. Four trigger types, all implemented and working:

- `turnReached` — per-team and 1-indexed ("enemy turn 2" = the second time it
  becomes the enemy's phase, not the second global turn). Authors think in
  team turns; honour that.
- `unitDefeated` — a named unit dies.
- `unitReachesTile` — any (optionally team-filtered) unit steps on a tile.
- `enemyCountAtMost` — objective progress.

A firing beat **genuinely pauses** the CPU, not just visually overlays it.
Trigger evaluation is a pure function (`isTriggerMet`) kept separate from the
UI.

**Story data lives outside the synced game state** — it's presentation, not
rules, and doesn't need to be deterministic or network-replicated. This matters
for multiplayer (§8).

---

## 5. What worked — keep these

### A pure, deterministic game core

`src/game/` never imports from `src/ui/`. Everything in it is pure logic over
a plain, JSON-serialisable state object. This paid off repeatedly:

- The headless simulator could drive full battles with no browser.
- The same `forecastCombat` served the UI and the AI with zero drift.
- Multiplayer stays viable without a rewrite (§8).

**In Phaser, keep this line even harder.** Phaser makes it tempting to hang
game logic off sprites. Don't — sprites should *read* game state, never own it.

### The headless simulator

`npm run sim` runs a complete AI-vs-AI battle in the terminal, printing the
log. It caught balance and softlock problems in seconds that would have taken
many minutes of clicking. **Build this in the new project on day one**, before
any rendering. It is the single highest-leverage piece of tooling in the old
repo.

### ASCII map authoring

See §3. Trivial to eyeball, diff, and hand-edit.

### Programmatic map validation

Before shipping any map change, a script verified via BFS that no passable
tile is isolated and that every authored unit spawn lands on passable ground.
A water tile dropped on a spawn point would otherwise silently brick that unit.
**Automate this again** — it caught real problems.

---

## 6. What to leave behind — do not port

| Old approach | Why it's wrong for Phaser | Use instead |
| --- | --- | --- |
| CSS-grid board, `background-position` sprite slicing | Fighting the browser layout engine for something a game engine does natively; source of *every* hard bug in §7 | Phaser Tilemaps + Camera |
| Hand-rolled canvas particle system (~230 lines) | Reimplements a solved problem | Phaser particle emitters |
| `setTimeout`-driven animation "beats" | Fires in catch-up bursts after main-thread stalls; reads as sped-up animation | Phaser tweens + timeline |
| Manual board shake / crit flash / phase tint | Bespoke CSS keyframes per effect | Phaser camera shake/flash/fade, filters |
| Custom zoom (two discrete tile sizes, measured in JS) | Enormous complexity; see §7 | Phaser camera zoom |
| Web Audio wrapper (~270 lines) | Hand-built pooling, gain trim, retrigger guard | Phaser sound manager |

That table is roughly **1,200 lines of code that Phaser deletes**. The game
logic (~1,500 lines) is what actually carries over.

### Open decision: keep boardgame.io?

boardgame.io currently provides turn/phase management, immutable state via
immer, move validation, and — importantly — a **multiplayer transport**.
Phaser is a *renderer*; it does not overlap with any of that, so the two
compose cleanly.

- **Keep it** if multiplayer (§8) is a near-term priority — the transport is
  the hard part and it's already solved.
- **Drop it** if you'd rather own a small custom state machine; the turn logic
  here is genuinely simple (~40 lines), and boardgame.io's React bindings
  become dead weight without React.

Decide this early — it shapes the whole project skeleton. Leaning: **keep it**,
given the multiplayer plan, but wire it to Phaser directly rather than through
its React client.

---

## 7. Hard-won lessons

These cost real time. Most are *not* Phaser-specific — they're about process.

### Rendering

- **CSS custom properties fail silently.** An invalid-at-computed-value-time
  inherited property falls back to the inherited value instead of erroring.
  A board sized by a CSS formula rendered at the wrong size while *believing*
  it was correct. Phaser sidesteps this entirely — one more reason for the move.
- **WebKit is inconsistent** about `calc()` division by `var()`, nested `min()`
  in `calc()`, `dvh` units, and cached intrinsic sizes.
- **iOS viewport**: `visualViewport.height` ≠ `innerHeight` ≠ `100dvh`. The
  toolbar-collapsed viewport is taller than what's actually visible.
- **A three-attempt bug**: after a zoom round-trip the board stayed scrollable
  into empty space. Two fixes targeting the *sizing math* both failed. The fix
  that worked stopped trying to make the engine report the right size and
  instead made scrolling structurally impossible when the whole board fits.
  **Lesson: when two fixes at the same layer fail, change layers.**

### Animation & audio

- 33 `HTMLAudioElement`s with main-thread `currentTime = 0` seeks stalled the
  main thread; `setTimeout` beats then fired in catch-up bursts. Rewriting on
  **Web Audio** (decoded buffers + `AudioBufferSourceNode`) took latency from
  18–31 ms to 0–1 ms. Phaser's sound manager does this correctly by default.
- Clips from different packs are mastered up to **8× apart** in loudness. Apply
  per-cue gain trim rather than re-encoding.
- **Simultaneous identical cues clip harshly** — a 5-tile Nova blast starting
  five copies of one clip sums to 5× amplitude. Guard with a retrigger window
  (~40 ms).

### Testing discipline — the important one

- **A silent-failure bug shipped because the test suite structurally could not
  catch it.** Audio was completely inaudible (a `Number(null) === 0` volume
  bug), but the browser tests ran with `--mute-audio` and an autoplay override.
  The tests passed. The user reported "I hear no sound."
  **Assert on the actual observable outcome, not on a proxy for it.**
- Same pattern again with the scroll bug: tests asserted on `scrollWidth`,
  which was *the very number suspected of being stale*. The fix was to test by
  **attempting an actual scroll** and asserting it didn't move.
- **Verify at more than one viewport.** A layout regression shipped because the
  only tested width (390px) happened to be the one where two wrong numbers
  coincided. It broke at 430px.

### Deployment discipline

- **"Pushed" is not "shipped."** Two consecutive GitHub Pages 503s meant builds
  succeeded and deploys silently failed. The user reported still seeing an old
  version. Since then the rule has been: **poll the live site until the served
  asset hash matches the local build** before claiming anything is live. Keep
  this rule.

### Process

- The user repeatedly and correctly asked for **discussion before
  implementation** on anything with design weight. Propose, name the tradeoff,
  get a decision, then build.
- **Ask when a formula or layout choice is genuinely ambiguous** rather than
  guessing — a wrong guess costs a full build/verify/deploy cycle.

---

## 8. Planned: multiplayer

**Not yet built, explicitly deferred** ("let's do that later because I want to
keep polishing single player first, but let's keep it in mind when
designing"). The design has been kept multiplayer-ready throughout:

- Game state is **plain JSON-serialisable data** — no class instances, no
  functions, no `Map`/`Set` in the synced state.
- Game logic is **pure and deterministic** — same inputs, same outputs, so a
  server and client agree.
- Randomness goes through an **injected random API**, never `Math.random()`
  directly. This is what makes deterministic replay/sync possible — preserve it.
- **Presentation state is deliberately separate** from synced state: popups,
  banners, dialogue progress, camera, auto-play toggle, fired story events.
  None of that should ever enter the network payload.

Earlier discussion considered **Firebase/Firestore** for hosting. boardgame.io
also ships its own client/server transport (§6). Either works; the decision
interacts with the boardgame.io question above.

**Design implications to respect from day one:**
- Never let a Phaser sprite own authoritative state.
- Keep the "one action at a time, animate between" pattern — it maps directly
  onto receiving remote moves.
- Keep AI stateless so it can run server-side for PvE-vs-AI or fill-in players.

## 9. Planned: mobile app

**Also future work.** The intent is to ship this as a **native mobile app**,
not only a web page. Phaser 4 + **Capacitor** is the standard path to iOS and
Android from an HTML5 codebase.

The old project was already mobile-first and learned some of this the hard way:

- **Portrait-first.** Every map is portrait-oriented (7×8, 11×14) specifically
  to suit a phone screen. Keep that constraint.
- **Touch-first input.** Everything is tap-driven; there is no hover-dependent
  interaction, and hover is treated as a bonus rather than a requirement.
- **The viewport lessons in §7 are mobile lessons** — Phaser's ScaleManager
  handles most of this properly, but respect safe-area insets on notched
  devices.
- **Tap targets** need a comfortable minimum size; the tile size floor
  (20 px in the old build) existed for exactly this reason.
- Asset budget matters more in an app bundle than on the web — Phaser's
  texture atlas tooling is worth using from the start rather than retrofitting.

Worth deciding early, since it affects the skeleton: **build web-first and wrap
later**, or **target Capacitor from day one**. Wrapping later is usually fine
if you avoid browser-only APIs in game logic — which the pure-core rule
(§5) already enforces.

---

## 10. Working conventions worth keeping

- **Comments explain *why*, not *what*.** The old codebase's comments are
  unusually load-bearing — they record the reasoning behind non-obvious
  choices ("deliberately NOT `width: max-content` because…"). This paid off
  every time someone returned to that code. Keep the standard.
- **Semantic versioning on every change**: patch for fixes, minor for features.
- **Verify before claiming.** Typecheck + build + sim + a real browser check,
  then confirm the deployed asset actually changed.
- **Attribution is tracked** in `CREDITS.md` — every third-party asset with its
  licence and source. Current: SSCAP tileset (CC-BY 3.0), Kenney SFX (CC0),
  original unit sprites (drawn by a friend, no external licence).
- **Clean up scratch files** — test scripts and scratch dirs never get committed.

---

## 11. Suggested first steps in the new project

1. Decide the **name**, and the **boardgame.io keep/drop** question.
2. Scaffold Phaser 4 + TypeScript + Vite (Phaser publishes an official template).
3. Copy `phaserjs/phaser`'s `skills/` into `.claude/skills/phaser/`.
4. Drop this document in as `HANDOFF.md`.
5. **Port the pure game core first** — types, classes, combat, grid, skills,
   equipment, blessings, AI. No rendering at all. It's ~1,500 lines and carries
   over almost verbatim.
6. **Rebuild the headless simulator and get it green** — before drawing a
   single sprite. If the sim runs a full roguelike run, the core is correct.
7. *Then* start on the Phaser scene, tilemap, and unit sprites.
8. Rebuild map validation (BFS connectivity + spawn-tile checks) as a script.

Doing 5–6 before 7 is the single most important sequencing call here. The old
project's core logic is its most valuable asset, and it can be proven correct
with zero graphics.
