import type { GameMode, GameState, ObjectiveType, Team, TerrainType, Unit } from './types';
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
  id: string;
  /** Full title, shown on the chapter-select screen. */
  name: string;
  /**
   * Compact title for the in-battle header, which sits beside the icon row
   * and has very little width on a phone. Explicit rather than derived by
   * splitting `name` on ':' so a chapter can choose its own abbreviation.
   */
  shortName: string;
  objective: string;
  objectiveType: ObjectiveType;
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
export function buildGameState(chapter: ChapterDef, mode: GameMode, random: ShuffleAPI): GameState {
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
      // Roguelike enemies are anonymous rank-and-file, so their display name
      // is always derived from class — matches the convention spawnWave uses
      // for later waves. Campaign enemies keep their authored name instead:
      // chapters are hand-written and will eventually carry story around
      // named individuals (a chapter boss, a recurring rival), which a
      // class-derived label would erase.
      name: spec.team === 'enemy' && mode === 'roguelike' ? `${className} Shadow` : spec.name,
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
      skillCooldown: 0,
    };
  }

  return {
    mode,
    objectiveType: chapter.objectiveType,
    chapterId: chapter.id,
    chapterName: chapter.name,
    chapterShortName: chapter.shortName,
    objective: chapter.objective,
    playerStart: playerStartPositions(chapter),
    width,
    height: tiles.length,
    tiles,
    units,
    log: [mode === 'campaign' ? chapter.name : 'Wave 1 Starts'],
    wave: 1,
    awaitingBlessing: false,
    inventory: [],
    nextItemInstance: 0,
    modifiers: {
      counterBonus: 0,
      cooldownReduction: 0,
      healPerTurn: 0,
      terrainDefMultiplier: 1,
      executionerBonus: 0,
      guardianAngelMax: 0,
      guardianAngelCharges: 0,
      dropChanceMultiplier: 1,
    },
    fallenUnits: [],
    offeredBlessingIds: [],
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
  id: 'frozen-pass',
  name: 'The Frozen Pass',
  shortName: 'The Frozen Pass',
  objective: 'Survive as many waves as you can',
  objectiveType: 'waves',
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

/**
 * First campaign chapter. Unlike the roguelike map, enemy classes are fixed
 * rather than drawn at random — a campaign encounter is hand-balanced, so
 * the player can plan around a known composition. The wall band across the
 * middle splits the field into two chokepoints, making the approach a real
 * decision instead of a straight charge.
 */
export const CAMPAIGN_CHAPTER_1: ChapterDef = {
  id: 'iron-gate',
  name: 'Chapter 1: The Iron Gate',
  shortName: 'The Iron Gate',
  objective: 'Defeat all enemies',
  objectiveType: 'rout',
  rows: [
    '..###..',
    '.......',
    'ff...ff',
    '..###..',
    '.......',
    '.ff.ff.',
    '.......',
    '...#...',
  ],
  units: [
    { id: 'lyn', name: 'Lyn', team: 'player', className: 'Swordsman', x: 1, y: 6 },
    { id: 'ake', name: 'Ake', team: 'player', className: 'Barbarian', x: 2, y: 6 },
    { id: 'lissa', name: 'Lissa', team: 'player', className: 'Cleric', x: 3, y: 6 },
    { id: 'corrin', name: 'Corrin', team: 'player', className: 'Lancer', x: 4, y: 6 },
    { id: 'olivia', name: 'Olivia', team: 'player', className: 'Dancer', x: 5, y: 6 },
    { id: 'byleth', name: 'Byleth', team: 'player', className: 'Archer', x: 1, y: 7 },
    { id: 'selva', name: 'Selva', team: 'player', className: 'Mage', x: 4, y: 7 },
    { id: 'gate-chief', name: 'Gate Chief', team: 'enemy', className: 'Barbarian', x: 3, y: 1 },
    { id: 'gate-bow-1', name: 'Gate Archer', team: 'enemy', className: 'Archer', x: 0, y: 1 },
    { id: 'gate-bow-2', name: 'Gate Archer', team: 'enemy', className: 'Archer', x: 6, y: 1 },
    { id: 'gate-guard-1', name: 'Gate Guard', team: 'enemy', className: 'Swordsman', x: 2, y: 2 },
    { id: 'gate-guard-2', name: 'Gate Guard', team: 'enemy', className: 'Lancer', x: 4, y: 2 },
  ],
};

/** Every chapter the campaign can load, in play order. */
export const CAMPAIGN_CHAPTERS: ChapterDef[] = [CAMPAIGN_CHAPTER_1];

/**
 * A deliberately oversized 14x18 map, used only by the zoom demo screen.
 * Nothing in the campaign or roguelike flow references it — its whole job is
 * to be far too big to fit a phone screen, so the board's zoom and panning
 * can be judged against a map the current 7x8 grid never stresses.
 *
 * Player units start bottom-left; enemies hold the top and the far right, so
 * reaching them actually requires crossing the map rather than trading blows
 * on turn one. Terrain is laid out as two forest belts and a broken wall line
 * so there are real chokepoints at this scale.
 */
export const LARGE_MAP_DEMO: ChapterDef = {
  id: 'wide-vale',
  name: 'The Wide Vale (zoom demo)',
  shortName: 'Wide Vale',
  objective: 'Survive as many waves as you can',
  objectiveType: 'waves',
  rows: [
    '..##......##..',
    '..............',
    '.ff......ff...',
    '.ff......ff...',
    '..............',
    '....######....',
    '..............',
    '...ff....ff...',
    '...ff....ff...',
    '..............',
    '..######......',
    '..............',
    '.ff.......ff..',
    '.ff.......ff..',
    '..............',
    '....####......',
    '..............',
    '..##......##..',
  ],
  units: [
    { id: 'lyn', name: 'Lyn', team: 'player', className: 'Swordsman', x: 1, y: 16 },
    { id: 'ake', name: 'Ake', team: 'player', className: 'Barbarian', x: 2, y: 16 },
    { id: 'lissa', name: 'Lissa', team: 'player', className: 'Cleric', x: 3, y: 16 },
    { id: 'corrin', name: 'Corrin', team: 'player', className: 'Lancer', x: 4, y: 16 },
    { id: 'olivia', name: 'Olivia', team: 'player', className: 'Dancer', x: 5, y: 16 },
    { id: 'byleth', name: 'Byleth', team: 'player', className: 'Archer', x: 1, y: 17 },
    { id: 'selva', name: 'Selva', team: 'player', className: 'Mage', x: 4, y: 17 },
    { id: 'vale-1', name: 'Vale Raider', team: 'enemy', randomClass: true, x: 1, y: 1 },
    { id: 'vale-2', name: 'Vale Raider', team: 'enemy', randomClass: true, x: 5, y: 0 },
    { id: 'vale-3', name: 'Vale Raider', team: 'enemy', randomClass: true, x: 8, y: 1 },
    { id: 'vale-4', name: 'Vale Raider', team: 'enemy', randomClass: true, x: 12, y: 0 },
    { id: 'vale-5', name: 'Vale Raider', team: 'enemy', randomClass: true, x: 12, y: 6 },
    { id: 'vale-6', name: 'Vale Raider', team: 'enemy', randomClass: true, x: 11, y: 11 },
  ],
};
