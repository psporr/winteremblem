import hitUrl from '../assets/audio/hit.ogg';
import critUrl from '../assets/audio/crit.ogg';
import healUrl from '../assets/audio/heal.ogg';
import levelUpUrl from '../assets/audio/level-up.ogg';
import dropUrl from '../assets/audio/drop.ogg';
import waveClearUrl from '../assets/audio/wave-clear.ogg';
import clickUrl from '../assets/audio/click.ogg';
import confirmUrl from '../assets/audio/confirm.ogg';
import cancelUrl from '../assets/audio/cancel.ogg';
import turnUrl from '../assets/audio/turn.ogg';
import defeatUrl from '../assets/audio/defeat.ogg';

export type SfxId =
  | 'hit'
  | 'crit'
  | 'heal'
  | 'levelUp'
  | 'drop'
  | 'waveClear'
  | 'click'
  | 'confirm'
  | 'cancel'
  | 'turn'
  | 'defeat';

const SFX_SOURCES: Record<SfxId, string> = {
  hit: hitUrl,
  crit: critUrl,
  heal: healUrl,
  levelUp: levelUpUrl,
  drop: dropUrl,
  waveClear: waveClearUrl,
  click: clickUrl,
  confirm: confirmUrl,
  cancel: cancelUrl,
  turn: turnUrl,
  defeat: defeatUrl,
};

/** Overlapping instances of one sound that can play at once — Sword Dance's two hits land close enough together to need this. */
const POOL_SIZE = 3;

const MUTE_KEY = 'we-sfx-muted';
const VOLUME_KEY = 'we-sfx-volume';
const DEFAULT_VOLUME = 0.55;

/**
 * A tiny pooled SFX player, not a general audio engine — this game has no
 * music yet, just short one-shot cues. Each sound gets a small round-robin
 * pool of <audio> elements rather than one shared element, since a single
 * element can't play two overlapping instances of the same clip (replaying
 * it mid-flight just restarts the one that's already playing).
 *
 * Guarded against `Audio` not existing at all: scripts/simulate.ts imports
 * only src/game/*, never this module, but the guard is cheap insurance
 * against a future import from a non-browser context (Node has no Audio).
 */
class SoundManager {
  private pools: Partial<Record<SfxId, HTMLAudioElement[]>> = {};
  private cursors: Partial<Record<SfxId, number>> = {};
  private muted: boolean;
  private volume: number;
  private readonly supported = typeof Audio !== 'undefined';

  constructor() {
    this.muted = this.supported && localStorage.getItem(MUTE_KEY) === '1';
    const stored = this.supported ? Number(localStorage.getItem(VOLUME_KEY)) : NaN;
    this.volume = Number.isFinite(stored) && stored >= 0 && stored <= 1 ? stored : DEFAULT_VOLUME;

    if (!this.supported) return;

    for (const id of Object.keys(SFX_SOURCES) as SfxId[]) {
      const src = SFX_SOURCES[id];
      const pool: HTMLAudioElement[] = [];
      for (let i = 0; i < POOL_SIZE; i += 1) {
        const audio = new Audio(src);
        audio.preload = 'auto';
        audio.volume = this.volume;
        pool.push(audio);
      }
      this.pools[id] = pool;
      this.cursors[id] = 0;
    }
  }

  play(id: SfxId) {
    if (!this.supported || this.muted) return;
    const pool = this.pools[id];
    if (!pool) return;

    const cursor = this.cursors[id] ?? 0;
    const audio = pool[cursor];
    this.cursors[id] = (cursor + 1) % pool.length;

    audio.currentTime = 0;
    audio.volume = this.volume;
    // Rejected until the first user gesture (browser autoplay policy) — not
    // an error, just means nothing plays before the player has clicked
    // anything, which is always true well before combat starts.
    void audio.play().catch(() => {});
  }

  isMuted() {
    return this.muted;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.supported) localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  }

  getVolume() {
    return this.volume;
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.supported) localStorage.setItem(VOLUME_KEY, String(this.volume));
    for (const pool of Object.values(this.pools)) {
      for (const audio of pool ?? []) audio.volume = this.volume;
    }
  }
}

/** One instance for the whole app — sound is global player-preference state, not per-component. */
export const sound = new SoundManager();
