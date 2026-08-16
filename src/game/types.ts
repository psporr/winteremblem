/**
 * Core data model for BIBI's WinterEmblem.
 *
 * Everything in `GameState` must stay JSON-serialisable: boardgame.io transports
 * it as plain data today, and it will be persisted to Firestore later on.
 */

import type { ClassName } from './classes';

export type Team = 'player' | 'enemy';

/**
 * Roguelike is the endless wave-survival run; campaign is a sequence of
 * hand-authored chapters with their own win conditions. Both share every
 * rule below this line — they differ only in how a battle starts and what
 * counts as clearing it.
 */
export type GameMode = 'roguelike' | 'campaign';

/**
 * What clearing a battle means. 'waves' never ends on its own (roguelike
 * loops until the squad wipes); 'rout' ends the chapter the moment the last
 * enemy falls. More campaign objectives (seize, survive-N-turns) land in
 * phase 2.
 */
export type ObjectiveType = 'waves' | 'rout';

export type TerrainType = 'plain' | 'forest' | 'wall';

export interface Terrain {
  type: TerrainType;
  name: string;
  /** Movement points consumed to enter this tile. Ignored when `passable` is false. */
  moveCost: number;
  passable: boolean;
  /** Added to the occupant's defence while standing here. */
  defBonus: number;
}

export const TERRAIN: Record<TerrainType, Terrain> = {
  plain: { type: 'plain', name: 'Plain', moveCost: 1, passable: true, defBonus: 0 },
  forest: { type: 'forest', name: 'Forest', moveCost: 2, passable: true, defBonus: 2 },
  wall: { type: 'wall', name: 'Wall', moveCost: 0, passable: false, defBonus: 0 },
};

/** A slot an item occupies. Each unit has exactly one of each. */
export type ItemSlot = 'weapon' | 'armor' | 'accessory';

/** A physical dropped item — `defId` looks up its stats in the ITEMS catalog. */
export interface Item {
  instanceId: string;
  defId: string;
}

export type EquipmentSlots = Partial<Record<ItemSlot, Item>>;

/**
 * Squad-wide effects accumulated from "permanent" blessing picks. Each is a
 * running total rather than a boolean, so drawing the same blessing again
 * on a later wave stacks rather than being wasted.
 */
export interface SquadModifiers {
  /** Thorns: bonus damage on a player unit's counterattack. */
  counterBonus: number;
  /** Focus: skill cooldowns reduced by this many turns (floored at 1). */
  cooldownReduction: number;
  /** Mending: squad-wide HP regen at the start of each player phase. */
  healPerTurn: number;
  /** Ironclad: multiplies the terrain defence bonus for player units standing on it. */
  terrainDefMultiplier: number;
  /** Executioner: bonus damage a player unit deals to a target at or below half HP. */
  executionerBonus: number;
  /** Guardian Angel: charges granted at the start of each wave. */
  guardianAngelMax: number;
  /** Guardian Angel: charges remaining this wave. */
  guardianAngelCharges: number;
  /** Fortune: multiplies drop chance for the wave right after it's picked, then resets to 1. */
  dropChanceMultiplier: number;
}

export interface Unit {
  id: string;
  name: string;
  team: Team;
  className: ClassName;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** Base attack, before any equipped item bonuses. */
  atk: number;
  /** Base defence, before any equipped item bonuses. */
  def: number;
  /** Base movement points per turn, before any equipped item bonuses. */
  move: number;
  /** Base attack reach in tiles (Manhattan distance), before item bonuses. 1 = melee, 2 = bow. */
  range: number;
  /** Movement already spent this turn. */
  hasMoved: boolean;
  /** Unit is finished for this turn (attacked or waited). */
  hasActed: boolean;
  level: number;
  /** Progress toward the next level; reaching EXP_TO_LEVEL rolls over. */
  exp: number;
  /** Only ever populated for player units — enemies never carry loot. */
  equipment: EquipmentSlots;
  /** Turns until this unit's class skill is usable again. 0 = ready. */
  skillCooldown: number;
}

export interface GameState {
  mode: GameMode;
  objectiveType: ObjectiveType;
  /** Which ChapterDef this battle was built from — campaign uses it to know what comes next. */
  chapterId: string;
  chapterName: string;
  objective: string;
  /**
   * Where each player unit began. Roguelike resets the squad here between
   * waves; kept in state rather than derived from a module-level chapter
   * constant so different chapters can be loaded at runtime.
   */
  playerStart: Record<string, { x: number; y: number }>;
  width: number;
  height: number;
  /** Row-major terrain grid, indexed as tiles[y][x]. */
  tiles: TerrainType[][];
  units: Record<string, Unit>;
  /** Newest-first battle log, capped in length. */
  log: string[];
  /** 1-indexed; increments each time a wave of enemies is fully cleared. */
  wave: number;
  /** True between clearing a wave and the player picking a blessing to continue. */
  awaitingBlessing: boolean;
  /** Dropped items not currently equipped by any unit, shared across the squad. */
  inventory: Item[];
  /** Bumped on every drop so instance ids stay unique without a random source. */
  nextItemInstance: number;
  /** Running totals from every "permanent" blessing picked so far this run. */
  modifiers: SquadModifiers;
  /** Player units that have died this run, kept around for The Fallen to revive. */
  fallenUnits: Unit[];
  /** The 3 blessing ids drawn for the current wave-clear pause; empty until the first one. */
  offeredBlessingIds: string[];
}

/** boardgame.io player IDs mapped onto the two sides of a battle. */
export const PLAYER_ID: Record<Team, string> = { player: '0', enemy: '1' };

export function teamOf(playerID: string): Team {
  return playerID === PLAYER_ID.enemy ? 'enemy' : 'player';
}
