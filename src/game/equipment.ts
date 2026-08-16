import type { ClassStats } from './classes';
import type { GameState, Item, ItemSlot, Unit } from './types';
import type { ShuffleAPI } from './maps';

export interface ItemDef {
  id: string;
  slot: ItemSlot;
  name: string;
  description: string;
  atk?: number;
  def?: number;
  move?: number;
  range?: number;
  /** Heals the wearer for this much whenever their attack lands a kill. */
  killHeal?: number;
  /** Reduces any counter damage the wearer takes by this much (floored at 1 dmg). */
  counterReduction?: number;
  /** Overrides forest's normal move cost (2) to this for the wearer. */
  forestMoveCost?: number;
}

/**
 * No item touches hp: maxHp bonuses would have to reconcile against a
 * unit's stored current hp on every equip/unequip, and that bookkeeping
 * isn't worth it.
 */
export const ITEMS: Record<string, ItemDef> = {
  'iron-blade': { id: 'iron-blade', slot: 'weapon', name: 'Iron Blade', description: '+2 Atk', atk: 2 },
  'heavy-axe': { id: 'heavy-axe', slot: 'weapon', name: 'Heavy Axe', description: '+4 Atk, -1 Mov', atk: 4, move: -1 },
  'long-lance': { id: 'long-lance', slot: 'weapon', name: 'Long Lance', description: '+1 Atk, +1 Rng', atk: 1, range: 1 },
  'swift-dagger': { id: 'swift-dagger', slot: 'weapon', name: 'Swift Dagger', description: '+1 Atk, +1 Mov', atk: 1, move: 1 },
  'steel-blade': { id: 'steel-blade', slot: 'weapon', name: 'Steel Blade', description: '+3 Atk', atk: 3 },
  'war-hammer': { id: 'war-hammer', slot: 'weapon', name: 'War Hammer', description: '+5 Atk, -1 Def', atk: 5, def: -1 },
  glaive: { id: 'glaive', slot: 'weapon', name: 'Glaive', description: '+2 Atk, +1 Rng, -1 Mov', atk: 2, range: 1, move: -1 },
  'vampiric-fang': {
    id: 'vampiric-fang',
    slot: 'weapon',
    name: 'Vampiric Fang',
    description: '+1 Atk, heals 3 HP on a kill',
    atk: 1,
    killHeal: 3,
  },

  'iron-plate': { id: 'iron-plate', slot: 'armor', name: 'Iron Plate', description: '+3 Def', def: 3 },
  'leather-vest': { id: 'leather-vest', slot: 'armor', name: 'Leather Vest', description: '+1 Def, +1 Mov', def: 1, move: 1 },
  towershield: { id: 'towershield', slot: 'armor', name: 'Tower Shield', description: '+5 Def, -1 Mov', def: 5, move: -1 },
  'steel-plate': { id: 'steel-plate', slot: 'armor', name: 'Steel Plate', description: '+4 Def', def: 4 },
  'spiked-mail': { id: 'spiked-mail', slot: 'armor', name: 'Spiked Mail', description: '+2 Def, +1 Atk', def: 2, atk: 1 },
  dragonscale: {
    id: 'dragonscale',
    slot: 'armor',
    name: 'Dragonscale',
    description: '+3 Def, -1 Mov, counters against you deal 1 less',
    def: 3,
    move: -1,
    counterReduction: 1,
  },

  'warrior-band': { id: 'warrior-band', slot: 'accessory', name: "Warrior's Band", description: '+1 Atk, +1 Def', atk: 1, def: 1 },
  'boots-of-haste': { id: 'boots-of-haste', slot: 'accessory', name: 'Boots of Haste', description: '+1 Mov', move: 1 },
  'hawk-eye': { id: 'hawk-eye', slot: 'accessory', name: 'Hawk Eye', description: '+1 Rng', range: 1 },
  'power-ring': { id: 'power-ring', slot: 'accessory', name: 'Power Ring', description: '+2 Atk', atk: 2 },
  'seven-league-boots': {
    id: 'seven-league-boots',
    slot: 'accessory',
    name: 'Seven-League Boots',
    description: '+2 Mov, -1 Def',
    move: 2,
    def: -1,
  },
  'forest-talisman': {
    id: 'forest-talisman',
    slot: 'accessory',
    name: 'Forest Talisman',
    description: 'Forest costs 1 movement instead of 2',
    forestMoveCost: 1,
  },
};

const ITEM_IDS_BY_SLOT: Record<ItemSlot, string[]> = {
  weapon: [],
  armor: [],
  accessory: [],
};
for (const item of Object.values(ITEMS)) ITEM_IDS_BY_SLOT[item.slot].push(item.id);

/** A unit's stats with every equipped item's bonuses folded in. */
export function effectiveStats(unit: Unit): ClassStats {
  let atk = unit.atk;
  let def = unit.def;
  let move = unit.move;
  let range = unit.range;

  for (const item of Object.values(unit.equipment)) {
    if (!item) continue;
    const def_ = ITEMS[item.defId];
    atk += def_.atk ?? 0;
    def += def_.def ?? 0;
    move += def_.move ?? 0;
    range += def_.range ?? 0;
  }

  return { maxHp: unit.maxHp, atk, def, move: Math.max(1, move), range: Math.max(1, range) };
}

/** Total kill-heal a unit's equipped gear grants (Vampiric Fang). */
export function equippedKillHeal(unit: Unit): number {
  return Object.values(unit.equipment).reduce((total, item) => total + (item ? ITEMS[item.defId].killHeal ?? 0 : 0), 0);
}

/** Total counter-damage reduction a unit's equipped gear grants (Dragonscale). */
export function equippedCounterReduction(unit: Unit): number {
  return Object.values(unit.equipment).reduce(
    (total, item) => total + (item ? ITEMS[item.defId].counterReduction ?? 0 : 0),
    0,
  );
}

/** The move cost a unit pays to enter forest, accounting for Forest Talisman. */
export function forestMoveCostFor(unit: Unit, defaultCost: number): number {
  for (const item of Object.values(unit.equipment)) {
    const forestCost = item ? ITEMS[item.defId].forestMoveCost : undefined;
    if (forestCost !== undefined) return forestCost;
  }
  return defaultCost;
}

/**
 * The slice of boardgame.io's RandomAPI a drop roll needs — Shuffle for
 * picking a slot/item uniformly, Number for the drop-chance coin flip.
 */
export interface DropRandomAPI extends ShuffleAPI {
  Number(): number;
}

/**
 * Rolls a chance for a Bandit to drop an item on death, scaling the chance
 * with the wave number (and G.modifiers.dropChanceMultiplier from Fortune)
 * so late runs — and lucky picks — see loot land more often. Slot and item
 * are picked uniformly — no rarity tiers yet, keeping the v1 pool flat.
 */
export function rollDrop(G: GameState, wave: number, random: DropRandomAPI): Item | null {
  const dropChance = Math.min((0.25 + wave * 0.03) * G.modifiers.dropChanceMultiplier, 0.9);
  if (random.Number() >= dropChance) return null;

  const slots: ItemSlot[] = ['weapon', 'armor', 'accessory'];
  const slot = random.Shuffle(slots)[0];
  const pool = ITEM_IDS_BY_SLOT[slot];
  const defId = random.Shuffle(pool)[0];

  const instanceId = `item-${G.nextItemInstance++}`;
  return { instanceId, defId };
}
