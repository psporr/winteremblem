import type { GameState, Unit } from './types';
import { ALL_CLASSES, CLASS_STATS } from './classes';
import type { ShuffleAPI } from './maps';
import { terrainAt } from './grid';

const BASE_ENEMY_COUNT = 4;
const MAX_ENEMIES = 6;

/** Enemies spawn in the top two rows — mirrors the player's own start rows. */
const ENEMY_ZONE_ROWS = [0, 1];

interface Coord {
  x: number;
  y: number;
}

function enemySpawnPool(G: GameState): Coord[] {
  const pool: Coord[] = [];
  for (const y of ENEMY_ZONE_ROWS) {
    for (let x = 0; x < G.width; x++) {
      if (terrainAt(G, x, y).passable) pool.push({ x, y });
    }
  }
  return pool;
}

function enemyCountForWave(wave: number): number {
  return Math.min(BASE_ENEMY_COUNT + Math.floor((wave - 1) / 2), MAX_ENEMIES);
}

/** Flat stat bonus applied per wave beyond the first, so later waves hit harder. */
function scaleForWave(wave: number) {
  const bonus = wave - 1;
  return { atk: bonus, def: bonus, maxHp: bonus * 2 };
}

/**
 * Spawns a fresh, procedurally composed wave directly into G.units.
 * Class assignment reuses the same "shuffle once, no duplicates until the
 * pool wraps" approach as the starting Bandits, so composition is balanced
 * but different every wave.
 */
export function spawnWave(G: GameState, wave: number, random: ShuffleAPI): void {
  const count = enemyCountForWave(wave);
  const pool = random.Shuffle(enemySpawnPool(G));
  if (pool.length < count) {
    throw new Error(`Not enough enemy spawn tiles (${pool.length}) for a wave of ${count}`);
  }

  const classOrder = random.Shuffle(ALL_CLASSES);
  const scale = scaleForWave(wave);

  for (let i = 0; i < count; i++) {
    const className = classOrder[i % classOrder.length];
    const base = CLASS_STATS[className];
    const maxHp = base.maxHp + scale.maxHp;
    const id = `enemy-w${wave}-${i}`;

    const unit: Unit = {
      id,
      name: `Bandit ${i + 1}`,
      team: 'enemy',
      className,
      x: pool[i].x,
      y: pool[i].y,
      hp: maxHp,
      maxHp,
      atk: base.atk + scale.atk,
      def: base.def + scale.def,
      move: base.move,
      range: base.range,
      hasMoved: false,
      hasActed: false,
    };

    G.units[id] = unit;
  }
}
