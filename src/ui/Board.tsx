import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { BoardProps } from 'boardgame.io/react';

import type { GameState, TerrainType, Unit } from '../game/types';
import { PLAYER_ID } from '../game/types';
import terrainTileset from '../assets/terrain/toen-terrain.png';
import { UNIT_SPRITES, SPRITE_DISPLAY_HEIGHT } from './unitSprites';
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
import { canCounter, computeDamage, forecastCombat, type CombatForecast } from '../game/combat';
import { decideEnemyAction } from '../game/ai';
import { BLESSINGS } from '../game/blessings';
import { EXP_TO_LEVEL } from '../game/classes';
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
  type SkillDef,
} from '../game/skills';
import type { ItemSlot } from '../game/types';
import type { GameOver } from '../game/game';
import pkg from '../../package.json';
import './board.css';

const GAME_VERSION = pkg.version;

/** Pause between CPU actions so the player can follow what happened. */
const ENEMY_ACTION_DELAY = 550;

/** How long each beat of a player attack's animation holds before the next. */
const COMBAT_BEAT_MS = 500;

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
    /** `kind` picks the color: red for damage, green for a heal. */
    floatingNumber: { value: number; kind: 'damage' | 'heal' } | null;
  }
>;

/** One unit's HP update within a single simultaneous beat. */
interface BeatHit {
  unitId: string;
  hp: number;
  shake?: boolean;
  floatingNumber?: { value: number; kind: 'damage' | 'heal' };
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

  // A brief centered banner at the start of every wave, including the very
  // first one on load. Purely a client-side toast — G.wave already drives
  // the real state, this just announces the change.
  useEffect(() => {
    setWaveBanner(G.wave);
    const timer = window.setTimeout(() => setWaveBanner(null), 1800);
    return () => window.clearTimeout(timer);
  }, [G.wave]);

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

      playBeats({ [attacker.id]: attacker.hp, [target.id]: target.hp }, beats, () => {
        moves.attackUnit(action.attackerId, action.targetId);
      });
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
    setSelectedId(unit.id);
    setMode('move');
    setPendingTargetId(null);
  }

  function confirmDestination(x: number, y: number) {
    if (!selected) return;
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
        setPendingTargetId(clicked.id);
        setMode('confirm');
      }
      // Other taps are ignored here — Cancel in the floating panel backs out.
      return;
    }

    if (mode === 'skill-targeting') {
      if (clicked && skillTargetIds.has(clicked.id)) {
        setPendingTargetId(clicked.id);
        setMode('skill-confirm');
      }
      return;
    }

    // 'menu', 'confirm', and 'skill-confirm' modes are driven entirely by the floating panel.
  }

  function handleAttackPressed() {
    setMode('targeting');
  }

  function handleSkillPressed() {
    setMode('skill-targeting');
  }

  function handleWaitPressed() {
    if (!selected) return;
    moves.waitUnit(selected.id);
    clearSelection();
  }

  function handleBackPressed() {
    undo();
    clearSelection();
  }

  function handleCancelTargeting() {
    setMode('menu');
  }

  function handleCancelConfirm() {
    setPendingTargetId(null);
    setMode('targeting');
  }

  function handleCancelSkillConfirm() {
    setPendingTargetId(null);
    setMode('skill-targeting');
  }

  /**
   * Plays a sequence of simultaneous HP-update beats, seeded from each
   * involved unit's current live HP, then hands control back once the last
   * beat's hold time has elapsed. Shared by player attacks, player skills,
   * and CPU attacks so all three animate the same way — a single beat can
   * update several units at once (Nova hits up to 5 tiles in one beat).
   */
  function playBeats(startingHp: Record<string, number>, beats: BeatHit[][], onComplete: () => void) {
    const initial: CombatAnim = {};
    for (const [unitId, hp] of Object.entries(startingHp)) {
      initial[unitId] = { hp, shaking: false, floatingNumber: null };
    }
    setCombatAnim(initial);

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
                floatingNumber: hit.floatingNumber ?? null,
              };
            }
            return next;
          });
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
          [{ unitId: target.id, hp: hpAfter1, shake: true, floatingNumber: { value: dmg1, kind: 'damage' } }],
        ];
        if (hpAfter1 > 0) {
          const dmg2 = computeDamage(G, unit, { ...target, hp: hpAfter1 });
          const hpAfter2 = Math.max(0, hpAfter1 - dmg2);
          beats.push([{ unitId: target.id, hp: hpAfter2, shake: true, floatingNumber: { value: dmg2, kind: 'damage' } }]);
          if (hpAfter2 > 0 && canCounter(unit, target)) {
            const counterDmg = computeDamage(G, target, unit);
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
          [{ unitId: target.id, hp: hpAfter, shake: true, floatingNumber: { value: dmg, kind: 'damage' } }],
        ];
        if (hpAfter > 0 && canCounter(unit, target)) {
          const counterDmg = computeDamage(G, target, unit);
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
          beats: [[{ unitId: target.id, hp: Math.max(0, target.hp - dmg), shake: true, floatingNumber: { value: dmg, kind: 'damage' } }]],
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
          return { unitId: hitTarget.id, hp: Math.max(0, hitTarget.hp - dmg), shake: true, floatingNumber: { value: dmg, kind: 'damage' } };
        });
        return { startingHp, beats: [beat] };
      }

      case 'rampage': {
        if (!target) return null;
        const dmg = computeDamage(G, unit, target);
        const hpAfter = Math.max(0, target.hp - dmg);
        const beats: BeatHit[][] = [
          [{ unitId: target.id, hp: hpAfter, shake: true, floatingNumber: { value: dmg, kind: 'damage' } }],
        ];
        if (hpAfter > 0 && canCounter(unit, target)) {
          const counterDmg = computeDamage(G, target, unit);
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
    const unitId = selected.id;
    const targetId = pendingTargetId;
    const predicted = skillPredicted;

    if (!predicted) {
      moves.useSkill(unitId, targetId);
      clearSelection();
      return;
    }

    setMode('animating');
    playBeats(predicted.startingHp, predicted.beats, () => {
      moves.useSkill(unitId, targetId);
      clearSelection();
    });
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
    playBeats({ [attackerId]: selected.hp, [targetId]: previewTarget.hp }, beats, () => {
      moves.attackUnit(attackerId, targetId);
      clearSelection();
    });
  }

  const gameover = ctx.gameover as GameOver | undefined;

  return (
    <div className="we-app">
      <header className="we-header">
        <h1>
          Winter Emblem <span className="we-version">v{GAME_VERSION}</span>
        </h1>
        <div className="we-header-actions">
          <button
            type="button"
            className="we-iconbutton we-iconbutton--icon"
            aria-pressed={showThreat}
            aria-label={`${showThreat ? 'Hide' : 'Show'} enemy range`}
            title={`${showThreat ? 'Hide' : 'Show'} enemy range`}
            onClick={() => setShowThreat((value) => !value)}
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
        <div className="we-board-wrap">
          <div
            className="we-board"
            style={
              {
                gridTemplateColumns: `repeat(${G.width}, var(--tile))`,
                '--terrain-src': `url(${terrainTileset})`,
              } as CSSProperties
            }
          >
            {G.tiles.map((row, y) =>
              row.map((terrainType, x) => {
                const key = tileKey(x, y);
                const occupant = unitAt(G, x, y);
                const classes = ['we-tile', `we-tile--${terrainType}`];

                if (reachable.has(key) && !occupant) classes.push('we-tile--move');
                if (mode === 'targeting' && occupant && attackTargetIds.has(occupant.id)) {
                  classes.push('we-tile--attack');
                }
                if (mode === 'skill-targeting' && occupant && skillTargetIds.has(occupant.id)) {
                  classes.push(skillDef?.targetType === 'ally' ? 'we-tile--support' : 'we-tile--attack');
                }
                if (novaBlastTiles.has(key)) classes.push('we-tile--blast');
                if (selected && selected.x === x && selected.y === y) {
                  classes.push('we-tile--selected');
                }
                if (threatTiles.has(key)) classes.push('we-tile--threat');

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

            {/* Positioned separately from the tile grid, keyed by unit id, so
                moving a unit slides its token to the new cell instead of the
                tile-button remount that would otherwise cause an instant jump. */}
            <div className="we-unit-layer">
              {Object.values(G.units).map((unit) => {
                const anim = combatAnim?.[unit.id];
                const hpOverride = anim?.hp;
                const shaking = anim?.shaking ?? false;
                const floatingNumber = anim?.floatingNumber ?? null;

                return (
                  <div
                    key={unit.id}
                    className="we-unit-slot"
                    style={{
                      transform: `translate(calc((var(--tile) + var(--tile-gap)) * ${unit.x}), calc((var(--tile) + var(--tile-gap)) * ${unit.y}))`,
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
          onEquip={(unitId, instanceId) => moves.equipItem(unitId, instanceId)}
          onUnequip={(unitId, slot) => moves.unequipItem(unitId, slot)}
          onClose={() => setInventoryOpen(false)}
        />
      )}

      {waveBanner != null && (
        <div key={waveBanner} className="we-wave-banner" aria-live="polite">
          Wave {waveBanner} Starts
        </div>
      )}

      {G.awaitingBlessing && !gameover && (
        <div className="we-overlay">
          <div className="we-overlay__card we-overlay__card--blessing">
            <h2>Wave {G.wave} cleared!</h2>
            <p>Choose a blessing before Wave {G.wave + 1} begins.</p>
            <div className="we-blessing-list">
              {BLESSINGS.map((blessing) => (
                <button
                  key={blessing.id}
                  type="button"
                  className="we-blessing"
                  onClick={() => moves.chooseBlessing(blessing.id)}
                >
                  <strong>{blessing.name}</strong>
                  <span>{blessing.description}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {gameover && (
        <div className="we-overlay">
          <div className="we-overlay__card">
            <h2>Defeat</h2>
            <p>Your company has been wiped out, having survived {G.wave} wave{G.wave === 1 ? '' : 's'}.</p>
            <button type="button" className="we-button" onClick={() => window.location.reload()}>
              Play again
            </button>
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
          <button type="button" className="we-menu__item" onClick={onAttack}>
            Attack
          </button>
        )}
        {skillLabel && (
          <button type="button" className="we-menu__item" onClick={onSkill}>
            {skillLabel}
          </button>
        )}
        <button type="button" className="we-menu__item" onClick={onWait}>
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
  floatingNumber?: { value: number; kind: 'damage' | 'heal' } | null;
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
            className="we-unit__sprite"
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
        ) : (
          <span className="we-unit__glyph">{unit.name.charAt(0)}</span>
        )}
      </span>
      <span className="we-unit__hp">
        <span className={hpFillClasses.join(' ')} style={{ width: `${hpRatio * 100}%` }} />
      </span>
      {floatingNumber != null && (
        <span
          key={`${floatingNumber.kind}-${floatingNumber.value}`}
          className={`we-unit__float-num we-unit__float-num--${floatingNumber.kind}`}
        >
          {floatingNumber.kind === 'heal' ? '+' : '-'}
          {floatingNumber.value}
        </span>
      )}
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
      <div className="we-panel__terrain">On {cover.name.toLowerCase()}</div>

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
