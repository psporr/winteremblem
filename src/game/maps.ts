import type { GameState, TerrainType, Unit } from './types';

/**
 * Maps are authored as ASCII art so they stay easy to eyeball and tweak:
 *   '.' plain   'f' forest   '#' wall
 */
const LEGEND: Record<string, TerrainType> = {
  '.': 'plain',
  f: 'forest',
  '#': 'wall',
};

export interface UnitSpec extends Omit<Unit, 'hp' | 'hasMoved' | 'hasActed'> {
  hp?: number;
}

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

/** Expands a chapter definition into the initial mutable game state. */
export function buildGameState(chapter: ChapterDef): GameState {
  const tiles = parseTiles(chapter.rows);
  const width = tiles[0]?.length ?? 0;

  if (tiles.some((row) => row.length !== width)) {
    throw new Error(`Chapter "${chapter.name}" has rows of differing widths`);
  }

  const units: Record<string, Unit> = {};
  for (const spec of chapter.units) {
    units[spec.id] = {
      ...spec,
      hp: spec.hp ?? spec.maxHp,
      hasMoved: false,
      hasActed: false,
    };
  }

  return {
    chapterName: chapter.name,
    objective: chapter.objective,
    width,
    height: tiles.length,
    tiles,
    units,
    log: [`${chapter.name} — ${chapter.objective}`],
  };
}

export const CHAPTER_1: ChapterDef = {
  name: 'Chapter 1: The Frozen Pass',
  objective: 'Defeat all enemies',
  rows: [
    '..ff....##....',
    '..ff.....#....',
    '.....ff.......',
    '##.....ff.....',
    '##......f.....',
    '.....ff.......',
    '..ff.....#....',
    '..ff....##....',
  ],
  units: [
    {
      id: 'brann',
      name: 'Brann',
      team: 'player',
      className: 'Knight',
      x: 2,
      y: 3,
      maxHp: 26,
      atk: 8,
      def: 8,
      move: 4,
      range: 1,
    },
    {
      id: 'sela',
      name: 'Sela',
      team: 'player',
      className: 'Fighter',
      x: 2,
      y: 4,
      maxHp: 24,
      atk: 10,
      def: 4,
      move: 5,
      range: 1,
    },
    {
      id: 'iris',
      name: 'Iris',
      team: 'player',
      className: 'Archer',
      x: 1,
      y: 2,
      maxHp: 16,
      atk: 9,
      def: 2,
      move: 5,
      range: 2,
    },
    {
      id: 'rowan',
      name: 'Rowan',
      team: 'player',
      className: 'Cavalier',
      x: 1,
      y: 5,
      maxHp: 22,
      atk: 9,
      def: 5,
      move: 7,
      range: 1,
    },
    {
      id: 'brigand-a',
      name: 'Brigand',
      team: 'enemy',
      className: 'Brigand',
      x: 10,
      y: 1,
      maxHp: 20,
      atk: 8,
      def: 3,
      move: 5,
      range: 1,
    },
    {
      id: 'brigand-b',
      name: 'Brigand',
      team: 'enemy',
      className: 'Brigand',
      x: 10,
      y: 6,
      maxHp: 20,
      atk: 8,
      def: 3,
      move: 5,
      range: 1,
    },
    {
      id: 'brigand-c',
      name: 'Brigand',
      team: 'enemy',
      className: 'Brigand',
      x: 9,
      y: 4,
      maxHp: 20,
      atk: 8,
      def: 3,
      move: 5,
      range: 1,
    },
    {
      id: 'archer-a',
      name: 'Archer',
      team: 'enemy',
      className: 'Archer',
      x: 11,
      y: 3,
      maxHp: 18,
      atk: 8,
      def: 2,
      move: 4,
      range: 2,
    },
    {
      id: 'chief',
      name: 'Gorlac',
      team: 'enemy',
      className: 'Chieftain',
      x: 12,
      y: 4,
      maxHp: 30,
      atk: 11,
      def: 5,
      move: 4,
      range: 1,
    },
  ],
};
