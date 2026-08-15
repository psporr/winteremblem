/**
 * Base stats per class. A unit's className always determines its stats —
 * player and enemy units of the same class share the same numbers — so
 * balance changes happen in exactly one place.
 */
export type ClassName = 'Swordsman' | 'Archer' | 'Lancer' | 'Mage';

export interface ClassStats {
  maxHp: number;
  atk: number;
  def: number;
  /** Movement points per turn. */
  move: number;
  /** Attack reach in tiles (Manhattan distance). 1 = melee, 2 = ranged. */
  range: number;
}

export const CLASS_STATS: Record<ClassName, ClassStats> = {
  Swordsman: { maxHp: 24, atk: 9, def: 5, move: 3, range: 1 },
  Archer: { maxHp: 18, atk: 8, def: 3, move: 3, range: 2 },
  Lancer: { maxHp: 22, atk: 8, def: 6, move: 3, range: 1 },
  Mage: { maxHp: 16, atk: 9, def: 2, move: 3, range: 2 },
};

export const ALL_CLASSES: ClassName[] = ['Swordsman', 'Archer', 'Lancer', 'Mage'];
