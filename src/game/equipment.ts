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
}

/**
 * Deliberately small pool for v1 — three or four options per slot keeps
 * balancing tractable. No item touches hp: maxHp bonuses would have to
 * reconcile against a unit's stored current hp on every equip/unequip, and
 * that bookkeeping isn't worth it for a first pass.
 */
export const ITEMS: Record<string, ItemDef> = {
  'iron-blade': { id: 'iron-blade', slot: 'weapon', name: 'Iron Blade', description: '+2 Atk', atk: 2 },
  'heavy-axe': { id: 'heavy-axe', slot: 'weapon', name: 'Heavy Axe', description: '+4 Atk, -1 Mov', atk: 4, move: -1 },
  'long-lance': { id: 'long-lance', slot: 'weapon', name: 'Long Lance', description: '+1 Atk, +1 Rng', atk: 1, range: 1 },
  'swift-dagger': { id: 'swift-dagger', slot: 'weapon', name: 'Swift Dagger', description: '+1 Atk, +1 Mov', atk: 1, move: 1 },

  'iron-plate': { id: 'iron-plate', slot: 'armor', name: 'Iron Plate', description: '+3 Def', def: 3 },
  'leather-vest': { id: 'leather-vest', slot: 'armor', name: 'Leather Vest', description: '+1 Def, +1 Mov', def: 1, move: 1 },
  'towershield': { id: 'towershield', slot: 'armor', name: 'Tower Shield', description: '+5 Def, -1 Mov', def: 5, move: -1 },

  'warrior-band': { id: 'warrior-band', slot: 'accessory', name: "Warrior's Band", description: '+1 Atk, +1 Def', atk: 1, def: 1 },
  'boots-of-haste': { id: 'boots-of-haste', slot: 'accessory', name: 'Boots of Haste', description: '+1 Mov', move: 1 },
  'hawk-eye': { id: 'hawk-eye', slot: 'accessory', name: 'Hawk Eye', description: '+1 Rng', range: 1 },
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

/**
 * The slice of boardgame.io's RandomAPI a drop roll needs — Shuffle for
 * picking a slot/item uniformly, Number for the drop-chance coin flip.
 */
export interface DropRandomAPI extends ShuffleAPI {
  Number(): number;
}

/**
 * Rolls a chance for a Bandit to drop an item on death, scaling the chance
 * with the wave number so late runs see loot land more often. Slot and item
 * are picked uniformly — no rarity tiers yet, keeping the v1 pool flat.
 */
export function rollDrop(G: GameState, wave: number, random: DropRandomAPI): Item | null {
  const dropChance = Math.min(0.25 + wave * 0.03, 0.6);
  if (random.Number() >= dropChance) return null;

  const slots: ItemSlot[] = ['weapon', 'armor', 'accessory'];
  const slot = random.Shuffle(slots)[0];
  const pool = ITEM_IDS_BY_SLOT[slot];
  const defId = random.Shuffle(pool)[0];

  const instanceId = `item-${G.nextItemInstance++}`;
  return { instanceId, defId };
}
