import type { GameState, Unit } from './types';
import { unitsOf } from './grid';
import { grantExp } from './classes';
import { pushLog } from './log';
import type { ShuffleAPI } from './maps';

/**
 * Buffs offered after clearing a wave. Every blessing gets one handler that
 * takes the whole GameState — some loop over the squad, some touch a single
 * unit, some just bump a running total in G.modifiers — rather than forcing
 * every effect through a per-unit shape that only fit the original 3.
 */
export interface Blessing {
  id: string;
  name: string;
  description: string;
  apply: (G: GameState) => void;
  /** Hidden from the draw pool unless this returns true — used by The Fallen, which needs someone to revive. */
  isAvailable?: (G: GameState) => boolean;
}

const WISDOM_EXP = 40;

function lowestLevelUnit(units: Unit[]): Unit | undefined {
  return units.reduce<Unit | undefined>((lowest, unit) => (!lowest || unit.level < lowest.level ? unit : lowest), undefined);
}

function highestLevelUnit(units: Unit[]): Unit | undefined {
  return units.reduce<Unit | undefined>((highest, unit) => (!highest || unit.level > highest.level ? unit : highest), undefined);
}

export const BLESSINGS: Blessing[] = [
  {
    id: 'fury',
    name: 'Blessing of Fury',
    description: '+2 Atk for every surviving unit.',
    apply: (G) => {
      for (const unit of unitsOf(G, 'player')) unit.atk += 2;
    },
  },
  {
    id: 'stone',
    name: 'Blessing of Stone',
    description: '+2 Def for every surviving unit.',
    apply: (G) => {
      for (const unit of unitsOf(G, 'player')) unit.def += 2;
    },
  },
  {
    id: 'vitality',
    name: 'Blessing of Vitality',
    description: 'Fully heal every surviving unit.',
    apply: (G) => {
      for (const unit of unitsOf(G, 'player')) unit.hp = unit.maxHp;
    },
  },
  {
    id: 'growth',
    name: 'Blessing of Growth',
    description: '+4 max HP for every surviving unit, healed by the same amount.',
    apply: (G) => {
      for (const unit of unitsOf(G, 'player')) {
        unit.maxHp += 4;
        unit.hp = Math.min(unit.maxHp, unit.hp + 4);
      }
    },
  },
  {
    id: 'vanguard',
    name: 'Blessing of the Vanguard',
    description: '+3 Atk for every melee unit (range 1).',
    apply: (G) => {
      for (const unit of unitsOf(G, 'player')) if (unit.range <= 1) unit.atk += 3;
    },
  },
  {
    id: 'farsight',
    name: 'Blessing of Farsight',
    description: '+2 Atk for every ranged unit (range 2+).',
    apply: (G) => {
      for (const unit of unitsOf(G, 'player')) if (unit.range >= 2) unit.atk += 2;
    },
  },
  {
    id: 'bulwark',
    name: 'Blessing of the Bulwark',
    description: '+3 Def for every melee unit (range 1).',
    apply: (G) => {
      for (const unit of unitsOf(G, 'player')) if (unit.range <= 1) unit.def += 3;
    },
  },
  {
    id: 'underdog',
    name: "Blessing of the Underdog",
    description: 'Your lowest-level unit gets +2 Atk, +2 Def, +6 max HP.',
    apply: (G) => {
      const unit = lowestLevelUnit(unitsOf(G, 'player'));
      if (!unit) return;
      unit.atk += 2;
      unit.def += 2;
      unit.maxHp += 6;
      unit.hp = Math.min(unit.maxHp, unit.hp + 6);
    },
  },
  {
    id: 'champion',
    name: 'Blessing of the Champion',
    description: 'Your highest-level unit gets +3 Atk.',
    apply: (G) => {
      const unit = highestLevelUnit(unitsOf(G, 'player'));
      if (unit) unit.atk += 3;
    },
  },
  {
    id: 'renewal',
    name: 'Blessing of Renewal',
    description: "Every unit's skill is ready to use again immediately.",
    apply: (G) => {
      for (const unit of unitsOf(G, 'player')) unit.skillCooldown = 0;
    },
  },
  {
    id: 'swiftness',
    name: 'Blessing of Swiftness',
    description: '+1 Move for every surviving unit.',
    apply: (G) => {
      for (const unit of unitsOf(G, 'player')) unit.move += 1;
    },
  },
  {
    id: 'wisdom',
    name: 'Blessing of Wisdom',
    description: `+${WISDOM_EXP} EXP for every surviving unit.`,
    apply: (G) => {
      for (const unit of unitsOf(G, 'player')) {
        grantExp(unit, WISDOM_EXP, (leveled) => pushLog(G, `${leveled.name} reached level ${leveled.level}!`));
      }
    },
  },
  {
    id: 'the-fallen',
    name: 'Blessing of the Fallen',
    description: 'Revive one fallen ally at half HP.',
    isAvailable: (G) => G.fallenUnits.length > 0,
    apply: (G) => {
      const revived = G.fallenUnits.shift();
      if (!revived) return;
      revived.hp = Math.max(1, Math.floor(revived.maxHp / 2));
      revived.hasMoved = false;
      revived.hasActed = false;
      G.units[revived.id] = revived;
      pushLog(G, `${revived.name} returns to the fight!`);
    },
  },
  {
    id: 'fortune',
    name: 'Blessing of Fortune',
    description: "Doubles next wave's item drop chance.",
    apply: (G) => {
      G.modifiers.dropChanceMultiplier = 2;
    },
  },
  {
    id: 'thorns',
    name: 'Blessing of Thorns',
    description: 'Permanent: your counterattacks deal +2 damage.',
    apply: (G) => {
      G.modifiers.counterBonus += 2;
    },
  },
  {
    id: 'focus',
    name: 'Blessing of Focus',
    description: 'Permanent: skill cooldowns are 1 turn shorter (minimum 1).',
    apply: (G) => {
      G.modifiers.cooldownReduction += 1;
    },
  },
  {
    id: 'mending',
    name: 'Blessing of Mending',
    description: 'Permanent: the squad heals 2 HP at the start of every player phase.',
    apply: (G) => {
      G.modifiers.healPerTurn += 2;
    },
  },
  {
    id: 'ironclad',
    name: 'Blessing of the Ironclad',
    description: 'Permanent: doubles the defence bonus your units get from terrain.',
    apply: (G) => {
      G.modifiers.terrainDefMultiplier *= 2;
    },
  },
  {
    id: 'executioner',
    name: "Blessing of the Executioner",
    description: 'Permanent: +3 damage against enemies at or below half HP.',
    apply: (G) => {
      G.modifiers.executionerBonus += 3;
    },
  },
  {
    id: 'guardian-angel',
    name: 'Blessing of the Guardian Angel',
    description: 'Permanent: once per wave, a lethal hit leaves a unit at 1 HP instead.',
    apply: (G) => {
      G.modifiers.guardianAngelMax += 1;
    },
  },
];

/** Draws 3 distinct blessing ids for the wave-clear pause, excluding any not currently available. */
export function drawBlessings(G: GameState, random: ShuffleAPI): string[] {
  const pool = BLESSINGS.filter((blessing) => !blessing.isAvailable || blessing.isAvailable(G));
  return random.Shuffle(pool.map((blessing) => blessing.id)).slice(0, 3);
}
