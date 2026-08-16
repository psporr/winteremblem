import { useEffect, useRef } from 'react';
import Phaser from 'phaser';

import terrainTileset from '../assets/terrain/toen-terrain.png';
import swordmanSheet from '../assets/units/swordman.png';
import archerSheet from '../assets/units/archer.png';
import clericSheet from '../assets/units/cleric.png';
import barbarianSheet from '../assets/units/barbarian.png';
import { CHAPTER_1 } from '../game/maps';
import type { TerrainType } from '../game/types';
import './phaserPrototype.css';

/**
 * A throwaway side-by-side prototype: the same map and art the real board
 * uses, rendered by Phaser instead of DOM + CSS, so we can judge whether the
 * VFX are worth porting the whole UI layer over. Deliberately isolated —
 * nothing here is imported by the live game, and it holds no boardgame.io
 * state. Delete this file and its title-screen entry to back the experiment out.
 */

/** Source pixel size of one terrain cell in toen-terrain.png (a 48x16, 3-tile strip). */
const TERRAIN_SRC = 16;
/** Source pixel size of one unit animation frame; every sheet is 4 frames wide. */
const UNIT_SRC = 32;
const UNIT_FRAMES = 4;

/** On-screen size of a board cell. Chosen to fit a 7-wide board on a phone. */
const TILE = 48;
const GAP = 2;
const CELL = TILE + GAP;

/** Left-to-right tile order in the tileset, mirroring the DOM board's mapping. */
const TERRAIN_FRAME: Record<TerrainType, number> = { plain: 0, forest: 1, wall: 2 };

const LEGEND: Record<string, TerrainType> = { '.': 'plain', f: 'forest', '#': 'wall' };

/** The class sheets this demo loads, keyed by the Phaser texture name. */
const SHEETS: Record<string, string> = {
  Swordsman: swordmanSheet,
  Archer: archerSheet,
  Cleric: clericSheet,
  Barbarian: barbarianSheet,
};

interface DemoUnit {
  id: string;
  className: keyof typeof SHEETS;
  team: 'player' | 'enemy';
  x: number;
  y: number;
  hp: number;
  maxHp: number;
}

/** A trimmed cast drawn from chapter 1's roster — enough to show off movement and a fight. */
const DEMO_UNITS: DemoUnit[] = [
  { id: 'lyn', className: 'Swordsman', team: 'player', x: 1, y: 6, hp: 24, maxHp: 24 },
  { id: 'byleth', className: 'Archer', team: 'player', x: 2, y: 7, hp: 20, maxHp: 20 },
  { id: 'lissa', className: 'Cleric', team: 'player', x: 3, y: 6, hp: 18, maxHp: 18 },
  { id: 'bandit-1', className: 'Barbarian', team: 'enemy', x: 2, y: 1, hp: 22, maxHp: 22 },
  { id: 'bandit-2', className: 'Barbarian', team: 'enemy', x: 4, y: 2, hp: 22, maxHp: 22 },
];

/** Manhattan distance — the same reach metric the real game uses. */
function manhattan(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Board coords -> the centre pixel of that cell, for positioning sprites. */
function centreOf(x: number, y: number) {
  return { px: x * CELL + TILE / 2, py: y * CELL + TILE / 2 };
}

class PrototypeScene extends Phaser.Scene {
  private tiles: TerrainType[][] = [];
  private units: DemoUnit[] = [];
  /** Live sprite + HP-bar graphics per unit id, so a unit can be animated by id. */
  private views = new Map<string, { sprite: Phaser.GameObjects.Sprite; hpBar: Phaser.GameObjects.Graphics }>();
  /** Redrawn every selection change; holds the blue move / red attack overlays. */
  private highlights!: Phaser.GameObjects.Graphics;
  private selectedId: string | null = null;
  /** Blocks input while an attack sequence plays, so taps can't interleave. */
  private busy = false;

  constructor() {
    super('prototype');
  }

  preload() {
    this.load.spritesheet('terrain', terrainTileset, {
      frameWidth: TERRAIN_SRC,
      frameHeight: TERRAIN_SRC,
    });
    for (const [name, url] of Object.entries(SHEETS)) {
      this.load.spritesheet(name, url, { frameWidth: UNIT_SRC, frameHeight: UNIT_SRC });
    }
  }

  create() {
    this.tiles = CHAPTER_1.rows.map((row) => [...row].map((char) => LEGEND[char]));
    // Cloned so replaying the demo (remount) always starts from full HP.
    this.units = DEMO_UNITS.map((unit) => ({ ...unit }));

    this.drawTerrain();

    this.highlights = this.add.graphics();
    this.highlights.setDepth(1);

    for (const [name] of Object.entries(SHEETS)) {
      this.anims.create({
        key: `${name}-idle`,
        frames: this.anims.generateFrameNumbers(name, { start: 0, end: UNIT_FRAMES - 1 }),
        frameRate: 4,
        repeat: -1,
      });
    }

    for (const unit of this.units) this.spawnUnit(unit);

    this.add
      .text(0, this.boardHeight() + 10, 'Tap a blue unit, then a tile to move or a red unit to attack.', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '13px',
        color: '#9fb3d1',
        wordWrap: { width: this.boardWidth() },
      })
      .setDepth(5);

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.handleTap(pointer));
  }

  private boardWidth() {
    return this.tiles[0].length * CELL - GAP;
  }

  private boardHeight() {
    return this.tiles.length * CELL - GAP;
  }

  private drawTerrain() {
    this.tiles.forEach((row, y) =>
      row.forEach((terrain, x) => {
        this.add
          .image(x * CELL, y * CELL, 'terrain', TERRAIN_FRAME[terrain])
          .setOrigin(0, 0)
          .setDisplaySize(TILE, TILE);
      }),
    );
  }

  private spawnUnit(unit: DemoUnit) {
    const { px, py } = centreOf(unit.x, unit.y);
    const sprite = this.add.sprite(px, py, unit.className).setDepth(2);
    // Nearest-neighbour upscaling keeps the pixel art crisp rather than blurry.
    sprite.setScale(TILE / UNIT_SRC);
    sprite.play(`${unit.className}-idle`);
    // Enemies are mirrored so the two armies visibly face each other.
    if (unit.team === 'enemy') sprite.setFlipX(true);

    const hpBar = this.add.graphics().setDepth(3);
    this.views.set(unit.id, { sprite, hpBar });
    this.drawHpBar(unit);
  }

  private drawHpBar(unit: DemoUnit) {
    const view = this.views.get(unit.id);
    if (!view) return;
    const { hpBar } = view;
    const width = TILE - 10;
    const x = unit.x * CELL + 5;
    const y = unit.y * CELL + TILE - 7;
    const ratio = Math.max(0, unit.hp) / unit.maxHp;

    hpBar.clear();
    hpBar.fillStyle(0x1a2233, 1).fillRect(x, y, width, 4);
    // Same three-stage colour ramp as the DOM board's HP bars.
    const colour = ratio <= 0.3 ? 0xf0616d : ratio <= 0.6 ? 0xffd479 : unit.team === 'player' ? 0x6ea8fe : 0xf0616d;
    hpBar.fillStyle(colour, 1).fillRect(x, y, width * ratio, 4);
  }

  private unitAt(x: number, y: number) {
    return this.units.find((unit) => unit.x === x && unit.y === y && unit.hp > 0);
  }

  /** Plain reachability: any passable, unoccupied tile within `range` steps. */
  private reachable(unit: DemoUnit, range = 3) {
    const out: { x: number; y: number }[] = [];
    this.tiles.forEach((row, y) =>
      row.forEach((terrain, x) => {
        if (terrain === 'wall' || this.unitAt(x, y)) return;
        if (manhattan(unit, { x, y }) <= range) out.push({ x, y });
      }),
    );
    return out;
  }

  private enemiesInReach(unit: DemoUnit) {
    return this.units.filter(
      (other) => other.team !== unit.team && other.hp > 0 && manhattan(unit, other) <= 1,
    );
  }

  private redrawHighlights() {
    this.highlights.clear();
    const selected = this.units.find((unit) => unit.id === this.selectedId);
    if (!selected) return;

    for (const tile of this.reachable(selected)) {
      this.highlights.fillStyle(0x6ea8fe, 0.4).fillRect(tile.x * CELL, tile.y * CELL, TILE, TILE);
    }
    for (const enemy of this.enemiesInReach(selected)) {
      this.highlights.lineStyle(3, 0xf0616d, 1).strokeRect(enemy.x * CELL + 1, enemy.y * CELL + 1, TILE - 2, TILE - 2);
    }
    this.highlights.lineStyle(3, 0xffd479, 1).strokeRect(selected.x * CELL + 1, selected.y * CELL + 1, TILE - 2, TILE - 2);
  }

  private handleTap(pointer: Phaser.Input.Pointer) {
    if (this.busy) return;
    const x = Math.floor(pointer.worldX / CELL);
    const y = Math.floor(pointer.worldY / CELL);
    if (y < 0 || y >= this.tiles.length || x < 0 || x >= this.tiles[0].length) return;

    const tapped = this.unitAt(x, y);
    const selected = this.units.find((unit) => unit.id === this.selectedId);

    if (!selected) {
      if (tapped && tapped.team === 'player') {
        this.selectedId = tapped.id;
        this.redrawHighlights();
      }
      return;
    }

    if (tapped && tapped.team === 'enemy' && manhattan(selected, tapped) <= 1) {
      void this.playAttack(selected, tapped);
      return;
    }
    if (tapped && tapped.team === 'player') {
      this.selectedId = tapped.id;
      this.redrawHighlights();
      return;
    }
    if (!tapped && this.reachable(selected).some((tile) => tile.x === x && tile.y === y)) {
      this.moveUnit(selected, x, y);
      return;
    }
    this.selectedId = null;
    this.redrawHighlights();
  }

  /**
   * The first thing CSS can't match: a real eased tween, with the HP bar
   * following the sprite frame-by-frame instead of snapping at the end.
   */
  private moveUnit(unit: DemoUnit, x: number, y: number) {
    const view = this.views.get(unit.id);
    if (!view) return;
    this.busy = true;
    this.selectedId = null;
    this.highlights.clear();

    unit.x = x;
    unit.y = y;
    const { px, py } = centreOf(x, y);

    this.tweens.add({
      targets: view.sprite,
      x: px,
      y: py,
      duration: 320,
      ease: 'Cubic.easeInOut',
      onUpdate: () => this.drawHpBarAtSprite(unit),
      onComplete: () => {
        this.drawHpBar(unit);
        this.busy = false;
      },
    });
  }

  /** HP bar tracking a mid-tween sprite, rather than its logical grid cell. */
  private drawHpBarAtSprite(unit: DemoUnit) {
    const view = this.views.get(unit.id);
    if (!view) return;
    const { sprite, hpBar } = view;
    const width = TILE - 10;
    const x = sprite.x - width / 2;
    const y = sprite.y + TILE / 2 - 7;
    const ratio = Math.max(0, unit.hp) / unit.maxHp;

    hpBar.clear();
    hpBar.fillStyle(0x1a2233, 1).fillRect(x, y, width, 4);
    const colour = ratio <= 0.3 ? 0xf0616d : ratio <= 0.6 ? 0xffd479 : unit.team === 'player' ? 0x6ea8fe : 0xf0616d;
    hpBar.fillStyle(colour, 1).fillRect(x, y, width * ratio, 4);
  }

  /**
   * The payoff sequence: lunge, impact particles, camera shake, a hit-flash,
   * and a floating number that rises and fades — all of which would be
   * awkward or impossible with the CSS keyframe approach.
   */
  private async playAttack(attacker: DemoUnit, target: DemoUnit) {
    this.busy = true;
    this.selectedId = null;
    this.highlights.clear();

    const attackerView = this.views.get(attacker.id);
    const targetView = this.views.get(target.id);
    if (!attackerView || !targetView) {
      this.busy = false;
      return;
    }

    const home = { x: attackerView.sprite.x, y: attackerView.sprite.y };
    const toward = centreOf(target.x, target.y);
    // Lunge only a third of the way so the attacker never covers its target.
    const lunge = {
      x: home.x + (toward.px - home.x) * 0.35,
      y: home.y + (toward.py - home.y) * 0.35,
    };

    await this.tweenPromise({
      targets: attackerView.sprite,
      x: lunge.x,
      y: lunge.y,
      duration: 130,
      ease: 'Quad.easeOut',
    });

    const damage = 4 + Math.floor(Math.random() * 5);
    target.hp = Math.max(0, target.hp - damage);

    this.camera().shake(180, 0.006);
    this.impactBurst(toward.px, toward.py);
    this.floatNumber(toward.px, toward.py, damage);

    // White flash on the struck sprite, then back to normal. Phaser 4 replaced
    // setTintFill() with an explicit tint + FILL mode pair.
    targetView.sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    this.time.delayedCall(90, () => targetView.sprite.clearTint());

    this.tweens.add({
      targets: targetView.sprite,
      x: toward.px + 5,
      duration: 45,
      yoyo: true,
      repeat: 3,
      onComplete: () => {
        targetView.sprite.x = toward.px;
        this.drawHpBar(target);
      },
    });

    this.drawHpBar(target);

    await this.tweenPromise({
      targets: attackerView.sprite,
      x: home.x,
      y: home.y,
      duration: 200,
      ease: 'Quad.easeInOut',
      delay: 120,
    });

    if (target.hp <= 0) await this.playDeath(target);

    this.busy = false;
  }

  /** A short-lived particle emitter — the effect with no CSS equivalent at all. */
  private impactBurst(px: number, py: number) {
    const emitter = this.add.particles(px, py, 'terrain', {
      frame: 0,
      lifespan: 380,
      speed: { min: 60, max: 160 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.35, end: 0 },
      quantity: 14,
      tint: [0xffd479, 0xf0616d, 0xffffff],
      blendMode: 'ADD',
      emitting: false,
    });
    emitter.setDepth(4);
    emitter.explode(14);
    // Emitters are cheap but not free; drop it once the last particle dies.
    this.time.delayedCall(600, () => emitter.destroy());
  }

  private floatNumber(px: number, py: number, value: number) {
    const label = this.add
      .text(px, py - 6, `-${value}`, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '18px',
        color: '#ff6b6b',
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(6);

    this.tweens.add({
      targets: label,
      y: py - 34,
      alpha: 0,
      duration: 750,
      ease: 'Quad.easeOut',
      onComplete: () => label.destroy(),
    });
  }

  private playDeath(unit: DemoUnit) {
    const view = this.views.get(unit.id);
    if (!view) return Promise.resolve();
    view.hpBar.destroy();
    return this.tweenPromise({
      targets: view.sprite,
      alpha: 0,
      scale: view.sprite.scale * 1.3,
      duration: 420,
      ease: 'Quad.easeIn',
    }).then(() => {
      view.sprite.destroy();
      this.views.delete(unit.id);
    });
  }

  private camera() {
    return this.cameras.main;
  }

  /** Promise wrapper so an attack reads as a linear sequence, not nested callbacks. */
  private tweenPromise(config: Phaser.Types.Tweens.TweenBuilderConfig) {
    return new Promise<void>((resolve) => {
      this.tweens.add({ ...config, onComplete: () => resolve() });
    });
  }
}

/**
 * Mounts the scene into a plain div. Phaser owns its own canvas and render
 * loop, so React's only jobs here are creating the game once and destroying
 * it on unmount — hence the empty dependency list and the ref guard.
 */
export function PhaserPrototype({ onBack }: { onBack: () => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (!hostRef.current || gameRef.current) return;

    const cols = CHAPTER_1.rows[0].length;
    const rows = CHAPTER_1.rows.length;

    gameRef.current = new Phaser.Game({
      type: Phaser.AUTO,
      parent: hostRef.current,
      width: cols * CELL - GAP,
      // Extra strip at the bottom for the hint line under the board.
      height: rows * CELL - GAP + 40,
      backgroundColor: '#0f1626',
      // Crisp upscaled pixel art instead of smoothed-out mush.
      pixelArt: true,
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_HORIZONTALLY },
      scene: PrototypeScene,
    });

    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, []);

  return (
    <div className="we-phaser">
      <div className="we-phaser__bar">
        <h1 className="we-phaser__title">Phaser VFX Prototype</h1>
        <button type="button" className="we-phaser__back" onClick={onBack}>
          Back
        </button>
      </div>
      <div className="we-phaser__host" ref={hostRef} />
      <p className="we-phaser__note">
        Rendered entirely by Phaser on a canvas — eased movement, impact particles, camera shake, hit
        flash and tweened damage numbers. The real board still uses DOM + CSS; nothing here is wired
        into the live game.
      </p>
    </div>
  );
}
