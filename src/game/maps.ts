import type { GameState, Team, TerrainType, Unit } from './types';
import { ALL_CLASSES, PLAYER_START_LEVEL, statsAtLevel, type ClassName } from './classes';

/**
 * The slice of boardgame.io's RandomAPI we actually need. Defined locally
 * rather than imported — boardgame.io's package `types` entry doesn't
 * re-export RandomAPI, only uses it internally.
 */
export interface ShuffleAPI {
  Shuffle<T>(deck: T[]): T[];
}

/**
 * Maps are authored as ASCII art so they stay easy to eyeball and tweak:
 *   '.' plain   'f' forest   '#' wall
 */
const LEGEND: Record<string, TerrainType> = {
  '.': 'plain',
  f: 'forest',
  '#': 'wall',
};

interface UnitPlacement {
  id: string;
  name: string;
  team: Team;
  x: number;
  y: number;
}

/** A unit whose class (and therefore stats) is fixed at authoring time. */
export interface FixedClassUnitSpec extends UnitPlacement {
  className: ClassName;
}

/** A unit whose class is drawn from the full class pool when the chapter starts. */
export interface RandomClassUnitSpec extends UnitPlacement {
  randomClass: true;
}

export type UnitSpec = FixedClassUnitSpec | RandomClassUnitSpec;

export interface ChapterDef {
  name: string;
  objective: string;
  rows: string[];
  units: UnitSpec[];
}

function parseTiles(rows: string[]): TerrainType[][] {
  return rows.map((row, y) =>
    [...row].map((char, x) => {
      const terrain = LEGEND[char];
      if (!terrain) {
        throw new Error(`Unknown map character "${char}" at (${x}, ${y})`);
      }
      return terrain;
    }),
  );
}

/**
 * Expands a chapter definition into the initial mutable game state.
 *
 * `random` resolves any `randomClass` units — each draws a distinct class
 * from a single shuffle of the full class pool, so a chapter with up to
 * `ALL_CLASSES.length` random units gets balanced, no-duplicate coverage
 * that's still shuffled differently every battle.
 */
export function buildGameState(chapter: ChapterDef, random: ShuffleAPI): GameState {
  const tiles = parseTiles(chapter.rows);
  const width = tiles[0]?.length ?? 0;

  if (tiles.some((row) => row.length !== width)) {
    throw new Error(`Chapter "${chapter.name}" has rows of differing widths`);
  }

  const shuffledClasses = random.Shuffle(ALL_CLASSES);
  let nextRandomClassIndex = 0;

  const units: Record<string, Unit> = {};
  for (const spec of chapter.units) {
    const className =
      'className' in spec ? spec.className : shuffledClasses[nextRandomClassIndex++ % shuffledClasses.length];
    // The squad starts battle-tested; a fresh wave-1 enemy hasn't seen combat yet.
    const level = spec.team === 'player' ? PLAYER_START_LEVEL : 1;
    const stats = statsAtLevel(className, level);

    units[spec.id] = {
      id: spec.id,
      name: spec.name,
      team: spec.team,
      className,
      x: spec.x,
      y: spec.y,
      hp: stats.maxHp,
      maxHp: stats.maxHp,
      atk: stats.atk,
      def: stats.def,
      move: stats.move,
      range: stats.range,
      hasMoved: false,
      hasActed: false,
      level,
      exp: 0,
      equipment: {},
    };
  }

  return {
    chapterName: chapter.name,
    objective: chapter.objective,
    width,
    height: tiles.length,
    tiles,
    units,
    log: ['Wave 1 Starts'],
    wave: 1,
    awaitingBlessing: false,
    inventory: [],
    nextItemInstance: 0,
  };
}

/** Where each player unit starts — waves reset the squad here between fights. */
export function playerStartPositions(chapter: ChapterDef): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  for (const spec of chapter.units) {
    if (spec.team === 'player') positions[spec.id] = { x: spec.x, y: spec.y };
  }
  return positions;
}

/**
 * 7x8 portrait grid — one column wider than Fire Emblem Heroes' standard 6x8,
 * added as an open flanking lane on the right. Tile size is responsive (see
 * board.css's --tile), so this still fits a mobile viewport without
 * horizontal scrolling.
 */
export const CHAPTER_1: ChapterDef = {
  name: 'Chapter 1: The Frozen Pass',
  objective: 'Survive as many waves as you can',
  rows: [
    '..##...',
    '.......',
    '.ff....',
    '...ff..',
    '.ff....',
    '...ff..',
    '.......',
    '..##...',
  ],
  units: [
    { id: 'lyn', name: 'Lyn', team: 'player', className: 'Swordsman', x: 1, y: 6 },
    { id: 'byleth', name: 'Byleth', team: 'player', className: 'Archer', x: 1, y: 7 },
    { id: 'corrin', name: 'Corrin', team: 'player', className: 'Lancer', x: 4, y: 6 },
    { id: 'selva', name: 'Selva', team: 'player', className: 'Mage', x: 4, y: 7 },
    { id: 'ake', name: 'Ake', team: 'player', className: 'Barbarian', x: 2, y: 6 },
    { id: 'lissa', name: 'Lissa', team: 'player', className: 'Cleric', x: 3, y: 6 },
    { id: 'olivia', name: 'Olivia', team: 'player', className: 'Dancer', x: 5, y: 6 },
    { id: 'bandit-1', name: 'Bandit 1', team: 'enemy', randomClass: true, x: 1, y: 0 },
    { id: 'bandit-2', name: 'Bandit 2', team: 'enemy', randomClass: true, x: 4, y: 0 },
    { id: 'bandit-3', name: 'Bandit 3', team: 'enemy', randomClass: true, x: 1, y: 1 },
    { id: 'bandit-4', name: 'Bandit 4', team: 'enemy', randomClass: true, x: 4, y: 1 },
  ],
};
