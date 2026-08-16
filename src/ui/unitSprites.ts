import swordmanSheet from '../assets/units/swordman.png';
import archerSheet from '../assets/units/archer.png';
import lancerSheet from '../assets/units/lancer.png';
import mageSheet from '../assets/units/mage.png';
import barbarianSheet from '../assets/units/barbarian.png';
import clericSheet from '../assets/units/cleric.png';
import clericSheetV2 from '../assets/units/cleric-2.png';
import dancerSheet from '../assets/units/dancer.png';

/** An idle-animation strip: `frames` equal-width cells laid out left to right. */
export interface UnitSprite {
  src: string;
  frameWidth: number;
  frameHeight: number;
  frames: number;
}

/**
 * Alternate art for a class, keyed by variant name. Lets us swap in new
 * friend-drawn sprites without losing the previous art — flip
 * `ACTIVE_CLERIC_VARIANT` below to switch, or add another key here.
 */
const CLERIC_VARIANTS: Record<string, UnitSprite> = {
  original: { src: clericSheet, frameWidth: 32, frameHeight: 32, frames: 4 },
  /** Single hand-drawn frame, synthesized into a 4-frame bob via a 1px vertical shift. */
  v2: { src: clericSheetV2, frameWidth: 32, frameHeight: 32, frames: 4 },
};
const ACTIVE_CLERIC_VARIANT: keyof typeof CLERIC_VARIANTS = 'original';

/** Original artwork by a friend — no external license to track. */
export const UNIT_SPRITES: Record<string, UnitSprite> = {
  Swordsman: { src: swordmanSheet, frameWidth: 32, frameHeight: 32, frames: 4 },
  Archer: { src: archerSheet, frameWidth: 32, frameHeight: 32, frames: 4 },
  Lancer: { src: lancerSheet, frameWidth: 32, frameHeight: 32, frames: 4 },
  Mage: { src: mageSheet, frameWidth: 32, frameHeight: 32, frames: 4 },
  Barbarian: { src: barbarianSheet, frameWidth: 32, frameHeight: 32, frames: 4 },
  Cleric: CLERIC_VARIANTS[ACTIVE_CLERIC_VARIANT],
  Dancer: { src: dancerSheet, frameWidth: 32, frameHeight: 32, frames: 4 },
};

/** All current sprites render at a consistent height regardless of native size. */
export const SPRITE_DISPLAY_HEIGHT = 48;
