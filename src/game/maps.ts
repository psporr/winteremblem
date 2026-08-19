import type { EquipmentSlots, GameMode, GameState, Item, ObjectiveType, Team, TerrainType, Unit } from './types';
import { ALL_CLASSES, PLAYER_START_LEVEL, statsAtLevel, type ClassName } from './classes';
import type { DialogueScript, MapEvent } from './story';

/**
 * What a player squad carries from one campaign chapter into the next:
 * level/exp/equipment per surviving unit (keyed by the unit id shared
 * across every chapter's roster) plus the shared inventory. A unit id with
 * no entry here just starts that chapter at its authored defaults — covers
 * both a fallen unit (rejoins fresh rather than staying dead across
 * chapters) and a unit new to a later chapter.
 */
export interface CampaignCarryOver {
  units: Record<string, { level: number; exp: number; equipment: EquipmentSlots }>;
  inventory: Item[];
  nextItemInstance: number;
}

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
  /** Shown once, full-screen, before the battle becomes playable. Roguelike chapters have none. */
  intro?: DialogueScript;
  /** Shown once the objective is cleared, before returning to chapter select. */
  outro?: DialogueScript;
  /** Story beats that can interrupt play once their trigger condition is met. */
  events?: MapEvent[];
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
export function buildGameState(
  chapter: ChapterDef,
  mode: GameMode,
  random: ShuffleAPI,
  carryOver?: CampaignCarryOver,
  /**
   * What a player unit starts at when it has no carry-over entry. Defaults
   * to PLAYER_START_LEVEL — the caller only overrides this for a campaign
   * chapter entered directly through Chapter Select, where it's set to
   * PLAYER_START_LEVEL plus the chapter's position in the list, so jumping
   * straight into a later chapter doesn't leave the squad under-levelled
   * for it the way a flat starting level would.
   */
  baseLevel: number = PLAYER_START_LEVEL,
): GameState {
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
    // A unit carried over from a previous campaign chapter picks up where it
    // left off; anyone else — roguelike, a fresh campaign chapter, a unit
    // that fell and wasn't in the carry-over — starts at its authored
    // default. Enemies never carry over.
    const carried = spec.team === 'player' ? carryOver?.units[spec.id] : undefined;
    // The squad starts battle-tested; a fresh wave-1 enemy hasn't seen combat yet.
    const level = carried?.level ?? (spec.team === 'player' ? baseLevel : 1);
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
      exp: carried?.exp ?? 0,
      equipment: carried?.equipment ?? {},
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
    inventory: carryOver?.inventory ?? [],
    nextItemInstance: carryOver?.nextItemInstance ?? 0,
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
    { id: 'lyn', name: 'Eirika', team: 'player', className: 'Swordsman', x: 1, y: 6 },
    { id: 'byleth', name: 'Byleth', team: 'player', className: 'Archer', x: 1, y: 7 },
    { id: 'corrin', name: 'Corrin', team: 'player', className: 'Lancer', x: 4, y: 6 },
    { id: 'selva', name: 'Selva', team: 'player', className: 'Mage', x: 4, y: 7 },
    { id: 'ake', name: 'Ike', team: 'player', className: 'Barbarian', x: 2, y: 6 },
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
  intro: [
    { speaker: 'Eirika', portraitClass: 'Swordsman', text: 'That wall ahead is the Iron Gate. Whoever holds it controls the whole pass.' },
    { speaker: 'Corrin', portraitClass: 'Lancer', text: "And right now that's a garrison that isn't expecting company." },
    { speaker: 'Lissa', portraitClass: 'Cleric', text: "Then let's make sure they regret that. I'll keep everyone standing." },
    { speaker: 'Eirika', portraitClass: 'Swordsman', text: 'Two chokepoints, archers on the walls. Watch your approach — we go together.' },
  ],
  outro: [
    { speaker: 'Corrin', portraitClass: 'Lancer', text: 'Gate secured. Whatever they were guarding, it was ours today.' },
    { speaker: 'Eirika', portraitClass: 'Swordsman', text: "This was only the first line. There's a longer road past this ridge — the Long March, the scouts call it." },
    { speaker: 'Eirika', portraitClass: 'Swordsman', text: "Rest while you can. We move again soon." },
  ],
  events: [
    {
      id: 'gate-chief-falls',
      trigger: { type: 'unitDefeated', unitId: 'gate-chief' },
      script: [
        { speaker: 'Gate Chief', portraitClass: 'Barbarian', side: 'right', text: "The gate... was never meant to hold..." },
        { speaker: 'Eirika', portraitClass: 'Swordsman', text: "Their chief's down. Stay sharp — the rest will scatter or dig in." },
      ],
    },
  ],
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
    { id: 'lyn', name: 'Eirika', team: 'player', className: 'Swordsman', x: 1, y: 6 },
    { id: 'ake', name: 'Ike', team: 'player', className: 'Barbarian', x: 2, y: 6 },
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

/**
 * The large map type: 11x14, roughly double the small map's footprint.
 *
 * Too big to show at the small map's tile size on a phone, so the board
 * offers two views on it (see ZoomMode in Board.tsx) — a fit view showing
 * every tile at once, and a detail view at the same tile size the 7x8 map
 * uses. Campaign-only: the roguelike's wave spawner is tuned around the
 * small map's two-row enemy zone.
 *
 * The squad starts along the bottom edge and the garrison holds the top and
 * the middle band, so closing the distance is a real part of the chapter
 * rather than a first-turn scrap. Two broken wall lines split the field into
 * three bands with gaps at the centre and both flanks, and paired forest
 * blocks give cover on the approach to each.
 */
export const CAMPAIGN_CHAPTER_2: ChapterDef = {
  id: 'longmarch-vale',
  name: 'Chapter 2: The Long March',
  shortName: 'The Long March',
  objective: 'Defeat all enemies',
  objectiveType: 'rout',
  intro: [
    { speaker: 'Eirika', portraitClass: 'Swordsman', text: "This is the vale the scouts warned us about. Three bands of wall, garrison dug into all of them." },
    { speaker: 'Selva', portraitClass: 'Mage', text: "I'm reading at least one adept among them. Save your charges for whoever's holding the center." },
    { speaker: 'Ike', portraitClass: 'Barbarian', text: "Long march, they call it. Feels more like a long line of people about to have a bad day." },
    { speaker: 'Eirika', portraitClass: 'Swordsman', text: "Stay together at the gaps. We push through band by band." },
  ],
  outro: [
    { speaker: 'Eirika', portraitClass: 'Swordsman', text: "The vale's ours. Whatever they were massing here, it stops today." },
    { speaker: 'Corrin', portraitClass: 'Lancer', text: "Two gates down. I'd like to say it gets easier from here." },
    { speaker: 'Eirika', portraitClass: 'Swordsman', text: "It won't. But neither will we." },
  ],
  events: [
    {
      id: 'march-second-wave',
      trigger: { type: 'turnReached', team: 'enemy', turn: 2 },
      script: [
        { speaker: 'Vale Captain', portraitClass: 'Barbarian', side: 'right', text: "They're already past the outer wall? Signal the inner bands — hold nothing back." },
      ],
    },
    {
      id: 'march-breach-center',
      trigger: { type: 'unitReachesTile', x: 5, y: 9, team: 'player' },
      script: [
        { speaker: 'Corrin', portraitClass: 'Lancer', text: "We're through the center band. The vale opens up from here." },
      ],
    },
    {
      id: 'march-garrison-thinning',
      trigger: { type: 'enemyCountAtMost', count: 4 },
      script: [
        { speaker: 'Selva', portraitClass: 'Mage', text: "Their line's breaking. Just the captain and a handful left holding the far wall." },
      ],
    },
    {
      id: 'march-captain-falls',
      trigger: { type: 'unitDefeated', unitId: 'march-captain' },
      script: [
        { speaker: 'Vale Captain', portraitClass: 'Barbarian', side: 'right', text: "Impossible... the vale was supposed to hold..." },
        { speaker: 'Eirika', portraitClass: 'Swordsman', text: "Captain's down. Finish this and let's get everyone home." },
      ],
    },
  ],
  rows: [
    '..##...##..',
    '...........',
    '.ff.....ff.',
    '.ff.....ff.',
    '...........',
    '..###.###..',
    '...........',
    '..ff...ff..',
    '..ff...ff..',
    '...........',
    '..###.###..',
    '...........',
    '.ff.....ff.',
    '...........',
  ],
  units: [
    { id: 'lyn', name: 'Eirika', team: 'player', className: 'Swordsman', x: 2, y: 13 },
    { id: 'ake', name: 'Ike', team: 'player', className: 'Barbarian', x: 3, y: 13 },
    { id: 'lissa', name: 'Lissa', team: 'player', className: 'Cleric', x: 4, y: 13 },
    { id: 'corrin', name: 'Corrin', team: 'player', className: 'Lancer', x: 5, y: 13 },
    { id: 'olivia', name: 'Olivia', team: 'player', className: 'Dancer', x: 6, y: 13 },
    { id: 'byleth', name: 'Byleth', team: 'player', className: 'Archer', x: 3, y: 12 },
    { id: 'selva', name: 'Selva', team: 'player', className: 'Mage', x: 6, y: 12 },
    { id: 'march-captain', name: 'Vale Captain', team: 'enemy', className: 'Barbarian', x: 5, y: 0 },
    { id: 'march-bow-1', name: 'Vale Archer', team: 'enemy', className: 'Archer', x: 1, y: 1 },
    { id: 'march-bow-2', name: 'Vale Archer', team: 'enemy', className: 'Archer', x: 9, y: 1 },
    { id: 'march-guard-1', name: 'Vale Guard', team: 'enemy', className: 'Swordsman', x: 2, y: 4 },
    { id: 'march-guard-2', name: 'Vale Guard', team: 'enemy', className: 'Lancer', x: 8, y: 4 },
    { id: 'march-mage', name: 'Vale Adept', team: 'enemy', className: 'Mage', x: 5, y: 6 },
    { id: 'march-scout-1', name: 'Vale Scout', team: 'enemy', className: 'Swordsman', x: 1, y: 6 },
    { id: 'march-scout-2', name: 'Vale Scout', team: 'enemy', className: 'Lancer', x: 9, y: 6 },
  ],
};

/** Every chapter the campaign can load, in play order. */
export const CAMPAIGN_CHAPTERS: ChapterDef[] = [CAMPAIGN_CHAPTER_1, CAMPAIGN_CHAPTER_2];
