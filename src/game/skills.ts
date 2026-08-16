import type { ClassName } from './classes';
import type { GameState, Unit } from './types';
import { effectiveStats } from './equipment';
import { manhattan, unitsOf, type Coord } from './grid';
import { computeDamage } from './combat';

/** Flat bonus healed on top of the healer's own atk. */
export const HEAL_BONUS = 4;
/** Flat bonus damage Snipe deals on top of a normal hit. */
export const SNIPE_BONUS = 4;
/** Nova's per-target damage multiplier — a blast hits several tiles, so each hit is softened. */
export const NOVA_DAMAGE_MULTIPLIER = 0.6;

export type SkillTargetType = 'ally' | 'enemy';

/**
 * Drives the action menu's color-coding — not the same axis as targetType
 * (both Heal and Dance target allies, but they're visually distinct: green
 * for restoring HP, yellow for a non-damage utility effect).
 */
export type SkillCategory = 'attack' | 'heal' | 'utility';

export interface SkillDef {
  id: string;
  name: string;
  description: string;
  /** Turns of cooldown after use, ticking down on the unit's own phases. */
  cooldown: number;
  targetType: SkillTargetType;
  category: SkillCategory;
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
    category: 'heal',
    rangeBonus: 0,
  },
  Dancer: {
    id: 'dance',
    name: 'Dance',
    description: "Refresh an ally who's already acted, so they can move and act again.",
    cooldown: SKILL_COOLDOWN,
    targetType: 'ally',
    category: 'utility',
    rangeBonus: 0,
  },
  Swordsman: {
    id: 'sword-dance',
    name: 'Sword Dance',
    description: 'Strike the same target twice in one action.',
    cooldown: SKILL_COOLDOWN,
    targetType: 'enemy',
    category: 'attack',
    rangeBonus: 0,
  },
  Lancer: {
    id: 'guard-break',
    name: 'Guard Break',
    description: "Attack ignoring the target's terrain defense bonus.",
    cooldown: SKILL_COOLDOWN,
    targetType: 'enemy',
    category: 'attack',
    rangeBonus: 0,
  },
  Archer: {
    id: 'snipe',
    name: 'Snipe',
    description: 'Bonus damage from +1 range; the target cannot counter.',
    cooldown: SKILL_COOLDOWN,
    targetType: 'enemy',
    category: 'attack',
    rangeBonus: 1,
  },
  Mage: {
    id: 'nova',
    name: 'Nova',
    description: 'A plus-shaped blast centered on the target, for reduced damage each.',
    cooldown: SKILL_COOLDOWN,
    targetType: 'enemy',
    category: 'attack',
    rangeBonus: 0,
  },
  Barbarian: {
    id: 'rampage',
    name: 'Rampage',
    description: 'A normal attack, but a kill lets the unit act again immediately.',
    cooldown: SKILL_COOLDOWN,
    targetType: 'enemy',
    category: 'attack',
    rangeBonus: 0,
  },
};

/** The reach a unit's skill can target from its current tile. */
export function skillRange(unit: Unit): number {
  return effectiveStats(unit).range + SKILLS[unit.className].rangeBonus;
}

/** Valid single-select targets for a unit's skill from its current tile. */
export function skillTargets(G: GameState, unit: Unit): Unit[] {
  const skill = SKILLS[unit.className];
  const range = skillRange(unit);

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

/** The five tiles a plus-shaped blast covers, centered on the picked target. */
export function novaBlastCoords(target: Coord): Coord[] {
  return [
    { x: target.x, y: target.y },
    { x: target.x, y: target.y - 1 },
    { x: target.x, y: target.y + 1 },
    { x: target.x - 1, y: target.y },
    { x: target.x + 1, y: target.y },
  ];
}

/** Enemies of `unit` caught in Nova's plus-shaped blast around `target`. */
export function novaBlastTargets(G: GameState, unit: Unit, target: Coord): Unit[] {
  const coords = novaBlastCoords(target);
  return Object.values(G.units).filter(
    (other) => other.team !== unit.team && coords.some((c) => c.x === other.x && c.y === other.y),
  );
}

/** Whether a unit's skill has any legal use right now — cooldown and targets both. */
export function canUseSkill(G: GameState, unit: Unit): boolean {
  if (unit.skillCooldown > 0) return false;
  return skillTargets(G, unit).length > 0;
}

/**
 * A short, human-readable preview of what confirming a skill would do —
 * shown on the confirm card before the player commits. Reuses the same
 * damage/heal formulas the actual move applies (HEAL_BONUS, SNIPE_BONUS,
 * NOVA_DAMAGE_MULTIPLIER) so the preview can't drift from what happens.
 */
export function describeSkillEffect(G: GameState, unit: Unit, target: Unit | null): string {
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
    case 'nova': {
      if (!target) return '';
      const hits = novaBlastTargets(G, unit, target);
      return `Hits ${hits.length} enem${hits.length === 1 ? 'y' : 'ies'} in a plus-shaped blast, for reduced damage each.`;
    }
    case 'rampage': {
      if (!target) return '';
      const dmg = computeDamage(G, unit, target);
      return `${dmg} damage. Acts again immediately if this kills.`;
    }
    default:
      return '';
  }
}
