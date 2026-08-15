import swordmanSheet from '../assets/units/swordman.png';
import archerSheet from '../assets/units/archer.png';
import lancerSheet from '../assets/units/lancer.png';
import mageSheet from '../assets/units/mage.png';
import barbarianSheet from '../assets/units/barbarian.png';
import clericSheet from '../assets/units/cleric.png';
import dancerSheet from '../assets/units/dancer.png';

/** An idle-animation strip: `frames` equal-width cells laid out left to right. */
export interface UnitSprite {
  src: string;
  frameWidth: number;
  frameHeight: number;
  frames: number;
}

/** Original artwork by a friend — no external license to track. */
export const UNIT_SPRITES: Record<string, UnitSprite> = {
  Swordsman: { src: swordmanSheet, frameWidth: 32, frameHeight: 32, frames: 4 },
  Archer: { src: archerSheet, frameWidth: 32, frameHeight: 32, frames: 4 },
  Lancer: { src: lancerSheet, frameWidth: 32, frameHeight: 32, frames: 4 },
  Mage: { src: mageSheet, frameWidth: 32, frameHeight: 32, frames: 4 },
  Barbarian: { src: barbarianSheet, frameWidth: 32, frameHeight: 32, frames: 4 },
  Cleric: { src: clericSheet, frameWidth: 32, frameHeight: 32, frames: 4 },
  Dancer: { src: dancerSheet, frameWidth: 32, frameHeight: 32, frames: 4 },
};

/** All current sprites render at a consistent height regardless of native size. */
export const SPRITE_DISPLAY_HEIGHT = 48;
