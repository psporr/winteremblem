/**
 * Headless battle runner.
 *
 * Drives both armies with the built-in AI to prove the wave-survival loop
 * holds up: phases alternate, units act, waves advance via blessings, and
 * the run eventually ends (either the squad wipes, or we've proven several
 * waves clear cleanly).
 *
 *   npm run sim
 */
import { Client } from 'boardgame.io/client';

import { WinterEmblem, type GameOver } from '../src/game/game';
import { decideAction } from '../src/game/ai';
import { teamOf } from '../src/game/types';
import { unitsOf } from '../src/game/grid';
import { BLESSINGS } from '../src/game/blessings';

const MAX_ACTIONS = 20000;
const WAVE_CAP = 6;

const client = Client({ game: WinterEmblem, numPlayers: 2 });
client.start();

let actions = 0;
let lastTurn = -1;
let lastWave = 0;
let blessingIndex = 0;

while (actions < MAX_ACTIONS) {
  const state = client.getState();
  if (!state) throw new Error('Client produced no state');
  if (state.ctx.gameover) break;

  const { G, ctx } = state;

  if (G.wave !== lastWave) {
    lastWave = G.wave;
    console.log(`\n=== Wave ${G.wave} (${unitsOf(G, 'enemy').length} enemies) ===`);
  }

  if (G.awaitingBlessing) {
    const blessing = BLESSINGS[blessingIndex % BLESSINGS.length];
    blessingIndex++;
    console.log(`  choosing blessing: ${blessing.name}`);
    client.moves.chooseBlessing(blessing.id);
    if (G.wave > WAVE_CAP) break;
    continue;
  }

  if (ctx.turn !== lastTurn) {
    lastTurn = ctx.turn;
    const player = unitsOf(G, 'player').length;
    const enemy = unitsOf(G, 'enemy').length;
    console.log(
      `turn ${String(ctx.turn).padStart(3)}  ${teamOf(ctx.currentPlayer).padEnd(6)}  ` +
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
const waveReached = final?.G.wave ?? 0;

if (!gameover && waveReached <= WAVE_CAP) {
  console.error(`\nFAIL: neither wiped nor reached wave ${WAVE_CAP} after ${actions} actions`);
  process.exit(1);
}

console.log(
  gameover
    ? `\nRun ended: squad wiped on wave ${waveReached}  (${actions} actions)`
    : `\nRun ended: reached wave ${waveReached} without wiping  (${actions} actions)`,
);
console.log('Recent log:');
for (const entry of (final?.G.log ?? []).slice(0, 8)) console.log('  ' + entry);
