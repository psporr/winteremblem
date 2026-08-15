/**
 * Base stats per class. A unit's className always determines its stats —
 * player and enemy units of the same class share the same numbers — so
 * balance changes happen in exactly one place.
 */
export type ClassName =
  | 'Swordsman'
  | 'Archer'
  | 'Lancer'
  | 'Mage'
  | 'Barbarian'
  | 'Cleric'
  | 'Dancer';

export interface ClassStats {
  maxHp: number;
  atk: number;
  def: number;
  /** Movement points per turn. */
  move: number;
  /** Attack reach in tiles (Manhattan distance). 1 = melee, 2 = ranged. */
  range: number;
}

/**
 * Stats at level 1.
 *
 * Cleric and Dancer are stat-balanced as ordinary combatants for now — they
 * fight like any other class. Their classic Fire Emblem roles (healing
 * staff, refreshing an ally's turn) aren't implemented yet; these numbers
 * are a placeholder until that's built.
 */
export const CLASS_STATS: Record<ClassName, ClassStats> = {
  Swordsman: { maxHp: 24, atk: 9, def: 5, move: 3, range: 1 },
  Archer: { maxHp: 18, atk: 8, def: 3, move: 3, range: 2 },
  Lancer: { maxHp: 22, atk: 8, def: 6, move: 3, range: 1 },
  Mage: { maxHp: 16, atk: 9, def: 2, move: 3, range: 2 },
  Barbarian: { maxHp: 27, atk: 11, def: 3, move: 3, range: 1 },
  Cleric: { maxHp: 18, atk: 6, def: 4, move: 3, range: 1 },
  Dancer: { maxHp: 16, atk: 6, def: 2, move: 4, range: 1 },
};

export const ALL_CLASSES: ClassName[] = [
  'Swordsman',
  'Archer',
  'Lancer',
  'Mage',
  'Barbarian',
  'Cleric',
  'Dancer',
];

/** Flat stat gain per level above 1 — the same curve for every class. */
const LEVEL_GROWTH = { atk: 1, def: 1, maxHp: 2 };

/** The player squad starts stronger than a fresh wave-1 recruit. */
export const PLAYER_START_LEVEL = 5;

/** How much EXP landing an attack grants, and how much a level costs. */
export const EXP_PER_ATTACK = 20;
export const EXP_TO_LEVEL = 100;

/**
 * A class's stats at a given level. Move and range don't scale with level —
 * only atk/def/maxHp do — so higher levels make units hit harder and
 * survive longer without letting them outrun the map's pacing.
 */
export function statsAtLevel(className: ClassName, level: number): ClassStats {
  const base = CLASS_STATS[className];
  const steps = level - 1;
  return {
    maxHp: base.maxHp + LEVEL_GROWTH.maxHp * steps,
    atk: base.atk + LEVEL_GROWTH.atk * steps,
    def: base.def + LEVEL_GROWTH.def * steps,
    move: base.move,
    range: base.range,
  };
}
