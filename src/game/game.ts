import type { Ctx, Game, MoveMap } from 'boardgame.io';
import { INVALID_MOVE } from 'boardgame.io/core';

import type { GameState, Team, Unit } from './types';
import { PLAYER_ID, teamOf } from './types';
import { buildGameState, CHAPTER_1 } from './maps';
import { computeReachable, manhattan, tileKey, unitsOf } from './grid';
import { forecastCombat } from './combat';

const MAX_LOG_ENTRIES = 40;

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

export const attackUnit = (
  { G, ctx }: { G: GameState; ctx: Ctx },
  attackerId: string,
  targetId: string,
) => {
  const attacker = activeUnit(G, ctx, attackerId);
  const target = G.units[targetId];
  if (!attacker || !target) return INVALID_MOVE;
  if (target.team === attacker.team) return INVALID_MOVE;
  if (manhattan(attacker, target) > attacker.range) return INVALID_MOVE;

  const result = forecastCombat(G, attacker, target);

  target.hp = result.defenderHpAfter;
  pushLog(G, `${attacker.name} hits ${target.name} for ${result.damageDealt}.`);

  if (result.willKill) {
    pushLog(G, `${target.name} has fallen!`);
    delete G.units[targetId];
  } else if (result.counterDamage !== null) {
    attacker.hp = result.attackerHpAfter;
    pushLog(G, `${target.name} counters for ${result.counterDamage}.`);
    if (result.attackerWillDie) {
      pushLog(G, `${attacker.name} has fallen!`);
      delete G.units[attackerId];
      return;
    }
  }

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

const moves: MoveMap<GameState> = { moveUnit, attackUnit, waitUnit };

function livingTeams(G: GameState): Record<Team, Unit[]> {
  return { player: unitsOf(G, 'player'), enemy: unitsOf(G, 'enemy') };
}

export interface GameOver {
  winner: Team;
}

export const WinterEmblem: Game<GameState> = {
  name: 'winter-emblem',

  setup: () => buildGameState(CHAPTER_1),

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
      }
      pushLog(G, team === 'player' ? '— Player phase —' : '— Enemy phase —');
    },

    // The phase ends on its own once every unit on the active side is spent.
    endIf: ({ G, ctx }) => {
      const units = unitsOf(G, teamOf(ctx.currentPlayer));
      return units.length > 0 && units.every((unit) => unit.hasActed);
    },
  },

  endIf: ({ G }): GameOver | undefined => {
    const { player, enemy } = livingTeams(G);
    if (enemy.length === 0) return { winner: 'player' };
    if (player.length === 0) return { winner: 'enemy' };
    return undefined;
  },
};

export { PLAYER_ID };
