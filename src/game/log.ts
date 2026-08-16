import type { GameState } from './types';

const MAX_LOG_ENTRIES = 40;

/** Newest-first battle log, capped in length. Shared so any module can append without importing game.ts. */
export function pushLog(G: GameState, message: string): void {
  G.log.unshift(message);
  if (G.log.length > MAX_LOG_ENTRIES) G.log.length = MAX_LOG_ENTRIES;
}
