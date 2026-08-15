import type { Unit } from './types';

/**
 * Simple squad-wide buffs offered after clearing a wave. Deliberately
 * minimal — a placeholder ahead of a real shop/equipment system — so it's
 * easy to swap out later without touching how waves or combat work.
 */
export interface Blessing {
  id: string;
  name: string;
  description: string;
  apply: (unit: Unit) => void;
}

export const BLESSINGS: Blessing[] = [
  {
    id: 'might',
    name: 'Blessing of Might',
    description: '+2 Attack for every surviving unit',
    apply: (unit) => {
      unit.atk += 2;
    },
  },
  {
    id: 'stone',
    name: 'Blessing of Stone',
    description: '+2 Defence for every surviving unit',
    apply: (unit) => {
      unit.def += 2;
    },
  },
  {
    id: 'vitality',
    name: 'Blessing of Vitality',
    description: 'Fully heal every surviving unit',
    apply: (unit) => {
      unit.hp = unit.maxHp;
    },
  },
];
