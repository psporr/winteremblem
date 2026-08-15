/**
 * Core data model for Winter Emblem.
 *
 * Everything in `GameState` must stay JSON-serialisable: boardgame.io transports
 * it as plain data today, and it will be persisted to Firestore later on.
 */

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

export interface Unit {
  id: string;
  name: string;
  team: Team;
  /** Display-only class label, e.g. "Knight". Class-driven rules come later. */
  className: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  /** Movement points per turn. */
  move: number;
  /** Attack reach in tiles (Manhattan distance). 1 = melee, 2 = bow. */
  range: number;
  /** Movement already spent this turn. */
  hasMoved: boolean;
  /** Unit is finished for this turn (attacked or waited). */
  hasActed: boolean;
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
}

/** boardgame.io player IDs mapped onto the two sides of a battle. */
export const PLAYER_ID: Record<Team, string> = { player: '0', enemy: '1' };

export function teamOf(playerID: string): Team {
  return playerID === PLAYER_ID.enemy ? 'enemy' : 'player';
}
