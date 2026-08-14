import type { GameState, Unit } from './types';
import { manhattan, terrainAt } from './grid';

/**
 * Damage is deliberately deterministic for v1 — no hit rate, no criticals.
 * A minimum of 1 keeps battles from stalling into unbreakable defences.
 */
export function computeDamage(G: GameState, attacker: Unit, defender: Unit): number {
  const cover = terrainAt(G, defender.x, defender.y).defBonus;
  return Math.max(1, attacker.atk - (defender.def + cover));
}

/** A defender strikes back only if the attacker is within its own reach. */
export function canCounter(attacker: Unit, defender: Unit): boolean {
  return manhattan(attacker, defender) <= defender.range;
}

export interface CombatForecast {
  damageDealt: number;
  defenderHpAfter: number;
  willKill: boolean;
  counterDamage: number | null;
  attackerHpAfter: number;
  attackerWillDie: boolean;
}

/** Pure preview of an exchange, used both by the UI panel and the enemy AI. */
export function forecastCombat(G: GameState, attacker: Unit, defender: Unit): CombatForecast {
  const damageDealt = computeDamage(G, attacker, defender);
  const defenderHpAfter = Math.max(0, defender.hp - damageDealt);
  const willKill = defenderHpAfter === 0;

  const counters = !willKill && canCounter(attacker, defender);
  const counterDamage = counters ? computeDamage(G, defender, attacker) : null;
  const attackerHpAfter = Math.max(0, attacker.hp - (counterDamage ?? 0));

  return {
    damageDealt,
    defenderHpAfter,
    willKill,
    counterDamage,
    attackerHpAfter,
    attackerWillDie: attackerHpAfter === 0,
  };
}
