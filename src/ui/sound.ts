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

const MUTE_KEY = 'we-sfx-muted';
const VOLUME_KEY = 'we-sfx-volume';
const DEFAULT_VOLUME = 0.55;

/**
 * Minimum gap before the same cue can retrigger. Nova hits up to five tiles
 * in a single beat, which would otherwise start five identical clips at the
 * same instant — they'd sum to five times the amplitude and clip harshly,
 * rather than sounding like one bigger hit.
 */
const RETRIGGER_MS = 40;

/**
 * Reads the saved volume, falling back to the default when nothing is stored.
 *
 * The absent case has to be rejected *before* coercing: `Number(null)` and
 * `Number('')` are both 0, which is a perfectly valid volume, so a plain
 * `Number(...)` plus a 0..1 range check silently hands every first-time
 * player a muted game rather than the default.
 */
function readStoredVolume(supported: boolean): number {
  if (!supported) return DEFAULT_VOLUME;
  const raw = localStorage.getItem(VOLUME_KEY);
  if (raw === null || raw.trim() === '') return DEFAULT_VOLUME;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : DEFAULT_VOLUME;
}

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Web Audio one-shot SFX player.
 *
 * Deliberately *not* built on <audio> elements. Those are streaming media
 * elements: each one carries its own decode pipeline, `play()` has tens of
 * milliseconds of startup latency, and rewinding with `currentTime = 0`
 * forces a seek on the main thread. A pool of them big enough to overlap
 * cues stalls the main thread badly enough to delay the `setTimeout`s that
 * drive combat beats, which then fire in a catch-up burst and make the
 * animation look fast-forwarded.
 *
 * Web Audio avoids all of it: every clip is decoded once into an
 * AudioBuffer, and each play spins up a throwaway AudioBufferSourceNode
 * that's scheduled on the audio thread. Source nodes are single-use by
 * design and cheap to create, so overlapping cues need no pooling at all.
 */
class SoundManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Decoded and ready to play. */
  private buffers = new Map<SfxId, AudioBuffer>();
  /** Raw undecoded bytes, fetched before any AudioContext exists. */
  private encoded = new Map<SfxId, Promise<ArrayBuffer | null>>();
  /** In-flight decodes, so a cue requested twice before it's ready decodes once. */
  private decoding = new Map<SfxId, Promise<AudioBuffer | null>>();
  private lastPlayedAt = new Map<SfxId, number>();
  private muted: boolean;
  private volume: number;
  private readonly supported: boolean;

  constructor() {
    this.supported = audioContextCtor() !== null;

    this.muted = this.supported && localStorage.getItem(MUTE_KEY) === '1';
    this.volume = readStoredVolume(this.supported);

    // Fetching needs no AudioContext and no user gesture, so the bytes are
    // already in hand by the time the first click creates one.
    if (this.supported) {
      for (const id of Object.keys(SFX_SOURCES) as SfxId[]) {
        this.encoded.set(
          id,
          fetch(SFX_SOURCES[id])
            .then((response) => (response.ok ? response.arrayBuffer() : null))
            .catch(() => null),
        );
      }
    }
  }

  /**
   * Creates the context on first use rather than at construction: Safari
   * only reliably starts a context created during a user gesture, and every
   * caller of `play` is downstream of a click.
   */
  private ensureContext(): AudioContext | null {
    if (!this.supported) return null;

    if (this.ctx) {
      // Browsers suspend the context when a tab is backgrounded.
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    }

    const Ctor = audioContextCtor();
    if (!Ctor) return null;

    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(ctx.destination);

    // Decode everything up front now that a context exists, so only the very
    // first cue can ever wait on a decode.
    for (const id of Object.keys(SFX_SOURCES) as SfxId[]) void this.decode(id, ctx);

    return ctx;
  }

  private decode(id: SfxId, ctx: AudioContext): Promise<AudioBuffer | null> {
    const inFlight = this.decoding.get(id);
    if (inFlight) return inFlight;

    const pending = (this.encoded.get(id) ?? Promise.resolve(null))
      .then((data) => {
        if (!data || data.byteLength === 0) return null;
        // Sliced because decodeAudioData detaches the buffer it's given, and
        // the original is the only copy we hold.
        return ctx.decodeAudioData(data.slice(0));
      })
      .then((buffer) => {
        if (buffer) this.buffers.set(id, buffer);
        return buffer;
      })
      .catch(() => null);

    this.decoding.set(id, pending);
    return pending;
  }

  private start(buffer: AudioBuffer) {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    // Source nodes are one-shot: fire it and let it be collected.
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(master);
    source.start();
  }

  play(id: SfxId) {
    if (!this.supported || this.muted) return;

    const now = performance.now();
    if (now - (this.lastPlayedAt.get(id) ?? Number.NEGATIVE_INFINITY) < RETRIGGER_MS) return;
    this.lastPlayedAt.set(id, now);

    const ctx = this.ensureContext();
    if (!ctx) return;

    const buffer = this.buffers.get(id);
    if (buffer) {
      this.start(buffer);
      return;
    }

    // Only reachable for the first cue of the session, before decoding
    // finished. Re-checks mute in case it was toggled while decoding.
    void this.decode(id, ctx).then((decoded) => {
      if (decoded && !this.muted) this.start(decoded);
    });
  }

  isMuted() {
    return this.muted;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.supported) localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    if (this.master) this.master.gain.value = muted ? 0 : this.volume;
  }

  getVolume() {
    return this.volume;
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.supported) localStorage.setItem(VOLUME_KEY, String(this.volume));
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }
}

/** One instance for the whole app — sound is global player-preference state, not per-component. */
export const sound = new SoundManager();
