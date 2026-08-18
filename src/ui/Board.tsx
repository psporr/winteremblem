import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { BoardProps } from 'boardgame.io/react';

import type { GameState, Team, TerrainType, Unit } from '../game/types';
import { PLAYER_ID, teamOf } from '../game/types';
import terrainTileset from '../assets/terrain/toen-terrain.png';
import { UNIT_SPRITES, SPRITE_DISPLAY_HEIGHT } from './unitSprites';
import { ParticleLayer, type ParticleBurstHandle } from './ParticleLayer';
import { MuteToggle } from './MuteToggle';
import { sound } from './sound';
import {
  computeReachable,
  computeThreatTiles,
  targetsFrom,
  terrainAt,
  tileKey,
  unitAt,
  unitsOf,
  type ReachableTile,
} from '../game/grid';
import { canCounter, computeCounterDamage, computeDamage, forecastCombat, type CombatForecast } from '../game/combat';
import { decideEnemyAction } from '../game/ai';
import { BLESSINGS } from '../game/blessings';
import { EXP_TO_LEVEL, LEVEL_GROWTH, type ClassName } from '../game/classes';
import { effectiveStats, ITEMS } from '../game/equipment';
import {
  HEAL_BONUS,
  NOVA_DAMAGE_MULTIPLIER,
  SKILLS,
  SNIPE_BONUS,
  canUseSkill,
  describeSkillEffect,
  novaBlastCoords,
  novaBlastTargets,
  skillTargets,
  type SkillCategory,
  type SkillDef,
} from '../game/skills';
import type { ItemSlot } from '../game/types';
import type { GameOver } from '../game/game';
import { useMenuActions } from './menuContext';
import './board.css';

/** Pause between CPU actions so the player can follow what happened. */
const ENEMY_ACTION_DELAY = 550;

/** How long each beat of a player attack's animation holds before the next. */
const COMBAT_BEAT_MS = 500;

/** How far a striker leans toward whoever it's hitting, before easing back. */
const LUNGE_HOLD_MS = 180;
/** Fraction of a tile the striker steps toward its target — a nudge, not a lunge onto the tile. */
const LUNGE_FRACTION = 0.22;
/** How large a crit's striker briefly scales up during its punch-in. */
const CRIT_PUNCH_SCALE = 1.3;
/** How long the full-screen crit flash stays visible. */
const CRIT_FLASH_MS = 260;

/**
 * The board has exactly two views, both driven by `--tile` (see board.css):
 *
 * - `fit`    — shrink tiles until the whole map is on screen at once.
 * - `detail` — a fixed comfortable tile size; anything that doesn't fit scrolls.
 *
 * They set `--tile` rather than applying a CSS `transform: scale()` over the
 * board. Everything on the board — tile art, sprites, highlights, the
 * floating action menu's anchor — is already sized off `--tile`, so one
 * variable resizes the whole thing coherently, and the pixel art stays crisp
 * because it's re-rasterised at the new size instead of scaled after the fact.
 *
 * The small 7x8 map renders the same in both views, so the toggle hides
 * itself there (see `canZoom`) — it only earns its place on a map big enough
 * to need it.
 */
type ZoomMode = 'fit' | 'detail';

/**
 * Board sizing is measured here rather than computed in CSS. The CSS version
 * needed calc() division by a var(), nested min() inside calc(), and dvh
 * units; WebKit is inconsistent about all three, and because --tile is an
 * inherited custom property, any one of them failing degrades silently — the
 * declaration is dropped and the board inherits the :root fallback, rendering
 * at detail size while believing it's in the fit view.
 *
 * `--board-pad` and `--tile-gap` must stay in step with board.css.
 */
const DETAIL_TILE_PX = 46;
const BOARD_PAD_PX = 8;
const TILE_GAP_PX = 2;
/** .we-layout's flex gap, between the board and the sidebar. */
const LAYOUT_GAP_PX = 12;
/** Floor and ceiling for the fit view: never illegibly small, never oversized on a desktop. */
const FIT_MIN_TILE_PX = 20;
const FIT_MAX_TILE_PX = 64;
/** Share of the visible viewport the board may occupy before it starts panning. */
const BOARD_HEIGHT_FRACTION = 0.7;
const BOARD_HEIGHT_CAP_PX = 720;

const EMPTY_REACHABLE = new Map<string, ReachableTile>();

/**
 * Left-to-right tile order in toen-terrain.png, cropped from Toen's Medieval
 * Strategy Sprite Pack (CC-BY 4.0, Andre Mari Coppola — see CREDITS.md).
 */
const TERRAIN_SPRITE_INDEX: Record<TerrainType, number> = {
  plain: 0,
  forest: 1,
  wall: 2,
};

/**
 * The command flow for a selected unit, mirroring classic Fire Emblem:
 * pick a destination -> a menu of what's possible from there appears ->
 * either commit to a target or back all the way out via undo. 'animating'
 * plays out a confirmed player attack before the real move is dispatched.
 */
type Mode = 'move' | 'menu' | 'targeting' | 'confirm' | 'animating' | 'skill-targeting' | 'skill-confirm';

/**
 * Client-side-only playback state for a confirmed attack or skill, keyed by
 * unit id. The real move doesn't fire until this finishes, so it's how the
 * board shows HP draining (or rising, for a heal) before G actually
 * changes. A plain map rather than a fixed attacker/target shape so a
 * single beat can update several units at once (Nova hits up to 5 tiles).
 */
type CombatAnim = Record<
  string,
  {
    hp: number;
    shaking: boolean;
    /**
     * `kind` picks the color: red for damage, green for a heal. `seq` is a
     * per-beat nonce, not shown — it exists purely so the floating-number
     * span's React key changes even when two consecutive beats deal the
     * same value (e.g. Sword Dance's two equal hits), forcing a remount so
     * the pop-in animation replays instead of being silently skipped.
     * `crit` marks a skill's own damage hit (not its counter-retaliation)
     * for the bigger, RPG-critical-hit styled number.
     */
    floatingNumber: { value: number; kind: 'damage' | 'heal'; seq: number; crit: boolean } | null;
  }
>;

/**
 * A queued announcement. Several can be produced by one action — a killing
 * blow can level the attacker *and* drop loot — so they're shown one at a
 * time rather than stacked on top of each other.
 */
type Popup =
  | { kind: 'levelUp'; unitName: string; className: ClassName; level: number; levelsGained: number }
  | { kind: 'loot'; itemNames: string[] };

/** How long a level-up card stays up before dismissing itself. */
const LEVEL_UP_POPUP_MS = 2600;

/** How long the "Player Phase" / "Enemy Phase" banner sweeps for. */
const PHASE_BANNER_MS = 1300;

/** One unit's HP update within a single simultaneous beat. */
interface BeatHit {
  unitId: string;
  hp: number;
  shake?: boolean;
  floatingNumber?: { value: number; kind: 'damage' | 'heal'; crit?: boolean };
}

export function Board({ G, ctx, moves, events, undo }: BoardProps<GameState>) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('move');
  const [pendingTargetId, setPendingTargetId] = useState<string | null>(null);
  const [hoveredTargetId, setHoveredTargetId] = useState<string | null>(null);
  const [showThreat, setShowThreat] = useState(false);
  const [combatAnim, setCombatAnim] = useState<CombatAnim | null>(null);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [inventoryUnitId, setInventoryUnitId] = useState<string | null>(null);
  const [waveBanner, setWaveBanner] = useState<number | null>(null);
  /** Starts on 'fit' so a battle always opens showing the whole map. */
  const [zoomMode, setZoomMode] = useState<ZoomMode>('fit');
  /**
   * Measured board sizing. `fitTilePx` is the largest tile that still shows
   * the whole map; `maxHeightPx` is the height budget both it and the scroll
   * container are derived from. Null only until the first measurement lands.
   *
   * `fitShowsWholeBoard` is normally true — that is what the fit view is —
   * but `fitTilePx` has a legibility floor, so on a viewport too narrow for
   * a big map the fit view can still overflow. It records whether the floor
   * was hit, so scrolling is only ever disabled when it is genuinely useless.
   */
  const [sizing, setSizing] = useState<{
    fitTilePx: number;
    maxHeightPx: number;
    fitShowsWholeBoard: boolean;
  } | null>(null);
  /** False while the map is small enough that both views look identical. */
  const [canZoom, setCanZoom] = useState(false);
  /** Announcements waiting to be shown, oldest first. */
  const [popupQueue, setPopupQueue] = useState<Popup[]>([]);
  /** `seq` re-keys the element so the sweep replays on back-to-back phases. */
  const [phaseBanner, setPhaseBanner] = useState<{ team: Team; seq: number } | null>(null);
  /**
   * The unit currently leaning toward whoever it's striking this beat, and
   * how far. `crit` adds an extra punch-in scale on top of the lean, for a
   * skill or attack that landed a critical hit.
   */
  const [lunge, setLunge] = useState<{ unitId: string; dx: number; dy: number; crit: boolean } | null>(null);
  /** Re-keys the full-screen crit flash so back-to-back crits (Sword Dance) both flash. */
  const [critFlashSeq, setCritFlashSeq] = useState<number | null>(null);
  const particlesRef = useRef<ParticleBurstHandle | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const boardAreaRef = useRef<HTMLDivElement | null>(null);
  const boardWrapRef = useRef<HTMLDivElement | null>(null);
  const { exitToMenu, retry } = useMenuActions();

  const isPlayerPhase =
    ctx.currentPlayer === PLAYER_ID.player && !ctx.gameover && !G.awaitingBlessing;
  const selected = selectedId ? G.units[selectedId] : undefined;

  function clearSelection() {
    setSelectedId(null);
    setMode('move');
    setPendingTargetId(null);
  }

  // Selection never survives a phase change.
  useEffect(() => {
    clearSelection();
    setHoveredTargetId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.currentPlayer]);

  /**
   * Measures the fit-view tile size and the board's height budget from the
   * real container, and decides whether the zoom toggle is worth showing at
   * all — the two views look identical whenever the map already fits at the
   * detail size, which is the case for the 7x8 roguelike map.
   *
   * Measured rather than hardcoded per map because it depends on the
   * viewport: the same map needs the toggle on a phone and not on a desktop,
   * and rotating the device flips the answer live.
   *
   * useLayoutEffect so the measured size is applied before the browser
   * paints; with a plain effect the board would flash at the CSS fallback
   * size first.
   */
  useLayoutEffect(() => {
    const area = boardAreaRef.current;
    const layout = area?.parentElement;
    if (!area || !layout) return;

    const measure = () => {
      // Width comes from .we-layout, not .we-board-area. The board area is a
      // flex item with no flex-grow, so it shrink-wraps to the board inside
      // it — measuring it would just read back whatever size the board
      // already is, and the tile size would lock to its own starting value
      // and never fill the space actually available.
      let availableWidth = layout.clientWidth;

      // On a wide screen the sidebar shares the flex line and takes part of
      // it; on a phone it wraps below and the whole line is the board's.
      // align-items:flex-start puts same-line items at a matching top edge.
      const sidebar = layout.querySelector<HTMLElement>('.we-sidebar');
      if (sidebar) {
        const sidebarRect = sidebar.getBoundingClientRect();
        const sharesLine = Math.abs(sidebarRect.top - area.getBoundingClientRect().top) < 4;
        if (sharesLine) availableWidth -= sidebarRect.width + LAYOUT_GAP_PX;
      }

      // visualViewport is what's actually on screen. innerHeight (and dvh) on
      // iOS measure against the toolbar-collapsed viewport, which is taller,
      // so the board would be sized for space it doesn't currently have.
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const maxHeightPx = Math.min(viewportHeight * BOARD_HEIGHT_FRACTION, BOARD_HEIGHT_CAP_PX);

      const byWidth = (availableWidth - BOARD_PAD_PX * 2 - (G.width - 1) * TILE_GAP_PX) / G.width;
      const byHeight = (maxHeightPx - BOARD_PAD_PX * 2 - (G.height - 1) * TILE_GAP_PX) / G.height;
      const unclampedFit = Math.min(byWidth, byHeight, FIT_MAX_TILE_PX);
      const fitTilePx = Math.max(FIT_MIN_TILE_PX, unclampedFit);

      setSizing({
        fitTilePx,
        maxHeightPx,
        // Only the legibility floor can make the fit view overflow; the
        // ceiling just stops the board from growing past a comfortable size.
        fitShowsWholeBoard: unclampedFit >= FIT_MIN_TILE_PX,
      });
      // Half a pixel of slack so a fit size that rounds to the detail size
      // doesn't offer a toggle between two identical views.
      setCanZoom(fitTilePx < DETAIL_TILE_PX - 0.5);
    };

    measure();
    // The layout is the element whose width actually tracks the viewport;
    // the area's own size can stay put while the space around it changes.
    const observer = new ResizeObserver(measure);
    observer.observe(layout);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [G.width, G.height]);

  // A map that can't zoom must never be stuck in the detail view — e.g. after
  // rotating a phone to landscape, where everything suddenly fits.
  useEffect(() => {
    if (!canZoom) setZoomMode('fit');
  }, [canZoom]);

  /**
   * Returning to the fit view means "show me the whole map", so it starts at
   * the origin rather than wherever the detail view was panned to. This runs
   * after the DOM has taken the new size — resetting during the state update
   * would scroll the old, larger content and the browser could then re-clamp
   * the offset on its way down.
   */
  useLayoutEffect(() => {
    if (zoomMode === 'fit') boardWrapRef.current?.scrollTo({ left: 0, top: 0 });
  }, [zoomMode]);

  // Cues the enemy phase handing back to the player — the End Turn button
  // covers the player's own action, but nothing else marks this transition.
  // Keyed off the previous *known* player rather than a "first render" flag:
  // boardgame.io's local client can settle into its initial ctx over a
  // couple of renders, so "not the first render" isn't the same as "not the
  // initial battle load" — only a genuine enemy-to-player handoff should cue.
  const prevPlayerRef = useRef<string | null>(null);
  const phaseSeqRef = useRef(0);
  useEffect(() => {
    const prevPlayer = prevPlayerRef.current;
    prevPlayerRef.current = ctx.currentPlayer;
    // Only a genuine handoff announces itself. The opening player phase is
    // skipped deliberately: the wave/objective banner already covers battle
    // start, and two banners at once would collide.
    if (prevPlayer === null || prevPlayer === ctx.currentPlayer || ctx.gameover) return;

    if (ctx.currentPlayer === PLAYER_ID.player) sound.play('turn');
    phaseSeqRef.current += 1;
    setPhaseBanner({ team: teamOf(ctx.currentPlayer), seq: phaseSeqRef.current });
    const timer = window.setTimeout(() => setPhaseBanner(null), PHASE_BANNER_MS);
    return () => window.clearTimeout(timer);
  }, [ctx.currentPlayer, ctx.gameover]);

  // A brief centered banner at the start of every wave, including the very
  // first one on load. Purely a client-side toast — G.wave already drives
  // the real state, this just announces the change.
  useEffect(() => {
    setWaveBanner(G.wave);
    const timer = window.setTimeout(() => setWaveBanner(null), 1800);
    return () => window.clearTimeout(timer);
  }, [G.wave]);

  /**
   * Level-ups and loot are detected from the state they produce rather than
   * the moves that cause them, since each can fire mid-combo (Nova killing
   * several enemies at once) or during the CPU's turn. Watching state also
   * sidesteps the battle log, which is capped at a fixed length — once full
   * its length stops growing, so any "did the log get longer" check silently
   * stops firing a couple of waves in.
   *
   * Sound cues fire the instant the event happens; the matching popup is
   * queued and may surface later (see `visiblePopup`).
   */
  const playerLevels = useMemo(() => {
    const levels: Record<string, number> = {};
    for (const unit of unitsOf(G, 'player')) levels[unit.id] = unit.level;
    return levels;
  }, [G]);

  // Seeded null so the first pass only records a baseline — loading into a
  // battle must not announce every unit's starting level as a level-up.
  const prevLevelsRef = useRef<Record<string, number> | null>(null);
  useEffect(() => {
    const prev = prevLevelsRef.current;
    prevLevelsRef.current = playerLevels;
    if (!prev) return;

    const leveled: Popup[] = [];
    for (const [unitId, level] of Object.entries(playerLevels)) {
      const before = prev[unitId];
      // `undefined` means the unit wasn't there last pass (a revive), which
      // isn't a level-up.
      if (before === undefined || level <= before) continue;
      const unit = G.units[unitId];
      if (!unit) continue;
      leveled.push({
        kind: 'levelUp',
        unitName: unit.name,
        className: unit.className,
        level,
        levelsGained: level - before,
      });
    }

    if (leveled.length > 0) {
      sound.play('levelUp');
      setPopupQueue((queue) => [...queue, ...leveled]);
    }
  }, [playerLevels, G.units]);

  const prevInventoryLenRef = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevInventoryLenRef.current;
    prevInventoryLenRef.current = G.inventory.length;
    if (prev === null || G.inventory.length <= prev) return;

    // Drops are appended, so anything past the old length is new. Equipping
    // shrinks the list, which is why only growth counts here.
    const gained = G.inventory.slice(prev).map((item) => ITEMS[item.defId]?.name ?? 'an item');
    sound.play('drop');
    setPopupQueue((queue) => [...queue, { kind: 'loot', itemNames: gained }]);
  }, [G.inventory]);

  const prevAwaitingBlessingRef = useRef(G.awaitingBlessing);
  useEffect(() => {
    const prev = prevAwaitingBlessingRef.current;
    prevAwaitingBlessingRef.current = G.awaitingBlessing;
    if (G.awaitingBlessing && !prev) sound.play('waveClear');
  }, [G.awaitingBlessing]);

  // Drive the CPU one action at a time; each dispatch mutates G and re-runs this.
  useEffect(() => {
    if (ctx.gameover || G.awaitingBlessing || ctx.currentPlayer !== PLAYER_ID.enemy) return;

    const timer = setTimeout(() => {
      const action = decideEnemyAction(G);
      if (!action) {
        events.endTurn?.();
        return;
      }

      if (action.type === 'move') {
        moves.moveUnit(action.unitId, action.x, action.y);
        return;
      }

      if (action.type === 'wait') {
        moves.waitUnit(action.unitId);
        return;
      }

      // Attack: animate the same beats a player attack would, so enemy
      // hits are just as readable — a floating number and an HP-bar drain
      // instead of the old instant resolution.
      const attacker = G.units[action.attackerId];
      const target = G.units[action.targetId];
      if (!attacker || !target) return;

      const forecast = forecastCombat(G, attacker, target);
      const hasCounter = forecast.counterDamage !== null && !forecast.willKill;

      const beats: BeatHit[][] = [
        [{ unitId: target.id, hp: forecast.defenderHpAfter, shake: true, floatingNumber: { value: forecast.damageDealt, kind: 'damage' } }],
      ];
      if (hasCounter) {
        beats.push([
          {
            unitId: attacker.id,
            hp: forecast.attackerHpAfter,
            shake: true,
            floatingNumber: { value: forecast.counterDamage as number, kind: 'damage' },
          },
        ]);
      }

      playBeats(
        { [attacker.id]: attacker.hp, [target.id]: target.hp },
        beats,
        () => {
          moves.attackUnit(action.attackerId, action.targetId);
        },
        { attackerId: attacker.id, targetId: target.id },
      );
    }, ENEMY_ACTION_DELAY);

    return () => clearTimeout(timer);
  }, [G, ctx.currentPlayer, ctx.gameover, moves, events]);

  const reachable = useMemo(
    () => (selected && isPlayerPhase && mode === 'move' ? computeReachable(G, selected) : EMPTY_REACHABLE),
    [G, selected, isPlayerPhase, mode],
  );

  // What the selected unit could hit *from its current tile* — used both to
  // decide whether the menu offers Attack, and (once targeting) to light up
  // valid targets on the board.
  const attackTargets = useMemo(
    () => (selected && isPlayerPhase ? targetsFrom(G, selected, selected.x, selected.y) : []),
    [G, selected, isPlayerPhase],
  );
  const attackTargetIds = useMemo(
    () => new Set(attackTargets.map((unit) => unit.id)),
    [attackTargets],
  );

  const skillDef = selected ? SKILLS[selected.className] : null;

  const skillTargetList = useMemo(
    () => (selected && isPlayerPhase ? skillTargets(G, selected) : []),
    [G, selected, isPlayerPhase],
  );
  const skillTargetIds = useMemo(
    () => new Set(skillTargetList.map((unit) => unit.id)),
    [skillTargetList],
  );
  const canSkill = selected && isPlayerPhase ? canUseSkill(G, selected) : false;

  // Predicted beats for whichever target is pending confirmation — drives
  // both the confirm card's numbers and the actual animation once
  // confirmed, so the two can never disagree.
  const skillPredicted = useMemo(() => {
    if (mode !== 'skill-confirm' || !selected || !pendingTargetId) return null;
    return computeSkillBeats(selected, G.units[pendingTargetId]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [G, mode, selected, pendingTargetId]);

  // Nova's plus-shaped blast around whichever target is currently pending
  // confirmation — previewed on the board so the player sees exactly which
  // tiles are about to get hit before committing.
  const novaBlastTiles = useMemo(() => {
    if (mode !== 'skill-confirm' || skillDef?.id !== 'nova' || !pendingTargetId) return new Set<string>();
    const target = G.units[pendingTargetId];
    if (!target) return new Set<string>();
    return new Set(novaBlastCoords(target).map((c) => tileKey(c.x, c.y)));
  }, [G, mode, skillDef, pendingTargetId]);

  const threatTiles = useMemo(() => {
    if (!showThreat) return new Set<string>();
    const tiles = new Set<string>();
    for (const enemy of unitsOf(G, 'enemy')) {
      const range = computeReachable(G, { ...enemy, hasMoved: false });
      for (const key of computeThreatTiles(G, enemy, range)) tiles.add(key);
    }
    return tiles;
  }, [G, showThreat]);

  // In confirm mode the pending target drives the preview; otherwise desktop
  // hover does. Either way the bottom panel and the floating card agree.
  const previewTargetId = mode === 'confirm' ? pendingTargetId : hoveredTargetId;
  const previewTarget = previewTargetId ? G.units[previewTargetId] : undefined;
  const forecast =
    selected && previewTarget && attackTargetIds.has(previewTarget.id)
      ? forecastCombat(G, selected, previewTarget)
      : null;

  function selectUnit(unit: Unit) {
    sound.play('click');
    setSelectedId(unit.id);
    setMode('move');
    setPendingTargetId(null);
  }

  function confirmDestination(x: number, y: number) {
    if (!selected) return;
    sound.play('click');
    if (!selected.hasMoved) moves.moveUnit(selected.id, x, y);
    setMode('menu');
  }

  function handleTileClick(x: number, y: number) {
    if (!isPlayerPhase) return;
    const clicked = unitAt(G, x, y);

    if (!selected) {
      if (clicked && clicked.team === 'player' && !clicked.hasActed) selectUnit(clicked);
      return;
    }

    if (mode === 'move') {
      if (clicked && clicked.id === selected.id) {
        confirmDestination(selected.x, selected.y);
        return;
      }
      if (!clicked && reachable.has(tileKey(x, y))) {
        confirmDestination(x, y);
        return;
      }
      if (clicked && clicked.team === 'player' && !clicked.hasActed) {
        selectUnit(clicked);
        return;
      }
      clearSelection();
      return;
    }

    if (mode === 'targeting') {
      if (clicked && attackTargetIds.has(clicked.id)) {
        sound.play('click');
        setPendingTargetId(clicked.id);
        setMode('confirm');
      }
      // Other taps are ignored here — Cancel in the floating panel backs out.
      return;
    }

    if (mode === 'skill-targeting') {
      if (clicked && skillTargetIds.has(clicked.id)) {
        sound.play('click');
        setPendingTargetId(clicked.id);
        setMode('skill-confirm');
      }
      return;
    }

    // 'menu', 'confirm', and 'skill-confirm' modes are driven entirely by the floating panel.
  }

  function handleAttackPressed() {
    sound.play('click');
    setMode('targeting');
  }

  function handleSkillPressed() {
    sound.play('click');
    setMode('skill-targeting');
  }

  function handleWaitPressed() {
    if (!selected) return;
    sound.play('confirm');
    moves.waitUnit(selected.id);
    clearSelection();
  }

  function handleBackPressed() {
    sound.play('cancel');
    undo();
    clearSelection();
  }

  function toggleZoom() {
    sound.play('click');
    setZoomMode((current) => (current === 'fit' ? 'detail' : 'fit'));
  }

  function handleCancelTargeting() {
    sound.play('cancel');
    setMode('menu');
  }

  function handleCancelConfirm() {
    sound.play('cancel');
    setPendingTargetId(null);
    setMode('targeting');
  }

  function handleCancelSkillConfirm() {
    sound.play('cancel');
    setPendingTargetId(null);
    setMode('skill-targeting');
  }

  /**
   * A hard white flash across the whole viewport — the closest a tile
   * sprite can get to the mainline games' dedicated crit cutscene without an
   * actual battle scene to cut away to. `seq` is bumped rather than just
   * flipping a boolean, so the div remounts (via its key) and the animation
   * restarts even if two crits land close together, like Sword Dance's pair.
   */
  function triggerCritFlash() {
    setCritFlashSeq((seq) => (seq ?? 0) + 1);
    window.setTimeout(() => setCritFlashSeq(null), CRIT_FLASH_MS);
  }

  /**
   * Restarts the impact shake. The class has to come off and the element be
   * reflowed before it goes back on, or a second hit within the same combat
   * wouldn't replay the animation. Safe to drive imperatively: .we-board's
   * React-owned className is a constant, so React never rewrites it here.
   * `big` is for a skill's own crit hit — a heavier knock than a plain
   * attack or a counter-retaliation gets.
   */
  function shakeBoard(big = false) {
    const board = boardRef.current;
    if (!board) return;
    board.classList.remove('we-board--shake', 'we-board--shake-big');
    void board.offsetWidth;
    board.classList.add(big ? 'we-board--shake-big' : 'we-board--shake');
  }

  /**
   * Leans `strikerId` toward the centroid of `hitUnitIds`, then eases back a
   * beat later. A direction-only nudge (-1/0/1 per axis) rather than a
   * fraction of the distance, so a ranged unit (bow, staff) takes the same
   * small step forward as someone landing a melee hit next door, instead of
   * lunging halfway across the board. `crit` adds a punch-in scale for the
   * same duration, on top of the lean.
   */
  function triggerLunge(strikerId: string, hitUnitIds: string[], crit: boolean) {
    const striker = G.units[strikerId];
    const hitUnits = hitUnitIds.map((id) => G.units[id]).filter((u): u is Unit => !!u);
    if (!striker || hitUnits.length === 0) return;

    const avgX = hitUnits.reduce((sum, u) => sum + u.x, 0) / hitUnits.length;
    const avgY = hitUnits.reduce((sum, u) => sum + u.y, 0) / hitUnits.length;
    const dx = Math.sign(avgX - striker.x);
    const dy = Math.sign(avgY - striker.y);
    if (dx === 0 && dy === 0 && !crit) return;

    setLunge({ unitId: strikerId, dx, dy, crit });
    window.setTimeout(() => {
      setLunge((prev) => (prev?.unitId === strikerId ? null : prev));
    }, LUNGE_HOLD_MS);
  }

  /**
   * Plays a sequence of simultaneous HP-update beats, seeded from each
   * involved unit's current live HP, then hands control back once the last
   * beat's hold time has elapsed. Shared by player attacks, player skills,
   * and CPU attacks so all three animate the same way — a single beat can
   * update several units at once (Nova hits up to 5 tiles in one beat).
   *
   * `participants` names the two units the beats are between (attacker and
   * target for a plain attack; caster and target for a skill). Whichever one
   * *isn't* being hit in a given beat is the striker for that beat — this
   * flips correctly for a counterattack beat, where the original target
   * becomes the striker hitting the original attacker back.
   */
  function playBeats(
    startingHp: Record<string, number>,
    beats: BeatHit[][],
    onComplete: () => void,
    participants?: { attackerId: string; targetId: string },
    burstVariant: 'normal' | 'skill' = 'normal',
  ) {
    const initial: CombatAnim = {};
    for (const [unitId, hp] of Object.entries(startingHp)) {
      initial[unitId] = { hp, shaking: false, floatingNumber: null };
    }
    setCombatAnim(initial);
    setLunge(null);

    beats.forEach((beat, i) => {
      window.setTimeout(
        () => {
          setCombatAnim((prev) => {
            if (!prev) return prev;
            const next = { ...prev };
            for (const hit of beat) {
              next[hit.unitId] = {
                hp: hit.hp,
                shaking: hit.shake ?? false,
                floatingNumber: hit.floatingNumber
                  ? { ...hit.floatingNumber, seq: i, crit: hit.floatingNumber.crit ?? false }
                  : null,
              };
            }
            return next;
          });

          // Positions are read from G rather than carried on the beat: no unit
          // moves once a beat sequence has started, so G is accurate here even
          // though the underlying move hasn't been dispatched yet.
          const beatIsCrit = beat.some((hit) => hit.floatingNumber?.crit);
          for (const hit of beat) {
            const target = G.units[hit.unitId];
            if (!target) continue;
            if (hit.floatingNumber?.kind === 'heal') {
              particlesRef.current?.burst(target.x, target.y, 'heal', burstVariant);
              sound.play('heal');
            } else if (hit.shake) {
              particlesRef.current?.burst(target.x, target.y, 'damage', burstVariant);
              sound.play(hit.floatingNumber?.crit ? 'crit' : 'hit');
            }
            if (hit.hp <= 0) sound.play('defeat');
          }
          if (beat.some((hit) => hit.shake)) {
            shakeBoard(beatIsCrit);
          }
          if (beatIsCrit) triggerCritFlash();

          if (participants) {
            const hitIds = beat.map((hit) => hit.unitId);
            const hitSet = new Set(hitIds);
            const targetIsHit = hitSet.has(participants.targetId);
            const attackerIsHit = hitSet.has(participants.attackerId);
            const striker = targetIsHit && !attackerIsHit ? participants.attackerId : !targetIsHit && attackerIsHit ? participants.targetId : null;
            if (striker) triggerLunge(striker, hitIds, beatIsCrit);
          }
        },
        20 + i * COMBAT_BEAT_MS,
      );
    });

    window.setTimeout(
      () => {
        setCombatAnim(null);
        onComplete();
      },
      20 + beats.length * COMBAT_BEAT_MS,
    );
  }

  /**
   * Predicts the HP-update beats a confirmed skill will produce, using the
   * exact same formulas (HEAL_BONUS, SNIPE_BONUS, NOVA_DAMAGE_MULTIPLIER,
   * computeDamage, canCounter) the real useSkill move applies — combat is
   * deterministic and nothing else can act in between, so this preview can
   * never drift from what the move actually does. Returns null for Dance:
   * it changes no HP, so there's nothing to animate.
   */
  function computeSkillBeats(
    unit: Unit,
    target: Unit | undefined,
  ): { startingHp: Record<string, number>; beats: BeatHit[][] } | null {
    const skill = SKILLS[unit.className];

    switch (skill.id) {
      case 'heal': {
        if (!target) return null;
        const amount = Math.min(target.maxHp - target.hp, unit.atk + HEAL_BONUS);
        return {
          startingHp: { [target.id]: target.hp },
          beats: [[{ unitId: target.id, hp: target.hp + amount, floatingNumber: { value: amount, kind: 'heal' } }]],
        };
      }

      case 'dance':
        return null;

      case 'sword-dance': {
        if (!target) return null;
        const dmg1 = computeDamage(G, unit, target);
        const hpAfter1 = Math.max(0, target.hp - dmg1);
        const beats: BeatHit[][] = [
          [{ unitId: target.id, hp: hpAfter1, shake: true, floatingNumber: { value: dmg1, kind: 'damage', crit: true } }],
        ];
        if (hpAfter1 > 0) {
          const dmg2 = computeDamage(G, unit, { ...target, hp: hpAfter1 });
          const hpAfter2 = Math.max(0, hpAfter1 - dmg2);
          beats.push([{ unitId: target.id, hp: hpAfter2, shake: true, floatingNumber: { value: dmg2, kind: 'damage', crit: true } }]);
          if (hpAfter2 > 0 && canCounter(unit, target)) {
            const counterDmg = computeCounterDamage(G, target, unit);
            beats.push([
              { unitId: unit.id, hp: Math.max(0, unit.hp - counterDmg), shake: true, floatingNumber: { value: counterDmg, kind: 'damage' } },
            ]);
          }
        }
        return { startingHp: { [unit.id]: unit.hp, [target.id]: target.hp }, beats };
      }

      case 'guard-break': {
        if (!target) return null;
        const dmg = Math.max(1, effectiveStats(unit).atk - effectiveStats(target).def);
        const hpAfter = Math.max(0, target.hp - dmg);
        const beats: BeatHit[][] = [
          [{ unitId: target.id, hp: hpAfter, shake: true, floatingNumber: { value: dmg, kind: 'damage', crit: true } }],
        ];
        if (hpAfter > 0 && canCounter(unit, target)) {
          const counterDmg = computeCounterDamage(G, target, unit);
          beats.push([
            { unitId: unit.id, hp: Math.max(0, unit.hp - counterDmg), shake: true, floatingNumber: { value: counterDmg, kind: 'damage' } },
          ]);
        }
        return { startingHp: { [unit.id]: unit.hp, [target.id]: target.hp }, beats };
      }

      case 'snipe': {
        if (!target) return null;
        const dmg = computeDamage(G, unit, target) + SNIPE_BONUS;
        return {
          startingHp: { [target.id]: target.hp },
          beats: [[{ unitId: target.id, hp: Math.max(0, target.hp - dmg), shake: true, floatingNumber: { value: dmg, kind: 'damage', crit: true } }]],
        };
      }

      case 'nova': {
        if (!target) return null;
        const hits = novaBlastTargets(G, unit, target);
        if (hits.length === 0) return null;
        const startingHp: Record<string, number> = {};
        const beat: BeatHit[] = hits.map((hitTarget) => {
          startingHp[hitTarget.id] = hitTarget.hp;
          const dmg = Math.max(1, Math.round(computeDamage(G, unit, hitTarget) * NOVA_DAMAGE_MULTIPLIER));
          return { unitId: hitTarget.id, hp: Math.max(0, hitTarget.hp - dmg), shake: true, floatingNumber: { value: dmg, kind: 'damage', crit: true } };
        });
        return { startingHp, beats: [beat] };
      }

      case 'rampage': {
        if (!target) return null;
        const dmg = computeDamage(G, unit, target);
        const hpAfter = Math.max(0, target.hp - dmg);
        const beats: BeatHit[][] = [
          [{ unitId: target.id, hp: hpAfter, shake: true, floatingNumber: { value: dmg, kind: 'damage', crit: true } }],
        ];
        if (hpAfter > 0 && canCounter(unit, target)) {
          const counterDmg = computeCounterDamage(G, target, unit);
          beats.push([
            { unitId: unit.id, hp: Math.max(0, unit.hp - counterDmg), shake: true, floatingNumber: { value: counterDmg, kind: 'damage' } },
          ]);
        }
        return { startingHp: { [unit.id]: unit.hp, [target.id]: target.hp }, beats };
      }

      default:
        return null;
    }
  }

  function handleConfirmSkill() {
    if (!selected || !pendingTargetId) return;
    sound.play('confirm');
    const unitId = selected.id;
    const targetId = pendingTargetId;
    const predicted = skillPredicted;

    if (!predicted) {
      moves.useSkill(unitId, targetId);
      clearSelection();
      return;
    }

    setMode('animating');
    playBeats(
      predicted.startingHp,
      predicted.beats,
      () => {
        moves.useSkill(unitId, targetId);
        clearSelection();
      },
      { attackerId: unitId, targetId },
      'skill',
    );
  }

  /**
   * Plays the confirmed exchange out beat by beat using the forecast we
   * already computed, then dispatches the real attackUnit move once the
   * animation finishes. The move is the only thing that actually changes G;
   * everything visible during playback is local state that happens to match
   * where the move is about to land.
   */
  function handleConfirmAttack() {
    if (!selected || !pendingTargetId || !forecast || !previewTarget) return;
    sound.play('confirm');

    const attackerId = selected.id;
    const targetId = pendingTargetId;
    const hasCounter = forecast.counterDamage !== null && !forecast.willKill;

    const beats: BeatHit[][] = [
      [{ unitId: targetId, hp: forecast.defenderHpAfter, shake: true, floatingNumber: { value: forecast.damageDealt, kind: 'damage' } }],
    ];
    if (hasCounter) {
      beats.push([
        {
          unitId: attackerId,
          hp: forecast.attackerHpAfter,
          shake: true,
          floatingNumber: { value: forecast.counterDamage as number, kind: 'damage' },
        },
      ]);
    }

    setMode('animating');
    playBeats(
      { [attackerId]: selected.hp, [targetId]: previewTarget.hp },
      beats,
      () => {
        moves.attackUnit(attackerId, targetId);
        clearSelection();
      },
      { attackerId, targetId },
    );
  }

  const gameover = ctx.gameover as GameOver | undefined;

  /**
   * The board's exact rendered size. Every term is known, so the box is sized
   * from arithmetic rather than letting the grid's intrinsic size decide —
   * see the note in board.css on why intrinsic sizing is avoided here.
   */
  const boardTilePx = zoomMode === 'detail' ? DETAIL_TILE_PX : (sizing?.fitTilePx ?? DETAIL_TILE_PX);
  const boardPx = {
    width: G.width * boardTilePx + (G.width - 1) * TILE_GAP_PX + BOARD_PAD_PX * 2,
    height: G.height * boardTilePx + (G.height - 1) * TILE_GAP_PX + BOARD_PAD_PX * 2,
  };

  /**
   * Announcements are held back until the player is actually in control.
   * A drop or level-up can land during the enemy phase (a counterattack
   * killing its attacker), and interrupting the CPU mid-turn would both read
   * as a bug and offer an "Open equipment" button that goes nowhere, since
   * the inventory only opens on the player's own phase. Queued cards simply
   * surface the moment the phase flips back.
   */
  const popupsReady = isPlayerPhase && !G.awaitingBlessing && !gameover && mode !== 'animating';
  const visiblePopup = popupsReady ? (popupQueue[0] ?? null) : null;

  function dismissPopup() {
    setPopupQueue((queue) => queue.slice(1));
  }

  // Level-up cards read themselves out and go; loot cards wait for a choice.
  useEffect(() => {
    if (visiblePopup?.kind !== 'levelUp') return;
    const timer = window.setTimeout(dismissPopup, LEVEL_UP_POPUP_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiblePopup]);

  function handlePopupOpenEquipment() {
    sound.play('confirm');
    setInventoryUnitId((current) => current ?? selectedId ?? unitsOf(G, 'player')[0]?.id ?? null);
    setInventoryOpen(true);
    dismissPopup();
  }

  return (
    <div className="we-app">
      <header className="we-header">
        {/* Campaign names the chapter you're in; roguelike is always the
            same endless run, so it just says the mode. The game's own name
            (and version) live on the title screen, where there's room. */}
        <h1>{G.mode === 'campaign' ? G.chapterShortName : 'Roguelike'}</h1>
        <div className="we-header-actions">
          <MuteToggle />
          <button
            type="button"
            className="we-iconbutton we-iconbutton--icon"
            aria-label="Main menu"
            title="Main menu"
            onClick={() => {
              sound.play('cancel');
              exitToMenu();
            }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path fill="currentColor" d="M12 3 2 12h3v8h6v-5h2v5h6v-8h3L12 3z" />
            </svg>
          </button>
          <button
            type="button"
            className="we-iconbutton we-iconbutton--icon"
            aria-pressed={showThreat}
            aria-label={`${showThreat ? 'Hide' : 'Show'} enemy range`}
            title={`${showThreat ? 'Hide' : 'Show'} enemy range`}
            onClick={() => {
              sound.play('click');
              setShowThreat((value) => !value);
            }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                fill="currentColor"
                d="M12 5c-5.05 0-9.27 3.11-11 7.5 1.73 4.39 5.95 7.5 11 7.5s9.27-3.11 11-7.5C21.27 8.11 17.05 5 12 5zm0 12.5a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"
              />
            </svg>
          </button>
          {isPlayerPhase && (
            <button
              type="button"
              className="we-iconbutton we-iconbutton--icon"
              aria-label={`Squad & inventory${G.inventory.length > 0 ? ` (${G.inventory.length} item${G.inventory.length === 1 ? '' : 's'} to equip)` : ''}`}
              title="Squad & inventory"
              onClick={() => {
                sound.play('click');
                setInventoryUnitId((current) => current ?? selectedId ?? unitsOf(G, 'player')[0]?.id ?? null);
                setInventoryOpen(true);
              }}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M9 2a1 1 0 0 0-1 1v1H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V3a1 1 0 0 0-1-1H9zm1 2h4v1h-4V4zM6 8h12v11H6V8zm3 2v2h2v-2H9zm4 0v2h2v-2h-2z"
                />
              </svg>
              {G.inventory.length > 0 && (
                <span className="we-iconbutton__badge">{G.inventory.length}</span>
              )}
            </button>
          )}
          {isPlayerPhase && mode !== 'animating' && (
            <button
              type="button"
              className="we-iconbutton we-iconbutton--icon"
              aria-label="End turn"
              title="End turn"
              onClick={() => {
                sound.play('turn');
                clearSelection();
                events.endTurn?.();
              }}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path fill="currentColor" d="M6 5v14l8-7-8-7zm10 0v14h2V5h-2z" />
              </svg>
            </button>
          )}
        </div>
      </header>

      {mode === 'targeting' && (
        <div className="we-targeting-hint">
          <span>Choose a target</span>
          <button type="button" className="we-iconbutton" onClick={handleCancelTargeting}>
            Cancel
          </button>
        </div>
      )}

      {mode === 'skill-targeting' && skillDef && (
        <div className="we-targeting-hint">
          <span>Choose a target for {skillDef.name}</span>
          <button type="button" className="we-iconbutton" onClick={() => setMode('menu')}>
            Cancel
          </button>
        </div>
      )}

      <div className="we-layout">
        {/* The zoom control sits outside .we-board-wrap's scroll box so it
            stays pinned while a large map is panned around underneath it. */}
        <div className="we-board-area" ref={boardAreaRef}>
          {/* Confined to the tile map, not the whole viewport — these are
              meant to hit like a screen effect over the board specifically,
              distinct from the header/sidebar around it. Anchored to
              .we-board-area rather than .we-board-wrap for the same reason
              the phase banner is: .we-board-area never scrolls, so inset:0
              here always covers exactly what's currently visible of the
              map, at any scroll position or zoom level. Both are non-
              interactive and keyed to remount so repeats (a second crit, a
              fast phase flip) always restart cleanly. */}
          {phaseBanner && (
            <div key={`tint-${phaseBanner.seq}`} className={`we-phase-tint we-phase-tint--${phaseBanner.team}`} />
          )}
          {critFlashSeq != null && <div key={`flash-${critFlashSeq}`} className="we-crit-flash" />}

          {canZoom && (
            <div className="we-zoom">
              <button
                type="button"
                className="we-iconbutton we-iconbutton--icon"
                aria-label={zoomMode === 'fit' ? 'Zoom in' : 'Show whole map'}
                title={zoomMode === 'fit' ? 'Zoom in' : 'Show whole map'}
                onClick={toggleZoom}
              >
                {zoomMode === 'fit' ? (
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <path fill="currentColor" d="M5 11h14v2H5z" />
                  </svg>
                )}
              </button>
            </div>
          )}
        <div
          className="we-board-wrap"
          ref={boardWrapRef}
          style={
            sizing
              ? ({
                  '--board-max-h': `${Math.round(sizing.maxHeightPx)}px`,
                  // In the fit view the whole board is on screen, so there is
                  // nothing to scroll to and panning can only ever reveal
                  // empty space. Turning overflow off says exactly that, and
                  // it does not depend on the engine agreeing about how big
                  // the content is: the unit tokens are absolutely positioned
                  // and move by transform, which contributes to this box's
                  // scrollable overflow, and a composited transform change is
                  // not a layout — WebKit can keep serving the extent from
                  // before the zoom. Clamping is the only case where the fit
                  // view really can overflow, so it keeps its scrollbars.
                  overflow: zoomMode === 'fit' && sizing.fitShowsWholeBoard ? 'hidden' : 'auto',
                } as CSSProperties)
              : undefined
          }
        >
          <div
            ref={boardRef}
            className="we-board"
            onAnimationEnd={(event) => {
              // Clear the shake so the class never lingers between hits.
              if (event.animationName.includes('we-board-shake')) {
                boardRef.current?.classList.remove('we-board--shake');
              }
            }}
            style={
              {
                gridTemplateColumns: `repeat(${G.width}, var(--tile))`,
                '--terrain-src': `url(${terrainTileset})`,
                // The single source of truth for board scale. Set here as a
                // plain px value rather than computed in CSS — see the note on
                // the sizing constants for why.
                '--tile': `${boardTilePx}px`,
                // Explicit rather than intrinsic (max-content) so nothing
                // about the scroll container's extent depends on an engine
                // recomputing a cached intrinsic size when --tile changes.
                width: `${boardPx.width}px`,
                height: `${boardPx.height}px`,
              } as CSSProperties
            }
          >
            {G.tiles.map((row, y) =>
              row.map((terrainType, x) => {
                const key = tileKey(x, y);
                const occupant = unitAt(G, x, y);
                const classes = ['we-tile', `we-tile--${terrainType}`];

                const isAttackTarget = mode === 'targeting' && occupant && attackTargetIds.has(occupant.id);
                const isSkillTarget = mode === 'skill-targeting' && occupant && skillTargetIds.has(occupant.id);

                if (reachable.has(key) && !occupant) classes.push('we-tile--move');
                if (isAttackTarget) classes.push('we-tile--attack');
                if (isSkillTarget) {
                  classes.push(skillDef?.targetType === 'ally' ? 'we-tile--support' : 'we-tile--attack');
                }
                if (novaBlastTiles.has(key)) classes.push('we-tile--blast');
                if (selected && selected.x === x && selected.y === y) {
                  classes.push('we-tile--selected');
                }
                if (threatTiles.has(key)) classes.push('we-tile--threat');
                // Whichever unit's stats are currently shown in the side panel — via
                // hover, tap, or a pending attack/skill target — gets its own tile
                // outlined too, so tapping an enemy or an already-acted ally to
                // inspect them doesn't leave the board looking unresponsive.
                if (
                  previewTarget &&
                  occupant?.id === previewTarget.id &&
                  !isAttackTarget &&
                  !isSkillTarget &&
                  !(selected && selected.x === x && selected.y === y)
                ) {
                  classes.push('we-tile--inspected');
                }

                return (
                  <button
                    key={key}
                    type="button"
                    className={classes.join(' ')}
                    onClick={() => handleTileClick(x, y)}
                    onMouseEnter={() => setHoveredTargetId(occupant?.id ?? null)}
                    onMouseLeave={() => setHoveredTargetId(null)}
                    title={`${terrainAt(G, x, y).name} (${x}, ${y})`}
                    style={{ '--terrain-index': TERRAIN_SPRITE_INDEX[terrainType] } as CSSProperties}
                  />
                );
              }),
            )}

            <ParticleLayer ref={particlesRef} cols={G.width} />

            {/* Positioned separately from the tile grid, keyed by unit id, so
                moving a unit slides its token to the new cell instead of the
                tile-button remount that would otherwise cause an instant jump. */}
            <div className="we-unit-layer">
              {Object.values(G.units).map((unit) => {
                const anim = combatAnim?.[unit.id];
                const hpOverride = anim?.hp;
                const shaking = anim?.shaking ?? false;
                const floatingNumber = anim?.floatingNumber ?? null;
                // A brief step toward whoever this unit is currently striking,
                // so an attack reads as a lunge instead of two HP bars moving
                // while both sprites stand still. Direction-only, not fraction
                // of distance — see LUNGE_FRACTION.
                const lungeDx = lunge?.unitId === unit.id ? lunge.dx : 0;
                const lungeDy = lunge?.unitId === unit.id ? lunge.dy : 0;
                // A punch-in on a crit's striker, on top of the lean. Scale is
                // last in the transform list, so it grows from the sprite's
                // own already-translated center rather than shifting position.
                const critScale = lunge?.unitId === unit.id && lunge.crit ? CRIT_PUNCH_SCALE : 1;

                return (
                  <div
                    key={unit.id}
                    className="we-unit-slot"
                    style={{
                      transform: `translate(calc((var(--tile) + var(--tile-gap)) * ${unit.x} + var(--tile) * ${lungeDx * LUNGE_FRACTION}), calc((var(--tile) + var(--tile-gap)) * ${unit.y} + var(--tile) * ${lungeDy * LUNGE_FRACTION})) scale(${critScale})`,
                      zIndex: critScale > 1 ? 2 : undefined,
                    }}
                  >
                    <UnitToken
                      unit={unit}
                      hpOverride={hpOverride}
                      shaking={shaking}
                      floatingNumber={floatingNumber}
                    />
                  </div>
                );
              })}
            </div>

            {selected && mode === 'menu' && (
              <ActionPanel
                unit={selected}
                boardWidth={G.width}
                boardHeight={G.height}
                canAttack={attackTargets.length > 0}
                skillLabel={canSkill && skillDef ? skillDef.name : null}
                skillCategory={skillDef?.category ?? null}
                onAttack={handleAttackPressed}
                onSkill={handleSkillPressed}
                onWait={handleWaitPressed}
                onBack={handleBackPressed}
              />
            )}

            {mode === 'confirm' && selected && previewTarget && forecast && (
              <ForecastCard
                attacker={selected}
                target={previewTarget}
                forecast={forecast}
                onConfirm={handleConfirmAttack}
                onCancel={handleCancelConfirm}
              />
            )}

            {mode === 'skill-confirm' && selected && skillDef && (
              <SkillConfirmCard
                G={G}
                unit={selected}
                skill={skillDef}
                target={pendingTargetId ? G.units[pendingTargetId] : undefined}
                predicted={skillPredicted}
                onConfirm={handleConfirmSkill}
                onCancel={handleCancelSkillConfirm}
              />
            )}

          </div>
        </div>

        {/* Outside .we-board-wrap entirely, not just outside .we-board — a
            position:absolute element still scrolls along with its scroll-
            container ancestor even when it isn't the ancestor being
            scrolled itself (only position:fixed/sticky escape that). Anchored
            to .we-board-area instead, which never scrolls: its own height is
            just whatever .we-board-wrap renders at (the capped viewport
            size, not the full board), so top:50% here means the middle of
            what's actually on screen, at any scroll position or zoom. */}
        {waveBanner != null && (
          <div key={waveBanner} className="we-wave-banner" aria-live="polite">
            {/* Campaign has no waves — announce the chapter's objective
                instead, which is the thing a player needs at battle start. */}
            {G.mode === 'campaign' ? G.objective : `Wave ${waveBanner} Starts`}
          </div>
        )}

        {phaseBanner && (
          <div
            key={phaseBanner.seq}
            className={`we-phase-banner we-phase-banner--${phaseBanner.team}`}
            aria-live="polite"
          >
            <span className="we-phase-banner__text">
              {phaseBanner.team === 'player' ? 'Player Phase' : 'Enemy Phase'}
            </span>
          </div>
        )}
        </div>

        <aside className="we-sidebar">
          <SidePanel selected={selected} hovered={previewTarget} forecast={forecast} G={G} />

          <ol className="we-log">
            {G.log.map((entry, index) => (
              <li key={`${index}-${entry}`}>{entry}</li>
            ))}
          </ol>
        </aside>
      </div>

      {inventoryOpen && isPlayerPhase && (
        <InventoryPanel
          G={G}
          unitId={inventoryUnitId}
          onSelectUnit={setInventoryUnitId}
          onEquip={(unitId, instanceId) => {
            sound.play('confirm');
            moves.equipItem(unitId, instanceId);
          }}
          onUnequip={(unitId, slot) => {
            sound.play('cancel');
            moves.unequipItem(unitId, slot);
          }}
          onClose={() => {
            sound.play('cancel');
            setInventoryOpen(false);
          }}
        />
      )}

      {visiblePopup && !inventoryOpen && (
        <AnnouncementPopup
          popup={visiblePopup}
          onDismiss={() => {
            sound.play('confirm');
            dismissPopup();
          }}
          onOpenEquipment={handlePopupOpenEquipment}
        />
      )}

      {G.awaitingBlessing && !gameover && (
        <div className="we-overlay">
          <div className="we-overlay__card we-overlay__card--blessing">
            <h2>Wave {G.wave} cleared!</h2>
            <p>Choose a blessing before Wave {G.wave + 1} begins.</p>
            <div className="we-blessing-list">
              {G.offeredBlessingIds.map((id) => {
                const blessing = BLESSINGS.find((candidate) => candidate.id === id);
                if (!blessing) return null;
                return (
                  <button
                    key={blessing.id}
                    type="button"
                    className="we-blessing"
                    onClick={() => {
                      sound.play('confirm');
                      moves.chooseBlessing(blessing.id);
                    }}
                  >
                    <strong>{blessing.name}</strong>
                    <span>{blessing.description}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {gameover && (
        <div className="we-overlay">
          <div className="we-overlay__card">
            <h2>{gameover.winner === 'player' ? 'Victory' : 'Defeat'}</h2>
            <p>
              {gameover.winner === 'player'
                ? `${G.chapterName} complete — every enemy defeated.`
                : G.mode === 'campaign'
                  ? `Your company was wiped out in ${G.chapterName}.`
                  : `Your company has been wiped out, having survived ${G.wave} wave${G.wave === 1 ? '' : 's'}.`}
            </p>
            <div className="we-overlay__actions">
              <button
                type="button"
                className="we-button"
                onClick={() => {
                  sound.play('confirm');
                  retry();
                }}
              >
                {gameover.winner === 'player' ? 'Play again' : 'Retry'}
              </button>
              <button
                type="button"
                className="we-button we-button--ghost"
                onClick={() => {
                  sound.play('cancel');
                  exitToMenu();
                }}
              >
                Main menu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Floating, Fire-Emblem-style context menu anchored beside the selected
 * unit's tile. Flips to the opposite side near the board edge so it never
 * renders off the board.
 */
function ActionPanel({
  unit,
  boardWidth,
  boardHeight,
  canAttack,
  skillLabel,
  skillCategory,
  onAttack,
  onSkill,
  onWait,
  onBack,
}: {
  unit: Unit;
  boardWidth: number;
  boardHeight: number;
  canAttack: boolean;
  /** The skill's own name (e.g. "Heal"), or null when it's not usable right now. */
  skillLabel: string | null;
  /** Colors the skill button — attack skills read red, Heal green, Dance yellow. */
  skillCategory: SkillCategory | null;
  onAttack: () => void;
  onSkill: () => void;
  onWait: () => void;
  onBack: () => void;
}) {
  const side = unit.x < boardWidth / 2 ? 'right' : 'left';
  // Mirrors the left/right flip: a unit in the board's bottom half grows
  // the menu upward from its tile instead of downward, so it can't run off
  // the bottom of the viewport the way it used to for the last couple rows.
  const vSide = unit.y < boardHeight / 2 ? 'down' : 'up';

  return (
    <div
      className={`we-panel-anchor we-panel-anchor--${side} we-panel-anchor--${vSide}`}
      style={{
        transform: `translate(calc((var(--tile) + var(--tile-gap)) * ${unit.x}), calc((var(--tile) + var(--tile-gap)) * ${unit.y}))`,
      }}
    >
      <div className="we-menu">
        {canAttack && (
          <button type="button" className="we-menu__item we-menu__item--attack" onClick={onAttack}>
            Attack
          </button>
        )}
        {skillLabel && (
          <button type="button" className={`we-menu__item we-menu__item--${skillCategory}`} onClick={onSkill}>
            {skillLabel}
          </button>
        )}
        <button type="button" className="we-menu__item we-menu__item--wait" onClick={onWait}>
          Wait
        </button>
        <button type="button" className="we-menu__item we-menu__item--back" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}

const SLOTS: ItemSlot[] = ['weapon', 'armor', 'accessory'];
const SLOT_LABEL: Record<ItemSlot, string> = { weapon: 'Weapon', armor: 'Armor', accessory: 'Accessory' };

/**
 * Squad-wide gear management, reachable any time during the player phase.
 * Equipping doesn't cost a turn, so it's deliberately not folded into the
 * per-unit move/attack/wait menu — a dismissible overlay instead, same
 * shell as the blessing screen.
 */
function InventoryPanel({
  G,
  unitId,
  onSelectUnit,
  onEquip,
  onUnequip,
  onClose,
}: {
  G: GameState;
  unitId: string | null;
  onSelectUnit: (id: string) => void;
  onEquip: (unitId: string, instanceId: string) => void;
  onUnequip: (unitId: string, slot: ItemSlot) => void;
  onClose: () => void;
}) {
  const roster = unitsOf(G, 'player');
  const unit = (unitId && G.units[unitId]) || roster[0];

  return (
    <div className="we-overlay" onClick={onClose}>
      <div
        className="we-overlay__card we-overlay__card--inventory"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="we-overlay__header">
          <h2>Squad &amp; Inventory</h2>
          <button type="button" className="we-iconbutton we-iconbutton--icon" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                fill="currentColor"
                d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6z"
              />
            </svg>
          </button>
        </div>

        <div className="we-roster-tabs">
          {roster.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              className={`we-roster-tab${candidate.id === unit?.id ? ' we-roster-tab--active' : ''}`}
              onClick={() => onSelectUnit(candidate.id)}
            >
              {candidate.name}
            </button>
          ))}
        </div>

        {unit && (
          <>
            <div className="we-equip-slots">
              {SLOTS.map((slot) => {
                const equipped = unit.equipment[slot];
                const itemDef = equipped && ITEMS[equipped.defId];
                return (
                  <div key={slot} className="we-equip-slot">
                    <span className="we-equip-slot__label">{SLOT_LABEL[slot]}</span>
                    {itemDef ? (
                      <>
                        <span className="we-equip-slot__item">
                          {itemDef.name} <em>{itemDef.description}</em>
                        </span>
                        <button
                          type="button"
                          className="we-iconbutton"
                          onClick={() => onUnequip(unit.id, slot)}
                        >
                          Unequip
                        </button>
                      </>
                    ) : (
                      <span className="we-equip-slot__empty">Empty</span>
                    )}
                  </div>
                );
              })}
            </div>

            <h3 className="we-inventory-title">Inventory</h3>
            {G.inventory.length === 0 ? (
              <p className="we-inventory-empty">
                No items yet — defeated enemies have a chance to drop gear.
              </p>
            ) : (
              <div className="we-inventory-list">
                {G.inventory.map((item) => {
                  const itemDef = ITEMS[item.defId];
                  return (
                    <button
                      key={item.instanceId}
                      type="button"
                      className="we-inventory-item"
                      onClick={() => onEquip(unit.id, item.instanceId)}
                    >
                      <strong>{itemDef.name}</strong>
                      <span>
                        {SLOT_LABEL[itemDef.slot]} · {itemDef.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The combat forecast, centered over the board rather than anchored beside
 * either unit — anchoring it to a unit's tile meant it could run off the
 * edge of our narrow 6-wide board and get clipped by the viewport.
 */
function ForecastCard({
  attacker,
  target,
  forecast,
  onConfirm,
  onCancel,
}: {
  attacker: Unit;
  target: Unit;
  forecast: CombatForecast;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="we-forecast-card">
      <div className="we-forecast-card__matchup">
        <ForecastSide
          unit={attacker}
          hpAfter={forecast.attackerWillDie ? 0 : forecast.attackerHpAfter}
          statLabel="Atk"
          statValue={forecast.damageDealt}
        />
        <span className="we-forecast-card__vs">VS</span>
        <ForecastSide
          unit={target}
          hpAfter={forecast.defenderHpAfter}
          statLabel={forecast.counterDamage !== null ? 'Counter' : 'No counter'}
          statValue={forecast.counterDamage}
        />
      </div>
      {forecast.willKill && <div className="we-menu__kill">Lethal</div>}
      {forecast.attackerWillDie && <div className="we-menu__danger">You would die</div>}
      <button type="button" className="we-menu__item we-menu__item--confirm" onClick={onConfirm}>
        Confirm
      </button>
      <button type="button" className="we-menu__item we-menu__item--back" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

/**
 * One side of the FE-style forecast card — portrait, name, HP transitioning
 * to its post-combat value, and the stat that produced it (damage dealt or
 * counter damage). The sprite is pinned to its first frame rather than idle-
 * animating, so the card reads calmly instead of two characters twitching
 * mid-decision.
 */
function ForecastSide({
  unit,
  hpAfter,
  statLabel,
  statValue,
}: {
  unit: Unit;
  hpAfter: number;
  statLabel: string;
  statValue: number | null;
}) {
  const sprite = UNIT_SPRITES[unit.className];
  const hpChanges = hpAfter !== unit.hp;

  return (
    <div className={`we-forecast-side we-forecast-side--${unit.team}`}>
      <div className="we-forecast-side__nameplate">{unit.name}</div>
      <div className="we-forecast-side__portrait">
        {sprite ? (
          <span
            className="we-unit__sprite we-unit__sprite--static"
            style={
              {
                '--frame-w': `${sprite.frameWidth}px`,
                '--frame-h': `${sprite.frameHeight}px`,
                '--frame-count': sprite.frames,
                '--sprite-src': `url(${sprite.src})`,
                '--sprite-scale': 34 / sprite.frameHeight,
              } as CSSProperties
            }
          />
        ) : (
          <span className="we-unit__glyph">{unit.name.charAt(0)}</span>
        )}
      </div>
      <div className="we-forecast-side__hp">
        {unit.hp}
        {hpChanges && (
          <>
            <span className="we-forecast-side__arrow">→</span>
            <strong className={hpAfter === 0 ? 'we-forecast-side__hp-zero' : ''}>{hpAfter}</strong>
          </>
        )}
      </div>
      <div className="we-forecast-side__stat">
        {statLabel} {statValue ?? '—'}
      </div>
    </div>
  );
}

/**
 * What a skill's confirm card needs to show per side — same shape as the
 * plain-attack forecast (own HP transition + the stat that produced it), so
 * skills and attacks can share ForecastSide instead of two visual styles.
 */
interface SkillForecastDisplay {
  casterHpAfter: number;
  casterStatLabel: string;
  casterStatValue: number | null;
  casterWillDie: boolean;
  targetHpAfter: number;
  targetStatLabel: string;
  targetStatValue: number | null;
  targetWillDie: boolean;
}

/**
 * Derives the confirm card's numbers straight from the same predicted beats
 * that will play the animation — not a fresh formula, so the card can never
 * show a different number than what actually lands. For a multi-target
 * skill (Nova), only the tapped target's beat entries are folded in; splash
 * victims aren't shown here, matching the "just the main target" ask.
 */
function buildSkillForecast(
  unit: Unit,
  target: Unit,
  predicted: { startingHp: Record<string, number>; beats: BeatHit[][] } | null,
): SkillForecastDisplay | null {
  if (!predicted) return null;
  const isHeal = SKILLS[unit.className].id === 'heal';

  let casterHp = unit.hp;
  let targetHp = target.hp;
  let dealt = 0;
  let counter: number | null = null;

  for (const beat of predicted.beats) {
    for (const hit of beat) {
      if (hit.unitId === target.id) {
        targetHp = hit.hp;
        if (hit.floatingNumber) dealt += hit.floatingNumber.value;
      } else if (hit.unitId === unit.id) {
        casterHp = hit.hp;
        if (hit.floatingNumber) counter = hit.floatingNumber.value;
      }
    }
  }

  return {
    casterHpAfter: casterHp,
    casterStatLabel: isHeal ? 'Heal' : 'Atk',
    casterStatValue: dealt,
    casterWillDie: casterHp <= 0,
    targetHpAfter: targetHp,
    targetStatLabel: isHeal ? '' : counter !== null ? 'Counter' : 'No counter',
    targetStatValue: isHeal ? null : counter,
    targetWillDie: !isHeal && targetHp <= 0,
  };
}

/**
 * Same Fire Emblem-style matchup as a plain attack's ForecastCard — only
 * Dance falls back to a plain-text line, since refreshing an ally changes
 * no HP and there's nothing to put in a portrait matchup.
 */
function SkillConfirmCard({
  G,
  unit,
  skill,
  target,
  predicted,
  onConfirm,
  onCancel,
}: {
  G: GameState;
  unit: Unit;
  skill: SkillDef;
  target: Unit | null | undefined;
  predicted: { startingHp: Record<string, number>; beats: BeatHit[][] } | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const display = target ? buildSkillForecast(unit, target, predicted) : null;

  const title = (
    <div className="we-skill-card__title">
      {unit.name}'s {skill.name}
    </div>
  );

  if (!display || !target) {
    return (
      <div className="we-forecast-card we-skill-card">
        {title}
        <div className="we-skill-card__preview">{describeSkillEffect(G, unit, target ?? null)}</div>
        <button type="button" className="we-menu__item we-menu__item--confirm" onClick={onConfirm}>
          Confirm
        </button>
        <button type="button" className="we-menu__item we-menu__item--back" onClick={onCancel}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="we-forecast-card">
      {title}
      <div className="we-skill-card__preview">{describeSkillEffect(G, unit, target)}</div>
      <div className="we-forecast-card__matchup">
        <ForecastSide
          unit={unit}
          hpAfter={display.casterHpAfter}
          statLabel={display.casterStatLabel}
          statValue={display.casterStatValue}
        />
        <span className="we-forecast-card__vs">VS</span>
        <ForecastSide
          unit={target}
          hpAfter={display.targetHpAfter}
          statLabel={display.targetStatLabel}
          statValue={display.targetStatValue}
        />
      </div>
      {display.targetWillDie && <div className="we-menu__kill">Lethal</div>}
      {display.casterWillDie && <div className="we-menu__danger">You would die</div>}
      <button type="button" className="we-menu__item we-menu__item--confirm" onClick={onConfirm}>
        Confirm
      </button>
      <button type="button" className="we-menu__item we-menu__item--back" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

function UnitToken({
  unit,
  hpOverride,
  shaking,
  floatingNumber,
}: {
  unit: Unit;
  /** Shown instead of unit.hp while a confirmed attack is animating. */
  hpOverride?: number;
  shaking?: boolean;
  floatingNumber?: { value: number; kind: 'damage' | 'heal'; seq: number; crit: boolean } | null;
}) {
  const displayedHp = hpOverride ?? unit.hp;
  const hpRatio = Math.max(0, displayedHp) / unit.maxHp;
  const sprite = UNIT_SPRITES[unit.className];

  const classes = [
    'we-unit',
    `we-unit--${unit.team}`,
    unit.hasActed ? 'we-unit--spent' : '',
    shaking ? 'we-unit--shake' : '',
  ].filter(Boolean);

  const artClasses = ['we-unit__art', sprite ? '' : 'we-unit__art--glyph'].filter(Boolean);

  const hpFillClasses = [
    'we-unit__hp-fill',
    hpRatio <= 0.3 ? 'we-unit__hp-fill--low' : hpRatio <= 0.6 ? 'we-unit__hp-fill--mid' : '',
  ].filter(Boolean);

  return (
    <div className={classes.join(' ')}>
      {/* Dimming for a spent unit lives here, not on .we-unit itself, so it
          only affects the character art — the HP bar and damage numbers
          below stay fully visible and legible either way. */}
      <span className={artClasses.join(' ')}>
        {sprite ? (
          <span
            className="we-unit__sprite we-unit__sprite--board"
            style={
              {
                '--frame-count': sprite.frames,
                '--sprite-src': `url(${sprite.src})`,
                // Board art sizes off --tile (see .we-unit__sprite--board), so
                // it needs the sheet's shape rather than a fixed pixel height.
                '--sprite-aspect': sprite.frameWidth / sprite.frameHeight,
              } as CSSProperties
            }
          />
        ) : (
          <span className="we-unit__glyph">{unit.name.charAt(0)}</span>
        )}
      </span>
      <span className="we-unit__hp">
        <span className={hpFillClasses.join(' ')} style={{ width: `${hpRatio * 100}%` }} />
      </span>
      {floatingNumber != null && (
        <span
          key={`${floatingNumber.kind}-${floatingNumber.seq}`}
          className={`we-unit__float-num we-unit__float-num--${floatingNumber.kind}${floatingNumber.crit ? ' we-unit__float-num--crit' : ''}`}
        >
          {floatingNumber.kind === 'heal' ? '+' : '-'}
          {floatingNumber.value}
        </span>
      )}
    </div>
  );
}

/**
 * The queued announcement card. A level-up is informational and clears
 * itself on a timer; loot asks a question, so it stays until answered.
 */
function AnnouncementPopup({
  popup,
  onDismiss,
  onOpenEquipment,
}: {
  popup: Popup;
  onDismiss: () => void;
  onOpenEquipment: () => void;
}) {
  if (popup.kind === 'levelUp') {
    // Growth is flat per level, so a multi-level gain just multiplies it.
    const gain = (per: number) => per * popup.levelsGained;
    const sprite = UNIT_SPRITES[popup.className];

    return (
      <div className="we-overlay we-overlay--passive">
        <div className="we-overlay__card we-popup we-popup--levelup" role="status" onClick={onDismiss}>
          <div className="we-popup__head">
            {sprite && (
              <span
                className="we-unit__sprite we-popup__portrait"
                style={
                  {
                    '--frame-w': `${sprite.frameWidth}px`,
                    '--frame-h': `${sprite.frameHeight}px`,
                    '--frame-count': sprite.frames,
                    '--sprite-src': `url(${sprite.src})`,
                    '--sprite-scale': SPRITE_DISPLAY_HEIGHT / sprite.frameHeight,
                  } as CSSProperties
                }
              />
            )}
            <div>
              <p className="we-popup__eyebrow">Level Up</p>
              <h2 className="we-popup__title">{popup.unitName}</h2>
              <p className="we-popup__sub">
                {popup.className} &middot; Lv. {popup.level}
                {popup.levelsGained > 1 ? ` (+${popup.levelsGained})` : ''}
              </p>
            </div>
          </div>

          <div className="we-popup__stats">
            <span className="we-popup__stat">
              HP <strong>+{gain(LEVEL_GROWTH.maxHp)}</strong>
            </span>
            <span className="we-popup__stat">
              ATK <strong>+{gain(LEVEL_GROWTH.atk)}</strong>
            </span>
            <span className="we-popup__stat">
              DEF <strong>+{gain(LEVEL_GROWTH.def)}</strong>
            </span>
          </div>
        </div>
      </div>
    );
  }

  const multiple = popup.itemNames.length > 1;
  return (
    <div className="we-overlay">
      <div className="we-overlay__card we-popup we-popup--loot" role="dialog" aria-modal="true">
        <p className="we-popup__eyebrow">{multiple ? 'Items found' : 'Item found'}</p>
        <h2 className="we-popup__title">{popup.itemNames.join(', ')}</h2>
        <p className="we-popup__sub">
          Added to your inventory. Equip it now, or carry on and sort your gear later.
        </p>
        <div className="we-overlay__actions">
          <button type="button" className="we-button" onClick={onOpenEquipment}>
            Open equipment
          </button>
          <button type="button" className="we-button we-button--ghost" onClick={onDismiss}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

function SidePanel({
  selected,
  hovered,
  forecast,
  G,
}: {
  selected: Unit | undefined;
  hovered: Unit | undefined;
  forecast: CombatForecast | null;
  G: GameState;
}) {
  const inspected = hovered ?? selected;

  if (!inspected) {
    return (
      <div className="we-panel we-panel--empty">
        Select one of your units to move, attack, or wait.
      </div>
    );
  }

  const cover = terrainAt(G, inspected.x, inspected.y);
  const stats = effectiveStats(inspected);
  const gearAtk = stats.atk - inspected.atk;
  const gearDef = stats.def - inspected.def;
  const gearMove = stats.move - inspected.move;
  const gearRange = stats.range - inspected.range;

  return (
    <div className="we-panel">
      <div className="we-panel__title">
        <strong>{inspected.name}</strong>
        <span>
          Lv. {inspected.level} {inspected.className}
        </span>
      </div>
      <div className="we-panel__hp">
        HP {inspected.hp}/{inspected.maxHp}
      </div>
      <div className="we-panel__exp">
        <div className="we-panel__exp-bar">
          <div
            className="we-panel__exp-fill"
            style={{ width: `${(inspected.exp / EXP_TO_LEVEL) * 100}%` }}
          />
        </div>
        <span>
          {inspected.exp}/{EXP_TO_LEVEL} EXP
        </span>
      </div>
      <dl className="we-stats">
        <div>
          <dt>Atk</dt>
          <dd>
            {inspected.atk}
            {gearAtk !== 0 && <em> {gearAtk > 0 ? '+' : ''}{gearAtk}</em>}
          </dd>
        </div>
        <div>
          <dt>Def</dt>
          <dd>
            {inspected.def}
            {gearDef !== 0 && <em> {gearDef > 0 ? '+' : ''}{gearDef}</em>}
            {cover.defBonus > 0 && <em> +{cover.defBonus}</em>}
          </dd>
        </div>
        <div>
          <dt>Mov</dt>
          <dd>
            {inspected.move}
            {gearMove !== 0 && <em> {gearMove > 0 ? '+' : ''}{gearMove}</em>}
          </dd>
        </div>
        <div>
          <dt>Rng</dt>
          <dd>
            {inspected.range}
            {gearRange !== 0 && <em> {gearRange > 0 ? '+' : ''}{gearRange}</em>}
          </dd>
        </div>
      </dl>
      <div className="we-panel__skill">
        <strong>{SKILLS[inspected.className].name}</strong>
        <span>
          {inspected.skillCooldown > 0
            ? `Ready in ${inspected.skillCooldown} turn${inspected.skillCooldown === 1 ? '' : 's'}`
            : 'Ready'}
        </span>
      </div>

      {forecast && selected && hovered && (
        <div className="we-forecast">
          <div className="we-forecast__row">
            <span>{selected.name} deals</span>
            <strong>{forecast.damageDealt}</strong>
          </div>
          <div className="we-forecast__row">
            <span>{hovered.name} left</span>
            <strong>{forecast.defenderHpAfter}</strong>
          </div>
          <div className="we-forecast__row">
            <span>Counter</span>
            <strong>{forecast.counterDamage ?? '—'}</strong>
          </div>
          {forecast.willKill && <div className="we-forecast__kill">Lethal</div>}
          {forecast.attackerWillDie && <div className="we-forecast__danger">You would die</div>}
        </div>
      )}
    </div>
  );
}
