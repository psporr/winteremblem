/**
 * Core data model for Winter Emblem.
 *
 * Everything in `GameState` must stay JSON-serialisable: boardgame.io transports
 * it as plain data today, and it will be persisted to Firestore later on.
 */

import type { ClassName } from './classes';

export type Team = 'player' | 'enemy';

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
}

export interface GameState {
  chapterName: string;
  objective: string;
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
}

/** boardgame.io player IDs mapped onto the two sides of a battle. */
export const PLAYER_ID: Record<Team, string> = { player: '0', enemy: '1' };

export function teamOf(playerID: string): Team {
  return playerID === PLAYER_ID.enemy ? 'enemy' : 'player';
}
