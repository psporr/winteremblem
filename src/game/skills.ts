import type { ClassName } from './classes';
import type { GameState, Unit } from './types';
import { effectiveStats } from './equipment';
import { manhattan, unitsOf } from './grid';
import { computeDamage } from './combat';

/** Flat bonus healed on top of the healer's own atk. */
export const HEAL_BONUS = 4;
/** Flat bonus damage Snipe deals on top of a normal hit. */
export const SNIPE_BONUS = 4;
/** Nova's per-target damage multiplier — an AoE hits everyone, so each hit is softened. */
export const NOVA_DAMAGE_MULTIPLIER = 0.6;

export type SkillTargetType = 'ally' | 'enemy' | 'enemy-aoe';

export interface SkillDef {
  id: string;
  name: string;
  description: string;
  /** Turns of cooldown after use, ticking down on the unit's own phases. */
  cooldown: number;
  targetType: SkillTargetType;
  /** Added on top of the unit's normal effective attack range, for this skill only. */
  rangeBonus: number;
}

const SKILL_COOLDOWN = 3;

/**
 * One signature active skill per class, usable from level 1. Deliberately
 * built to feel structurally different from each other, not just stat
 * tweaks: two support skills that never touch damage, and five offensive
 * skills that each break a different normal-attack rule (extra hit, ignores
 * terrain, guaranteed no counter, hits everyone in range, or refunds the
 * turn on a kill).
 */
export const SKILLS: Record<ClassName, SkillDef> = {
  Cleric: {
    id: 'heal',
    name: 'Heal',
    description: 'Restore HP to an ally in range.',
    cooldown: SKILL_COOLDOWN,
    targetType: 'ally',
    rangeBonus: 0,
  },
  Dancer: {
    id: 'dance',
    name: 'Dance',
    description: "Refresh an ally who's already acted, so they can move and act again.",
    cooldown: SKILL_COOLDOWN,
    targetType: 'ally',
    rangeBonus: 0,
  },
  Swordsman: {
    id: 'sword-dance',
    name: 'Sword Dance',
    description: 'Strike the same target twice in one action.',
    cooldown: SKILL_COOLDOWN,
    targetType: 'enemy',
    rangeBonus: 0,
  },
  Lancer: {
    id: 'guard-break',
    name: 'Guard Break',
    description: "Attack ignoring the target's terrain defense bonus.",
    cooldown: SKILL_COOLDOWN,
    targetType: 'enemy',
    rangeBonus: 0,
  },
  Archer: {
    id: 'snipe',
    name: 'Snipe',
    description: 'Bonus damage from +1 range; the target cannot counter.',
    cooldown: SKILL_COOLDOWN,
    targetType: 'enemy',
    rangeBonus: 1,
  },
  Mage: {
    id: 'nova',
    name: 'Nova',
    description: 'Hits every enemy in range at once, for reduced damage each.',
    cooldown: SKILL_COOLDOWN,
    targetType: 'enemy-aoe',
    rangeBonus: 0,
  },
  Barbarian: {
    id: 'rampage',
    name: 'Rampage',
    description: 'A normal attack, but a kill lets the unit act again immediately.',
    cooldown: SKILL_COOLDOWN,
    targetType: 'enemy',
    rangeBonus: 0,
  },
};

/** The reach a unit's skill can target from its current tile. */
export function skillRange(unit: Unit): number {
  return effectiveStats(unit).range + SKILLS[unit.className].rangeBonus;
}

/**
 * Valid single-select targets for a unit's skill from its current tile.
 * Always empty for AoE skills (see skillAoeTargets instead) — there's
 * nothing to pick, the skill just hits everything in range.
 */
export function skillTargets(G: GameState, unit: Unit): Unit[] {
  const skill = SKILLS[unit.className];
  const range = skillRange(unit);

  if (skill.targetType === 'enemy-aoe') return [];

  if (skill.targetType === 'ally') {
    const allies = unitsOf(G, unit.team).filter(
      (ally) => ally.id !== unit.id && manhattan(unit, ally) <= range,
    );
    if (skill.id === 'heal') return allies.filter((ally) => ally.hp < ally.maxHp);
    if (skill.id === 'dance') return allies.filter((ally) => ally.hasActed);
    return allies;
  }

  return Object.values(G.units).filter(
    (other) => other.team !== unit.team && manhattan(unit, other) <= range,
  );
}

/** Enemies an AoE skill (Nova) would hit from the unit's current tile. */
export function skillAoeTargets(G: GameState, unit: Unit): Unit[] {
  const range = skillRange(unit);
  return Object.values(G.units).filter(
    (other) => other.team !== unit.team && manhattan(unit, other) <= range,
  );
}

/** Whether a unit's skill has any legal use right now — cooldown and targets both. */
export function canUseSkill(G: GameState, unit: Unit): boolean {
  if (unit.skillCooldown > 0) return false;
  const skill = SKILLS[unit.className];
  return skill.targetType === 'enemy-aoe'
    ? skillAoeTargets(G, unit).length > 0
    : skillTargets(G, unit).length > 0;
}

/**
 * A short, human-readable preview of what confirming a skill would do —
 * shown on the confirm card before the player commits. Reuses the same
 * damage/heal formulas the actual move applies (HEAL_BONUS, SNIPE_BONUS,
 * NOVA_DAMAGE_MULTIPLIER) so the preview can't drift from what happens.
 */
export function describeSkillEffect(
  G: GameState,
  unit: Unit,
  target: Unit | null,
  aoeTargets: Unit[],
): string {
  const skill = SKILLS[unit.className];

  switch (skill.id) {
    case 'heal': {
      if (!target) return '';
      const amount = Math.min(target.maxHp - target.hp, unit.atk + HEAL_BONUS);
      return `Heals ${target.name} for ${amount} HP.`;
    }
    case 'dance':
      return target ? `${target.name} can move and act again this turn.` : '';
    case 'sword-dance': {
      if (!target) return '';
      const perHit = computeDamage(G, unit, target);
      return `Two hits for ${perHit} each (${perHit * 2} total).`;
    }
    case 'guard-break': {
      if (!target) return '';
      const dmg = Math.max(1, effectiveStats(unit).atk - effectiveStats(target).def);
      return `${dmg} damage, ignoring terrain.`;
    }
    case 'snipe': {
      if (!target) return '';
      const dmg = computeDamage(G, unit, target) + SNIPE_BONUS;
      return `${dmg} damage. Target cannot counter.`;
    }
    case 'nova':
      return aoeTargets.length > 0
        ? `Hits ${aoeTargets.length} enem${aoeTargets.length === 1 ? 'y' : 'ies'} for reduced damage each.`
        : 'No enemies in range.';
    case 'rampage': {
      if (!target) return '';
      const dmg = computeDamage(G, unit, target);
      return `${dmg} damage. Acts again immediately if this kills.`;
    }
    default:
      return '';
  }
}
