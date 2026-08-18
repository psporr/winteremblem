/**
 * Campaign save data: persisted to localStorage so progress survives a page
 * reload, not just the in-memory App state continueCampaign already keeps
 * within a session. One slot only — saving overwrites whatever was there,
 * the same as the "always the latest" semantics of a single save file.
 *
 * Scoped to chapter boundaries, same as the carry-over system it wraps:
 * this remembers which chapter to resume and what the squad carried into
 * it, not mid-battle state (unit positions, turn, HP). A save is written
 * automatically every time the player continues to a new chapter — there
 * is no separate manual "save" step, since nothing changes worth saving
 * between one chapter-clear and the next.
 */

import type { CampaignCarryOver } from './maps';

const SAVE_KEY = 'winteremblem:campaign-save';

export interface CampaignSave {
  /** The chapter to resume at. */
  chapterId: string;
  carryOver: CampaignCarryOver;
  /** ISO timestamp, for display only. */
  savedAt: string;
}

/** Null if there's no save, storage is unavailable, or the saved data is corrupt. */
export function loadCampaignSave(): CampaignSave | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CampaignSave;
  } catch {
    return null;
  }
}

export function saveCampaign(save: CampaignSave): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // Storage can be unavailable (private browsing, quota) — losing the
    // save is better than crashing the game over it.
  }
}

export function clearCampaignSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // Same reasoning as saveCampaign — a failed clear isn't worth crashing over.
  }
}
