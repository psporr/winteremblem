/**
 * Campaign story data: chapter framing (intro/outro) and mid-battle beats
 * (`MapEvent`). Kept out of `GameState` entirely — nothing here needs to be
 * deterministic or serialised, since it's presentation, not rules. The UI
 * derives when to fire an event from state that already exists (ctx.turn,
 * G.units, G.width/height), the same way the level-up and loot popups
 * already watch G rather than storing their own flags in it.
 */

import type { ClassName } from './classes';
import type { GameState, Team } from './types';

/** One line of dialogue. Omitting `portraitClass` renders a narrator line with no portrait. */
export interface DialogueLine {
  speaker: string;
  portraitClass?: ClassName;
  /** Which side of the screen the portrait sits on. Defaults to 'left'. */
  side?: 'left' | 'right';
  text: string;
}

export type DialogueScript = DialogueLine[];

/**
 * What can trigger a mid-battle story beat. `turnReached` counts turns
 * per-team (the third time it becomes the enemy's phase, not the third
 * boardgame.io turn overall) since that's what an author actually means by
 * "on enemy turn 2" — counting overall alternating turns would require
 * mentally halving the number for every event.
 */
export type MapEventTrigger =
  | { type: 'turnReached'; team: Team; turn: number }
  | { type: 'unitDefeated'; unitId: string }
  | { type: 'unitReachesTile'; x: number; y: number; team?: Team }
  | { type: 'enemyCountAtMost'; count: number };

export interface MapEvent {
  id: string;
  trigger: MapEventTrigger;
  script: DialogueScript;
}

/**
 * Bookkeeping the UI derives from watching phase handoffs — not part of
 * GameState since it isn't a rule, just a count of how many times each
 * team's phase has begun (1-indexed).
 */
export interface EventContext {
  turnCounts: Record<Team, number>;
}

/** Pure so it's trivial to reason about and test independently of the UI. */
export function isTriggerMet(trigger: MapEventTrigger, G: GameState, ctx: EventContext): boolean {
  switch (trigger.type) {
    case 'turnReached':
      return ctx.turnCounts[trigger.team] >= trigger.turn;
    case 'unitDefeated':
      return !G.units[trigger.unitId];
    case 'unitReachesTile':
      return Object.values(G.units).some(
        (unit) => unit.x === trigger.x && unit.y === trigger.y && (!trigger.team || unit.team === trigger.team),
      );
    case 'enemyCountAtMost':
      return Object.values(G.units).filter((unit) => unit.team === 'enemy').length <= trigger.count;
    default:
      return false;
  }
}
