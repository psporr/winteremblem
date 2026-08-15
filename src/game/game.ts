import type { Ctx, Game, MoveMap } from 'boardgame.io';
import { INVALID_MOVE } from 'boardgame.io/core';

import type { GameState, ItemSlot, Team, Unit } from './types';
import { PLAYER_ID, teamOf } from './types';
import { buildGameState, playerStartPositions, CHAPTER_1, type ShuffleAPI } from './maps';
import { computeReachable, manhattan, tileKey, unitsOf } from './grid';
import { canCounter, computeDamage, forecastCombat } from './combat';
import { BLESSINGS } from './blessings';
import { spawnWave } from './waves';
import { EXP_PER_ATTACK, EXP_TO_LEVEL, statsAtLevel } from './classes';
import { effectiveStats, ITEMS, rollDrop, type DropRandomAPI } from './equipment';
import { HEAL_BONUS, NOVA_DAMAGE_MULTIPLIER, SKILLS, SNIPE_BONUS, skillAoeTargets, skillTargets } from './skills';

/**
 * The slice of boardgame.io's EventsAPI we actually need. Defined locally,
 * same reasoning as ShuffleAPI in maps.ts — not re-exported from the
 * package's `types` entry.
 */
interface EndTurnAPI {
  endTurn?: () => void;
}

const MAX_LOG_ENTRIES = 40;
const PLAYER_START = playerStartPositions(CHAPTER_1);

function pushLog(G: GameState, message: string): void {
  G.log.unshift(message);
  if (G.log.length > MAX_LOG_ENTRIES) G.log.length = MAX_LOG_ENTRIES;
}

/**
 * Resolves the unit a move is allowed to command: it must exist, belong to the
 * side whose turn it is, and still have an action left.
 */
function activeUnit(G: GameState, ctx: Ctx, unitId: string): Unit | null {
  const unit = G.units[unitId];
  if (!unit) return null;
  if (unit.team !== teamOf(ctx.currentPlayer)) return null;
  if (unit.hasActed) return null;
  return unit;
}

export const moveUnit = (
  { G, ctx }: { G: GameState; ctx: Ctx },
  unitId: string,
  x: number,
  y: number,
) => {
  const unit = activeUnit(G, ctx, unitId);
  if (!unit || unit.hasMoved) return INVALID_MOVE;

  const destination = computeReachable(G, unit).get(tileKey(x, y));
  if (!destination) return INVALID_MOVE;

  unit.x = x;
  unit.y = y;
  unit.hasMoved = true;
};

/** Marks the wave cleared once every enemy is gone, pausing play for a blessing pick. */
function checkWaveCleared(G: GameState): void {
  if (unitsOf(G, 'enemy').length === 0) {
    G.awaitingBlessing = true;
    pushLog(G, 'All enemies defeated! Choose your blessing.');
  }
}

/**
 * Removes a fallen unit, rolls its loot if it was an enemy, and checks
 * whether that was the wave's last one. Shared by plain attacks and any
 * skill that can kill, so drops and the wave-clear check never drift out of
 * sync between the two.
 */
function killUnit(G: GameState, unit: Unit, random: DropRandomAPI): void {
  pushLog(G, `${unit.name} has fallen!`);
  delete G.units[unit.id];
  if (unit.team === 'enemy') {
    const drop = rollDrop(G, G.wave, random);
    if (drop) {
      G.inventory.push(drop);
      pushLog(G, `${unit.name} dropped ${ITEMS[drop.defId].name}!`);
    }
  }
  checkWaveCleared(G);
}

/**
 * Shared counter step for skills that behave like a modified single attack
 * (Sword Dance, Guard Break, Rampage). Returns false if the attacker died to
 * the counter — the caller should stop immediately in that case, same as
 * attackUnit does for a plain attack.
 */
function resolveSkillCounter(G: GameState, attacker: Unit, target: Unit, random: DropRandomAPI): boolean {
  if (!canCounter(attacker, target)) return true;
  const counter = computeDamage(G, target, attacker);
  attacker.hp = Math.max(0, attacker.hp - counter);
  pushLog(G, `${target.name} counters for ${counter}.`);
  if (attacker.hp <= 0) {
    killUnit(G, attacker, random);
    return false;
  }
  return true;
}

/**
 * Every attack grants EXP to whoever threw the punch, win or lose. A level
 * up recomputes atk/def/maxHp from the class curve and heals by the maxHp
 * gained, so leveling never feels like a step backwards. Looped rather than
 * a single `if`, in case a future EXP source ever grants enough to cross
 * more than one level at once.
 */
function grantExp(G: GameState, unit: Unit): void {
  unit.exp += EXP_PER_ATTACK;
  while (unit.exp >= EXP_TO_LEVEL) {
    unit.exp -= EXP_TO_LEVEL;
    unit.level += 1;
    const stats = statsAtLevel(unit.className, unit.level);
    const hpGain = stats.maxHp - unit.maxHp;
    unit.maxHp = stats.maxHp;
    unit.atk = stats.atk;
    unit.def = stats.def;
    unit.hp = Math.min(stats.maxHp, unit.hp + hpGain);
    pushLog(G, `${unit.name} reached level ${unit.level}!`);
  }
}

export const attackUnit = (
  { G, ctx, random }: { G: GameState; ctx: Ctx; random: DropRandomAPI },
  attackerId: string,
  targetId: string,
) => {
  const attacker = activeUnit(G, ctx, attackerId);
  const target = G.units[targetId];
  if (!attacker || !target) return INVALID_MOVE;
  if (target.team === attacker.team) return INVALID_MOVE;
  if (manhattan(attacker, target) > effectiveStats(attacker).range) return INVALID_MOVE;

  const result = forecastCombat(G, attacker, target);

  target.hp = result.defenderHpAfter;
  pushLog(G, `${attacker.name} hits ${target.name} for ${result.damageDealt}.`);

  if (result.willKill) {
    killUnit(G, target, random);
  } else if (result.counterDamage !== null) {
    attacker.hp = result.attackerHpAfter;
    pushLog(G, `${target.name} counters for ${result.counterDamage}.`);
    if (result.attackerWillDie) {
      killUnit(G, attacker, random);
      return;
    }
  }

  // Reached only if the attacker survived (the attacker-dies branch above
  // returns early), so its exp/hp changes here always land on a live unit.
  grantExp(G, attacker);
  attacker.hasMoved = true;
  attacker.hasActed = true;
};

/** Ends a unit's turn where it stands. */
export const waitUnit = ({ G, ctx }: { G: GameState; ctx: Ctx }, unitId: string) => {
  const unit = activeUnit(G, ctx, unitId);
  if (!unit) return INVALID_MOVE;

  unit.hasMoved = true;
  unit.hasActed = true;
};

/**
 * Every class's active skill, dispatched from one move since each case is
 * short and they share the activeUnit/cooldown gate. `targetId` is null for
 * Nova, the only AoE skill — there's nothing to pick, it just hits
 * everything in range.
 */
export const useSkill = (
  { G, ctx, random }: { G: GameState; ctx: Ctx; random: DropRandomAPI },
  unitId: string,
  targetId: string | null,
) => {
  const unit = activeUnit(G, ctx, unitId);
  if (!unit || unit.skillCooldown > 0) return INVALID_MOVE;

  const skill = SKILLS[unit.className];
  const target = targetId ? G.units[targetId] : undefined;

  switch (skill.id) {
    case 'heal': {
      if (!target || !skillTargets(G, unit).some((candidate) => candidate.id === target.id)) return INVALID_MOVE;
      const healAmount = Math.min(target.maxHp - target.hp, unit.atk + HEAL_BONUS);
      target.hp += healAmount;
      pushLog(G, `${unit.name} heals ${target.name} for ${healAmount}.`);
      break;
    }

    case 'dance': {
      if (!target || !skillTargets(G, unit).some((candidate) => candidate.id === target.id)) return INVALID_MOVE;
      target.hasMoved = false;
      target.hasActed = false;
      pushLog(G, `${unit.name} dances for ${target.name} — they can act again!`);
      break;
    }

    case 'sword-dance': {
      if (!target || !skillTargets(G, unit).some((candidate) => candidate.id === target.id)) return INVALID_MOVE;
      let dealt = 0;
      for (let i = 0; i < 2 && target.hp > 0; i++) {
        const dmg = computeDamage(G, unit, target);
        target.hp = Math.max(0, target.hp - dmg);
        dealt += dmg;
      }
      pushLog(G, `${unit.name} strikes ${target.name} twice for ${dealt}.`);
      if (target.hp <= 0) {
        killUnit(G, target, random);
      } else if (!resolveSkillCounter(G, unit, target, random)) {
        return;
      }
      break;
    }

    case 'guard-break': {
      if (!target || !skillTargets(G, unit).some((candidate) => candidate.id === target.id)) return INVALID_MOVE;
      const dmg = Math.max(1, effectiveStats(unit).atk - effectiveStats(target).def);
      target.hp = Math.max(0, target.hp - dmg);
      pushLog(G, `${unit.name} breaks ${target.name}'s guard for ${dmg}.`);
      if (target.hp <= 0) {
        killUnit(G, target, random);
      } else if (!resolveSkillCounter(G, unit, target, random)) {
        return;
      }
      break;
    }

    case 'snipe': {
      if (!target || !skillTargets(G, unit).some((candidate) => candidate.id === target.id)) return INVALID_MOVE;
      const dmg = computeDamage(G, unit, target) + SNIPE_BONUS;
      target.hp = Math.max(0, target.hp - dmg);
      pushLog(G, `${unit.name} snipes ${target.name} for ${dmg}. No counter possible.`);
      if (target.hp <= 0) killUnit(G, target, random);
      break;
    }

    case 'nova': {
      const targets = skillAoeTargets(G, unit);
      if (targets.length === 0) return INVALID_MOVE;
      let totalDealt = 0;
      for (const aoeTarget of targets) {
        const dmg = Math.max(1, Math.round(computeDamage(G, unit, aoeTarget) * NOVA_DAMAGE_MULTIPLIER));
        aoeTarget.hp = Math.max(0, aoeTarget.hp - dmg);
        totalDealt += dmg;
        if (aoeTarget.hp <= 0) killUnit(G, aoeTarget, random);
      }
      pushLog(G, `${unit.name} casts Nova, hitting ${targets.length} enemies for ${totalDealt} total.`);
      break;
    }

    case 'rampage': {
      if (!target || !skillTargets(G, unit).some((candidate) => candidate.id === target.id)) return INVALID_MOVE;
      const dmg = computeDamage(G, unit, target);
      target.hp = Math.max(0, target.hp - dmg);
      pushLog(G, `${unit.name} rampages into ${target.name} for ${dmg}.`);
      if (target.hp <= 0) {
        killUnit(G, target, random);
        unit.skillCooldown = skill.cooldown;
        grantExp(G, unit);
        // Deliberately leaves hasMoved/hasActed false — a kill refunds the turn.
        return;
      }
      if (!resolveSkillCounter(G, unit, target, random)) return;
      break;
    }

    default:
      return INVALID_MOVE;
  }

  unit.skillCooldown = skill.cooldown;
  grantExp(G, unit);
  unit.hasMoved = true;
  unit.hasActed = true;
};

/**
 * Equips an item from the shared inventory onto a player unit, returning
 * whatever was already in that slot back to the inventory. Doesn't cost a
 * turn — equipping is available any time during the player phase, not
 * gated behind a unit's move/attack the way Attack/Wait are.
 */
export const equipItem = ({ G, ctx }: { G: GameState; ctx: Ctx }, unitId: string, instanceId: string) => {
  const unit = G.units[unitId];
  if (!unit || unit.team !== 'player' || teamOf(ctx.currentPlayer) !== 'player') return INVALID_MOVE;

  const itemIndex = G.inventory.findIndex((item) => item.instanceId === instanceId);
  if (itemIndex === -1) return INVALID_MOVE;
  const [item] = G.inventory.splice(itemIndex, 1);

  const slot: ItemSlot = ITEMS[item.defId].slot;
  const previous = unit.equipment[slot];
  if (previous) G.inventory.push(previous);
  unit.equipment[slot] = item;
};

/** Returns an equipped item to the shared inventory. */
export const unequipItem = ({ G, ctx }: { G: GameState; ctx: Ctx }, unitId: string, slot: ItemSlot) => {
  const unit = G.units[unitId];
  if (!unit || unit.team !== 'player' || teamOf(ctx.currentPlayer) !== 'player') return INVALID_MOVE;

  const item = unit.equipment[slot];
  if (!item) return INVALID_MOVE;
  delete unit.equipment[slot];
  G.inventory.push(item);
};

/**
 * Applies the chosen blessing to every surviving player unit, resets the
 * squad to their start tiles, and spawns the next wave. Only valid right
 * after a wave is cleared.
 *
 * If the last enemy fell during the enemy's own turn (e.g. a counterattack),
 * this also force-ends that turn so the fresh wave's enemies don't get
 * immediately auto-played by the CPU before the player has a turn.
 */
export const chooseBlessing = (
  { G, ctx, events, random }: { G: GameState; ctx: Ctx; events: EndTurnAPI; random: ShuffleAPI },
  blessingId: string,
) => {
  if (!G.awaitingBlessing) return INVALID_MOVE;

  const blessing = BLESSINGS.find((candidate) => candidate.id === blessingId);
  if (!blessing) return INVALID_MOVE;

  for (const unit of unitsOf(G, 'player')) {
    blessing.apply(unit);
    unit.hasMoved = false;
    unit.hasActed = false;
    const start = PLAYER_START[unit.id];
    if (start) {
      unit.x = start.x;
      unit.y = start.y;
    }
  }

  G.wave += 1;
  spawnWave(G, G.wave, random);
  G.awaitingBlessing = false;
  pushLog(G, `— Wave ${G.wave} —`);

  if (teamOf(ctx.currentPlayer) !== 'player') {
    events.endTurn?.();
  }
};

const moves: MoveMap<GameState> = {
  moveUnit,
  attackUnit,
  waitUnit,
  useSkill,
  chooseBlessing,
  equipItem,
  unequipItem,
};

export interface GameOver {
  winner: Team;
}

export const WinterEmblem: Game<GameState> = {
  name: 'winter-emblem',

  setup: ({ random }) => buildGameState(CHAPTER_1, random),

  // Two sides: '0' is the player's army, '1' is the CPU army.
  minPlayers: 2,
  maxPlayers: 2,

  moves,

  turn: {
    onBegin: ({ G, ctx }) => {
      const team = teamOf(ctx.currentPlayer);
      for (const unit of unitsOf(G, team)) {
        unit.hasMoved = false;
        unit.hasActed = false;
        if (unit.skillCooldown > 0) unit.skillCooldown -= 1;
      }
      pushLog(G, team === 'player' ? '— Player phase —' : '— Enemy phase —');
    },

    // The phase ends on its own once every unit on the active side is spent.
    endIf: ({ G, ctx }) => {
      const units = unitsOf(G, teamOf(ctx.currentPlayer));
      return units.length > 0 && units.every((unit) => unit.hasActed);
    },
  },

  // Clearing a wave no longer ends the match — it's handled by
  // chooseBlessing spawning the next one. The only way this run ends is a
  // full wipe of the player's squad.
  endIf: ({ G }): GameOver | undefined => {
    return unitsOf(G, 'player').length === 0 ? { winner: 'enemy' } : undefined;
  },
};

export { PLAYER_ID };
