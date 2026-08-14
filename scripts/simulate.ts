/**
 * Headless battle runner.
 *
 * Drives both armies with the built-in AI to prove the rules loop terminates:
 * phases alternate, units act, and a win condition is actually reached.
 *
 *   npm run sim
 */
import { Client } from 'boardgame.io/client';

import { WinterEmblem, type GameOver } from '../src/game/game';
import { decideAction } from '../src/game/ai';
import { teamOf } from '../src/game/types';
import { unitsOf } from '../src/game/grid';

const MAX_ACTIONS = 5000;

const client = Client({ game: WinterEmblem, numPlayers: 2 });
client.start();

let actions = 0;
let lastTurn = -1;

while (actions < MAX_ACTIONS) {
  const state = client.getState();
  if (!state) throw new Error('Client produced no state');
  if (state.ctx.gameover) break;

  const { G, ctx } = state;

  if (ctx.turn !== lastTurn) {
    lastTurn = ctx.turn;
    const player = unitsOf(G, 'player').length;
    const enemy = unitsOf(G, 'enemy').length;
    console.log(
      `turn ${String(ctx.turn).padStart(2)}  ${teamOf(ctx.currentPlayer).padEnd(6)}  ` +
        `player:${player} enemy:${enemy}`,
    );
  }

  const action = decideAction(G, teamOf(ctx.currentPlayer));
  if (!action) {
    client.events.endTurn?.();
    continue;
  }

  if (action.type === 'move') client.moves.moveUnit(action.unitId, action.x, action.y);
  else if (action.type === 'attack') client.moves.attackUnit(action.attackerId, action.targetId);
  else client.moves.waitUnit(action.unitId);

  actions++;
}

const final = client.getState();
const gameover = final?.ctx.gameover as GameOver | undefined;

if (!gameover) {
  console.error(`\nFAIL: no winner after ${actions} actions (possible stalemate)`);
  process.exit(1);
}

console.log(`\nWinner: ${gameover.winner}  (${actions} actions)`);
console.log('Recent log:');
for (const entry of (final?.G.log ?? []).slice(0, 8)) console.log('  ' + entry);
