import swordmanSheet from '../assets/units/swordman.png';
import archerSheet from '../assets/units/archer.png';

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
};

/** All current sprites render at a consistent height regardless of native size. */
export const SPRITE_DISPLAY_HEIGHT = 44;
