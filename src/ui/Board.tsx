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
import { forecastCombat, type CombatForecast } from '../game/combat';
import { decideEnemyAction } from '../game/ai';
import { BLESSINGS } from '../game/blessings';
import { EXP_TO_LEVEL } from '../game/classes';
import type { GameOver } from '../game/game';
import './board.css';

/** Pause between CPU actions so the player can follow what happened. */
const ENEMY_ACTION_DELAY = 550;

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
 * either commit to a target or back all the way out via undo.
 */
type Mode = 'move' | 'menu' | 'targeting' | 'confirm';

export function Board({ G, ctx, moves, events, undo }: BoardProps<GameState>) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('move');
  const [pendingTargetId, setPendingTargetId] = useState<string | null>(null);
  const [hoveredTargetId, setHoveredTargetId] = useState<string | null>(null);
  const [showThreat, setShowThreat] = useState(false);

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

  // Drive the CPU one action at a time; each dispatch mutates G and re-runs this.
  useEffect(() => {
    if (ctx.gameover || G.awaitingBlessing || ctx.currentPlayer !== PLAYER_ID.enemy) return;

    const timer = setTimeout(() => {
      const action = decideEnemyAction(G);
      if (!action) {
        events.endTurn?.();
        return;
      }
      if (action.type === 'move') moves.moveUnit(action.unitId, action.x, action.y);
      else if (action.type === 'attack') moves.attackUnit(action.attackerId, action.targetId);
      else moves.waitUnit(action.unitId);
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

    // 'menu' and 'confirm' modes are driven entirely by the floating panel.
  }

  function handleAttackPressed() {
    setMode('targeting');
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

  function handleConfirmAttack() {
    if (!selected || !pendingTargetId) return;
    moves.attackUnit(selected.id, pendingTargetId);
    clearSelection();
  }

  const gameover = ctx.gameover as GameOver | undefined;

  return (
    <div className="we-app">
      <header className="we-header">
        <div>
          <h1>{G.chapterName}</h1>
          <p className="we-objective">{G.objective}</p>
        </div>
        <div className="we-header-actions">
          <span className="we-wave-badge">Wave {G.wave}</span>
          <button
            type="button"
            className="we-iconbutton"
            aria-pressed={showThreat}
            title={`${showThreat ? 'Hide' : 'Show'} enemy range`}
            onClick={() => setShowThreat((value) => !value)}
          >
            {showThreat ? 'Hide range' : 'Enemy range'}
          </button>
          {isPlayerPhase && (
            <button
              type="button"
              className="we-iconbutton"
              title="End turn"
              onClick={() => {
                clearSelection();
                events.endTurn?.();
              }}
            >
              End turn
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
              {Object.values(G.units).map((unit) => (
                <div
                  key={unit.id}
                  className="we-unit-slot"
                  style={{
                    transform: `translate(calc((var(--tile) + var(--tile-gap)) * ${unit.x}), calc((var(--tile) + var(--tile-gap)) * ${unit.y}))`,
                  }}
                >
                  <UnitToken unit={unit} />
                </div>
              ))}
            </div>

            {selected && (mode === 'menu' || mode === 'confirm') && (
              <ActionPanel
                unit={selected}
                boardWidth={G.width}
                mode={mode}
                canAttack={attackTargets.length > 0}
                forecast={forecast}
                target={previewTarget}
                onAttack={handleAttackPressed}
                onWait={handleWaitPressed}
                onBack={handleBackPressed}
                onCancelConfirm={handleCancelConfirm}
                onConfirmAttack={handleConfirmAttack}
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
  mode,
  canAttack,
  forecast,
  target,
  onAttack,
  onWait,
  onBack,
  onCancelConfirm,
  onConfirmAttack,
}: {
  unit: Unit;
  boardWidth: number;
  mode: 'menu' | 'confirm';
  canAttack: boolean;
  forecast: CombatForecast | null;
  target: Unit | undefined;
  onAttack: () => void;
  onWait: () => void;
  onBack: () => void;
  onCancelConfirm: () => void;
  onConfirmAttack: () => void;
}) {
  const side = unit.x < boardWidth / 2 ? 'right' : 'left';

  return (
    <div
      className={`we-panel-anchor we-panel-anchor--${side}`}
      style={{
        transform: `translate(calc((var(--tile) + var(--tile-gap)) * ${unit.x}), calc((var(--tile) + var(--tile-gap)) * ${unit.y}))`,
      }}
    >
      {mode === 'menu' && (
        <div className="we-menu">
          {canAttack && (
            <button type="button" className="we-menu__item" onClick={onAttack}>
              Attack
            </button>
          )}
          <button type="button" className="we-menu__item" onClick={onWait}>
            Wait
          </button>
          <button type="button" className="we-menu__item we-menu__item--back" onClick={onBack}>
            Back
          </button>
        </div>
      )}

      {mode === 'confirm' && forecast && target && (
        <div className="we-menu we-menu--confirm">
          <div className="we-menu__forecast-row">
            <span>{unit.name} deals</span>
            <strong>{forecast.damageDealt}</strong>
          </div>
          <div className="we-menu__forecast-row">
            <span>{target.name} left</span>
            <strong>{forecast.defenderHpAfter}</strong>
          </div>
          <div className="we-menu__forecast-row">
            <span>Counter</span>
            <strong>{forecast.counterDamage ?? '—'}</strong>
          </div>
          {forecast.willKill && <div className="we-menu__kill">Lethal</div>}
          {forecast.attackerWillDie && <div className="we-menu__danger">You would die</div>}
          <button type="button" className="we-menu__item we-menu__item--confirm" onClick={onConfirmAttack}>
            Confirm
          </button>
          <button type="button" className="we-menu__item we-menu__item--back" onClick={onCancelConfirm}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function UnitToken({ unit }: { unit: Unit }) {
  const hpRatio = unit.hp / unit.maxHp;
  const sprite = UNIT_SPRITES[unit.className];

  const classes = [
    'we-unit',
    `we-unit--${unit.team}`,
    unit.hasActed ? 'we-unit--spent' : '',
    sprite ? '' : 'we-unit--glyph',
  ].filter(Boolean);

  return (
    <div className={classes.join(' ')}>
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
      <span className="we-unit__hp">
        <span className="we-unit__hp-fill" style={{ width: `${hpRatio * 100}%` }} />
      </span>
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
          <dd>{inspected.atk}</dd>
        </div>
        <div>
          <dt>Def</dt>
          <dd>
            {inspected.def}
            {cover.defBonus > 0 && <em> +{cover.defBonus}</em>}
          </dd>
        </div>
        <div>
          <dt>Mov</dt>
          <dd>{inspected.move}</dd>
        </div>
        <div>
          <dt>Rng</dt>
          <dd>{inspected.range}</dd>
        </div>
      </dl>
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
