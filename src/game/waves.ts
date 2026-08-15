import type { GameState, Unit } from './types';
import { ALL_CLASSES, statsAtLevel } from './classes';
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

/**
 * Spawns a fresh, procedurally composed wave directly into G.units.
 * Class assignment reuses the same "shuffle once, no duplicates until the
 * pool wraps" approach as the starting Bandits, so composition is balanced
 * but different every wave. Enemy level equals the wave number — wave 1 is
 * level 1, matching a fresh recruit — so difficulty scales through the same
 * level/stat system the player squad levels up through.
 */
export function spawnWave(G: GameState, wave: number, random: ShuffleAPI): void {
  const count = enemyCountForWave(wave);
  const pool = random.Shuffle(enemySpawnPool(G));
  if (pool.length < count) {
    throw new Error(`Not enough enemy spawn tiles (${pool.length}) for a wave of ${count}`);
  }

  const classOrder = random.Shuffle(ALL_CLASSES);

  for (let i = 0; i < count; i++) {
    const className = classOrder[i % classOrder.length];
    const stats = statsAtLevel(className, wave);
    const id = `enemy-w${wave}-${i}`;

    const unit: Unit = {
      id,
      name: `Bandit ${i + 1}`,
      team: 'enemy',
      className,
      x: pool[i].x,
      y: pool[i].y,
      hp: stats.maxHp,
      maxHp: stats.maxHp,
      atk: stats.atk,
      def: stats.def,
      move: stats.move,
      range: stats.range,
      hasMoved: false,
      hasActed: false,
      level: wave,
      exp: 0,
      equipment: {},
      skillCooldown: 0,
    };

    G.units[id] = unit;
  }
}
