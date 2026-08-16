import type { GameState, Unit } from './types';
import { manhattan, terrainAt } from './grid';
import { effectiveStats, equippedCounterReduction } from './equipment';

/**
 * Damage is deliberately deterministic for v1 — no hit rate, no criticals.
 * A minimum of 1 keeps battles from stalling into unbreakable defences.
 * Folds in two permanent blessing effects: Ironclad doubles (or more,
 * stacked) the terrain bonus for a defending player unit, and Executioner
 * adds flat damage for a player attacker against a target at or below half HP.
 */
export function computeDamage(G: GameState, attacker: Unit, defender: Unit): number {
  const terrainBonus = terrainAt(G, defender.x, defender.y).defBonus;
  const cover = defender.team === 'player' ? terrainBonus * G.modifiers.terrainDefMultiplier : terrainBonus;

  let damage = effectiveStats(attacker).atk - (effectiveStats(defender).def + cover);
  if (attacker.team === 'player' && defender.hp <= defender.maxHp / 2) {
    damage += G.modifiers.executionerBonus;
  }
  return Math.max(1, damage);
}

/** A defender strikes back only if the attacker is within its own reach. */
export function canCounter(attacker: Unit, defender: Unit): boolean {
  return manhattan(attacker, defender) <= effectiveStats(defender).range;
}

/**
 * Damage `defender` deals back to `attacker` on a counter — the one place
 * Thorns (bonus for a player counterer) and Dragonscale (reduction for the
 * original attacker, who's on the receiving end of this counter) both
 * apply, so every counter calculation in the game shares this and can't
 * disagree with another.
 */
export function computeCounterDamage(G: GameState, defender: Unit, attacker: Unit): number {
  let damage = computeDamage(G, defender, attacker);
  if (defender.team === 'player') damage += G.modifiers.counterBonus;
  return Math.max(1, damage - equippedCounterReduction(attacker));
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
  const counterDamage = counters ? computeCounterDamage(G, defender, attacker) : null;
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
