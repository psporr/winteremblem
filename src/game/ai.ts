import type { GameState, Team, Unit } from './types';
import { computeReachable, manhattan, unitsOf, type ReachableTile } from './grid';
import { forecastCombat } from './combat';

export type AiAction =
  | { type: 'move'; unitId: string; x: number; y: number }
  | { type: 'attack'; attackerId: string; targetId: string }
  | { type: 'wait'; unitId: string };

interface AttackPlan {
  tile: ReachableTile;
  targetId: string;
  score: number;
}

/**
 * Scores an exchange from the attacker's point of view. Securing a kill
 * dominates everything; after that, deal damage while avoiding a fatal counter.
 */
function scoreAttack(G: GameState, attacker: Unit, tile: ReachableTile, target: Unit): number {
  const fromTile: Unit = { ...attacker, x: tile.x, y: tile.y };
  const result = forecastCombat(G, fromTile, target);

  let score = result.damageDealt * 10;
  if (result.willKill) score += 1000;
  if (result.attackerWillDie) score -= 500;
  score -= result.counterDamage ?? 0;
  // Prefer finishing off units that are already hurt.
  score += (target.maxHp - target.hp) * 2;
  return score;
}

function opposing(team: Team): Team {
  return team === 'player' ? 'enemy' : 'player';
}

function bestAttack(G: GameState, unit: Unit, reachable: Map<string, ReachableTile>): AttackPlan | null {
  const foes = unitsOf(G, opposing(unit.team));
  let best: AttackPlan | null = null;

  for (const tile of reachable.values()) {
    for (const target of foes) {
      if (manhattan(tile, target) > unit.range) continue;

      const score = scoreAttack(G, unit, tile, target);
      if (!best || score > best.score) {
        best = { tile, targetId: target.id, score };
      }
    }
  }

  return best;
}

/** Tile within reach that gets closest to the nearest player unit. */
function bestApproach(
  G: GameState,
  team: Team,
  reachable: Map<string, ReachableTile>,
): ReachableTile | null {
  const foes = unitsOf(G, opposing(team));
  if (foes.length === 0) return null;

  let best: ReachableTile | null = null;
  let bestDistance = Infinity;

  for (const tile of reachable.values()) {
    const distance = Math.min(...foes.map((foe) => manhattan(tile, foe)));
    // Ties go to the cheaper tile so units don't wander needlessly.
    if (distance < bestDistance || (distance === bestDistance && best && tile.cost < best.cost)) {
      best = tile;
      bestDistance = distance;
    }
  }

  return best;
}

/**
 * Picks the next single action for `team`, or null when that side is finished.
 *
 * Deliberately stateless: it re-derives its decision from `G` each call, so the
 * caller can dispatch one action at a time and let the board animate between them.
 */
export function decideAction(G: GameState, team: Team): AiAction | null {
  const pending = unitsOf(G, team)
    .filter((unit) => !unit.hasActed)
    .sort((a, b) => a.id.localeCompare(b.id));

  const unit = pending[0];
  if (!unit) return null;

  const reachable = computeReachable(G, unit);

  const attack = bestAttack(G, unit, reachable);
  if (attack) {
    if (attack.tile.x !== unit.x || attack.tile.y !== unit.y) {
      return { type: 'move', unitId: unit.id, x: attack.tile.x, y: attack.tile.y };
    }
    return { type: 'attack', attackerId: unit.id, targetId: attack.targetId };
  }

  const approach = bestApproach(G, team, reachable);
  if (approach && (approach.x !== unit.x || approach.y !== unit.y)) {
    return { type: 'move', unitId: unit.id, x: approach.x, y: approach.y };
  }

  return { type: 'wait', unitId: unit.id };
}

/** Convenience wrapper for the CPU army the board drives each enemy phase. */
export function decideEnemyAction(G: GameState): AiAction | null {
  return decideAction(G, 'enemy');
}
