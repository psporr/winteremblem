import type { Ctx, Game, MoveMap } from 'boardgame.io';
import { INVALID_MOVE } from 'boardgame.io/core';

import type { CampaignCarryOver, ChapterDef } from './maps';
import type { GameMode, GameState, ItemSlot, Team, Unit } from './types';
import { PLAYER_ID, teamOf } from './types';
import { buildGameState, CAMPAIGN_CHAPTER_1, CHAPTER_1, type ShuffleAPI } from './maps';
import { computeReachable, manhattan, tileKey, unitsOf } from './grid';
import { canCounter, computeCounterDamage, computeDamage, forecastCombat } from './combat';
import { BLESSINGS, drawBlessings } from './blessings';
import { spawnWave } from './waves';
import { EXP_PER_ATTACK, EXP_PER_HEAL, EXP_PER_KILL, grantExp as grantExpToUnit } from './classes';
import { effectiveStats, equippedKillHeal, ITEMS, rollDrop, type DropRandomAPI } from './equipment';
import { HEAL_BONUS, NOVA_DAMAGE_MULTIPLIER, SKILLS, SNIPE_BONUS, novaBlastTargets, skillTargets } from './skills';
import { pushLog } from './log';

/**
 * The slice of boardgame.io's EventsAPI we actually need. Defined locally,
 * same reasoning as ShuffleAPI in maps.ts — not re-exported from the
 * package's `types` entry.
 */
interface EndTurnAPI {
  endTurn?: () => void;
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

/**
 * Called whenever a unit dies. On a 'waves' objective (roguelike) an empty
 * enemy side pauses play for a blessing pick and the run continues; on
 * 'rout' (campaign) there's nothing to do here — the chapter is simply over,
 * which `endIf` picks up on its own.
 */
function checkWaveCleared(G: GameState, random: DropRandomAPI): void {
  if (unitsOf(G, 'enemy').length > 0) return;
  if (G.objectiveType !== 'waves') return;

  G.awaitingBlessing = true;
  G.offeredBlessingIds = drawBlessings(G, random);
  pushLog(G, 'All enemies defeated! Choose your blessing.');
}

/**
 * Removes a fallen unit, rolls its loot if it was an enemy, and checks
 * whether that was the wave's last one. Shared by plain attacks and any
 * skill that can kill, so drops and the wave-clear check never drift out of
 * sync between the two. Also the single chokepoint for two blessing
 * effects: Guardian Angel (a lethal hit on a player unit can be survived
 * instead) and The Fallen (a player unit that does die is remembered for
 * revival), plus Vampiric Fang's kill-heal for whoever landed the blow.
 */
function killUnit(G: GameState, unit: Unit, random: DropRandomAPI, killer?: Unit): void {
  if (unit.team === 'player' && G.modifiers.guardianAngelCharges > 0) {
    G.modifiers.guardianAngelCharges -= 1;
    unit.hp = 1;
    pushLog(G, `${unit.name} is saved by a Guardian Angel!`);
    return;
  }

  pushLog(G, `${unit.name} has fallen!`);
  delete G.units[unit.id];
  if (unit.team === 'player') {
    G.fallenUnits.push(unit);
  } else {
    const drop = rollDrop(G, G.wave, random);
    if (drop) {
      G.inventory.push(drop);
      pushLog(G, `${unit.name} dropped ${ITEMS[drop.defId].name}!`);
    }
  }

  if (killer) {
    const heal = equippedKillHeal(killer);
    if (heal > 0 && killer.hp > 0) {
      killer.hp = Math.min(killer.maxHp, killer.hp + heal);
      pushLog(G, `${killer.name} drains ${heal} HP from the kill.`);
    }
  }

  checkWaveCleared(G, random);
}

/**
 * Shared counter step for skills that behave like a modified single attack
 * (Sword Dance, Guard Break, Rampage). Returns false if the attacker died to
 * the counter — the caller should stop immediately in that case, same as
 * attackUnit does for a plain attack.
 */
function resolveSkillCounter(G: GameState, attacker: Unit, target: Unit, random: DropRandomAPI): boolean {
  if (!canCounter(attacker, target)) return true;
  const counter = computeCounterDamage(G, target, attacker);
  attacker.hp = Math.max(0, attacker.hp - counter);
  pushLog(G, `${target.name} counters for ${counter}.`);
  if (attacker.hp <= 0) {
    killUnit(G, attacker, random, target);
    return false;
  }
  return true;
}

/** Only the player squad grows — enemy stats are fixed by wave/chapter, not combat performance. */
function grantExp(G: GameState, unit: Unit, amount: number = EXP_PER_ATTACK): void {
  if (unit.team !== 'player') return;
  grantExpToUnit(unit, amount, (leveled) => pushLog(G, `${leveled.name} reached level ${leveled.level}!`));
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
    killUnit(G, target, random, attacker);
  } else if (result.counterDamage !== null) {
    attacker.hp = result.attackerHpAfter;
    pushLog(G, `${target.name} counters for ${result.counterDamage}.`);
    if (result.attackerWillDie) {
      killUnit(G, attacker, random, target);
      return;
    }
  }

  // Reached only if the attacker survived (the attacker-dies branch above
  // returns early), so its exp/hp changes here always land on a live unit.
  grantExp(G, attacker, result.willKill ? EXP_PER_KILL : EXP_PER_ATTACK);
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
  // Set by any case whose hit killed its target, so the shared exp grant at
  // the bottom can credit a kill rather than a plain hit.
  let killedTarget = false;

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
        killUnit(G, target, random, unit);
        killedTarget = true;
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
        killUnit(G, target, random, unit);
        killedTarget = true;
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
      if (target.hp <= 0) {
        killUnit(G, target, random, unit);
        killedTarget = true;
      }
      break;
    }

    case 'nova': {
      if (!target || !skillTargets(G, unit).some((candidate) => candidate.id === target.id)) return INVALID_MOVE;
      const hits = novaBlastTargets(G, unit, target);
      let totalDealt = 0;
      for (const hitTarget of hits) {
        const dmg = Math.max(1, Math.round(computeDamage(G, unit, hitTarget) * NOVA_DAMAGE_MULTIPLIER));
        hitTarget.hp = Math.max(0, hitTarget.hp - dmg);
        totalDealt += dmg;
        if (hitTarget.hp <= 0) {
          killUnit(G, hitTarget, random, unit);
          killedTarget = true;
        }
      }
      pushLog(
        G,
        `${unit.name} casts Nova on ${target.name}, hitting ${hits.length} enem${hits.length === 1 ? 'y' : 'ies'} for ${totalDealt} total.`,
      );
      break;
    }

    case 'rampage': {
      if (!target || !skillTargets(G, unit).some((candidate) => candidate.id === target.id)) return INVALID_MOVE;
      const dmg = computeDamage(G, unit, target);
      target.hp = Math.max(0, target.hp - dmg);
      pushLog(G, `${unit.name} rampages into ${target.name} for ${dmg}.`);
      if (target.hp <= 0) {
        killUnit(G, target, random, unit);
        unit.skillCooldown = Math.max(1, skill.cooldown - G.modifiers.cooldownReduction);
        grantExp(G, unit, EXP_PER_KILL);
        // Deliberately leaves hasMoved/hasActed false — a kill refunds the turn.
        return;
      }
      if (!resolveSkillCounter(G, unit, target, random)) return;
      break;
    }

    default:
      return INVALID_MOVE;
  }

  unit.skillCooldown = Math.max(1, skill.cooldown - G.modifiers.cooldownReduction);
  grantExp(G, unit, skill.id === 'heal' ? EXP_PER_HEAL : killedTarget ? EXP_PER_KILL : EXP_PER_ATTACK);
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
 * Applies the chosen blessing, resets the squad to their start tiles, and
 * spawns the next wave. Only valid right after a wave is cleared, and only
 * for one of the 3 ids actually offered this pause (drawn in
 * checkWaveCleared) — not just any id in the full 20-strong pool.
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
  if (!G.offeredBlessingIds.includes(blessingId)) return INVALID_MOVE;

  const blessing = BLESSINGS.find((candidate) => candidate.id === blessingId);
  if (!blessing) return INVALID_MOVE;

  // Fortune's boost only ever covers the single wave right after it's
  // picked — reset before applying, so picking anything else lets it lapse.
  G.modifiers.dropChanceMultiplier = 1;
  blessing.apply(G);

  for (const unit of unitsOf(G, 'player')) {
    unit.hasMoved = false;
    unit.hasActed = false;
    const start = G.playerStart[unit.id];
    if (start) {
      unit.x = start.x;
      unit.y = start.y;
    }
  }

  G.modifiers.guardianAngelCharges = G.modifiers.guardianAngelMax;
  G.wave += 1;
  spawnWave(G, G.wave, random);
  G.awaitingBlessing = false;
  G.offeredBlessingIds = [];
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

/**
 * Both modes share every rule in this file — they differ only in which
 * chapter loads and what counts as clearing it, so they're the same Game
 * definition built with different setup data rather than two engines.
 */
export function createWinterEmblem(
  mode: GameMode,
  chapter: ChapterDef,
  carryOver?: CampaignCarryOver,
  baseLevel?: number,
): Game<GameState> {
  return {
    ...WinterEmblemBase,
    setup: ({ random }) => buildGameState(chapter, mode, random, carryOver, baseLevel),
  };
}

const WinterEmblemBase: Game<GameState> = {
  name: 'winter-emblem',

  setup: ({ random }) => buildGameState(CHAPTER_1, 'roguelike', random),

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
      if (team === 'player' && G.modifiers.healPerTurn > 0) {
        for (const unit of unitsOf(G, 'player')) {
          unit.hp = Math.min(unit.maxHp, unit.hp + G.modifiers.healPerTurn);
        }
      }
      pushLog(G, team === 'player' ? '— Player phase —' : '— Enemy phase —');
    },

    // The phase ends on its own once every unit on the active side is spent.
    endIf: ({ G, ctx }) => {
      const units = unitsOf(G, teamOf(ctx.currentPlayer));
      return units.length > 0 && units.every((unit) => unit.hasActed);
    },
  },

  // A squad wipe always ends the battle. Beyond that it's objective-driven:
  // 'waves' never ends in victory (clearing one just spawns the next via
  // chooseBlessing), while 'rout' is won the moment the last enemy falls.
  endIf: ({ G }): GameOver | undefined => {
    if (unitsOf(G, 'player').length === 0) return { winner: 'enemy' };
    if (G.objectiveType === 'rout' && unitsOf(G, 'enemy').length === 0) return { winner: 'player' };
    return undefined;
  },
};

/** The endless wave-survival run — unchanged from before the mode split. */
export const WinterEmblem = createWinterEmblem('roguelike', CHAPTER_1);

/** Campaign chapter 1, a fixed-composition rout on its own map. */
export const WinterEmblemCampaign = createWinterEmblem('campaign', CAMPAIGN_CHAPTER_1);

export { PLAYER_ID };
