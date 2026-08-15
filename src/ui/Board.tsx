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
import { forecastCombat } from '../game/combat';
import { decideEnemyAction } from '../game/ai';
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

export function Board({ G, ctx, moves, events }: BoardProps<GameState>) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredTargetId, setHoveredTargetId] = useState<string | null>(null);
  const [showThreat, setShowThreat] = useState(false);

  const isPlayerPhase = ctx.currentPlayer === PLAYER_ID.player && !ctx.gameover;
  const selected = selectedId ? G.units[selectedId] : undefined;

  // Selection never survives a phase change.
  useEffect(() => {
    setSelectedId(null);
    setHoveredTargetId(null);
  }, [ctx.currentPlayer]);

  // Drive the CPU one action at a time; each dispatch mutates G and re-runs this.
  useEffect(() => {
    if (ctx.gameover || ctx.currentPlayer !== PLAYER_ID.enemy) return;

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
    () => (selected && isPlayerPhase ? computeReachable(G, selected) : EMPTY_REACHABLE),
    [G, selected, isPlayerPhase],
  );

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

  const hoveredTarget = hoveredTargetId ? G.units[hoveredTargetId] : undefined;
  const forecast =
    selected && hoveredTarget && attackTargetIds.has(hoveredTarget.id)
      ? forecastCombat(G, selected, hoveredTarget)
      : null;

  function handleTileClick(x: number, y: number) {
    if (!isPlayerPhase) return;
    const clicked = unitAt(G, x, y);

    if (selected) {
      if (clicked && attackTargetIds.has(clicked.id)) {
        moves.attackUnit(selected.id, clicked.id);
        setSelectedId(null);
        return;
      }
      if (!selected.hasMoved && !clicked && reachable.has(tileKey(x, y))) {
        moves.moveUnit(selected.id, x, y);
        return;
      }
      // A unit that has already moved is committed: it must attack or wait.
      if (selected.hasMoved) return;
      if (clicked && clicked.team === 'player' && !clicked.hasActed) {
        setSelectedId(clicked.id);
        return;
      }
      setSelectedId(null);
      return;
    }

    if (clicked && clicked.team === 'player' && !clicked.hasActed) {
      setSelectedId(clicked.id);
    }
  }

  const gameover = ctx.gameover as GameOver | undefined;
  const round = Math.ceil(ctx.turn / 2);

  return (
    <div className="we-app">
      <header className="we-header">
        <div>
          <h1>{G.chapterName}</h1>
          <p className="we-objective">{G.objective}</p>
        </div>
        <div className={`we-phase we-phase--${isPlayerPhase ? 'player' : 'enemy'}`}>
          <span className="we-phase__label">
            {ctx.gameover ? 'Battle over' : isPlayerPhase ? 'Player phase' : 'Enemy phase'}
          </span>
          <span className="we-phase__round">Round {round}</span>
        </div>
      </header>

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
                if (occupant && attackTargetIds.has(occupant.id)) classes.push('we-tile--attack');
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
                  >
                    {occupant && <UnitToken unit={occupant} />}
                  </button>
                );
              }),
            )}
          </div>
        </div>

        <aside className="we-sidebar">
          <SidePanel
            selected={selected}
            hovered={hoveredTarget}
            forecast={forecast}
            G={G}
          />

          <div className="we-actions">
            {selected && isPlayerPhase && (
              <button
                type="button"
                className="we-button"
                onClick={() => {
                  moves.waitUnit(selected.id);
                  setSelectedId(null);
                }}
              >
                Wait
              </button>
            )}
            <button
              type="button"
              className="we-button we-button--ghost"
              onClick={() => setShowThreat((value) => !value)}
            >
              {showThreat ? 'Hide' : 'Show'} enemy range
            </button>
            {isPlayerPhase && (
              <button
                type="button"
                className="we-button we-button--ghost"
                onClick={() => {
                  setSelectedId(null);
                  events.endTurn?.();
                }}
              >
                End turn
              </button>
            )}
          </div>

          <ol className="we-log">
            {G.log.map((entry, index) => (
              <li key={`${index}-${entry}`}>{entry}</li>
            ))}
          </ol>
        </aside>
      </div>

      {gameover && (
        <div className="we-overlay">
          <div className="we-overlay__card">
            <h2>{gameover.winner === 'player' ? 'Victory' : 'Defeat'}</h2>
            <p>
              {gameover.winner === 'player'
                ? 'The pass is clear. Your company holds the line.'
                : 'Your company has been wiped out.'}
            </p>
            <button type="button" className="we-button" onClick={() => window.location.reload()}>
              Play again
            </button>
          </div>
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
  forecast: ReturnType<typeof forecastCombat> | null;
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
        <span>{inspected.className}</span>
      </div>
      <div className="we-panel__hp">
        HP {inspected.hp}/{inspected.maxHp}
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
