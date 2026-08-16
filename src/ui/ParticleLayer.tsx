import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';

/**
 * A hand-rolled impact-particle layer: one canvas stretched over the tile
 * grid, driven by a requestAnimationFrame loop that only runs while there
 * are live particles. This is the one combat effect DOM + CSS genuinely
 * can't do well — everything else the board needs (eased movement, sprite
 * animation, floating numbers) is already CSS.
 */

export type BurstKind = 'damage' | 'heal';
/** 'skill' is a bigger, showier version for active skills — plain attacks stay understated. */
export type BurstVariant = 'normal' | 'skill';

export interface ParticleBurstHandle {
  /** Spawns a burst centred on a board cell, in grid (not pixel) coordinates. */
  burst(gridX: number, gridY: number, kind: BurstKind, variant?: BurstVariant): void;
}

interface Particle {
  /** Position in CSS px within the layer. */
  x: number;
  y: number;
  /** Velocity in px per second. */
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  /** Ring shards ignore gravity so the ring stays a clean circle as it expands. */
  gravity: boolean;
}

const PALETTE: Record<BurstKind, string[]> = {
  damage: ['#ffd479', '#f0616d', '#ffffff'],
  heal: ['#4ad991', '#a7f3d0', '#ffffff'],
};
/** Extra accent colors mixed into a skill burst's scatter, on top of PALETTE. */
const SKILL_ACCENT: Record<BurstKind, string> = {
  damage: '#c792ea',
  heal: '#ffe9a8',
};

const PARTICLES_PER_BURST = 14;
const SKILL_SCATTER_PARTICLES = 36;
/** Evenly spaced shards forming each expanding ring — a skill-only flourish. */
const SKILL_RING_INNER_PARTICLES = 18;
const SKILL_RING_OUTER_PARTICLES = 22;
/** px/s² — enough that shards arc and fall rather than drifting flatly outward. */
const GRAVITY = 260;

export const ParticleLayer = forwardRef<ParticleBurstHandle, { cols: number }>(function ParticleLayer(
  { cols },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const frameRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);

  // Keep the backing store matched to the element's CSS size and the display
  // density, so particles stay crisp on a phone's 2x/3x screen.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const step = useCallback((now: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) {
      frameRef.current = null;
      return;
    }

    // Clamped so a backgrounded tab resuming after seconds doesn't teleport
    // every particle off-screen in a single step.
    const dt = Math.min(0.05, (now - lastFrameRef.current) / 1000);
    lastFrameRef.current = now;

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    const alive: Particle[] = [];
    for (const particle of particlesRef.current) {
      particle.life -= dt;
      if (particle.life <= 0) continue;

      if (particle.gravity) particle.vy += GRAVITY * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;

      const remaining = particle.life / particle.maxLife;
      ctx.globalAlpha = Math.max(0, Math.min(1, remaining));
      ctx.fillStyle = particle.color;
      // Whole-pixel squares rather than circles, to sit naturally against
      // the board's pixel art instead of looking like smooth vector dots.
      const size = Math.max(1, Math.round(particle.size * remaining));
      ctx.fillRect(Math.round(particle.x - size / 2), Math.round(particle.y - size / 2), size, size);

      alive.push(particle);
    }
    ctx.globalAlpha = 1;
    particlesRef.current = alive;

    // Idle to zero cost once the last particle dies, rather than burning a
    // frame callback for the whole battle.
    frameRef.current = alive.length > 0 ? requestAnimationFrame(step) : null;
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      burst(gridX, gridY, kind, variant = 'normal') {
        const canvas = canvasRef.current;
        if (!canvas) return;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        const width = canvas.clientWidth;
        if (!width) return;

        // Tile size is responsive (a CSS clamp), so it's derived from the
        // measured layer width rather than assumed. --tile-gap is a plain
        // px value, so it reads back directly.
        const gap = parseFloat(getComputedStyle(canvas).getPropertyValue('--tile-gap')) || 0;
        const tile = (width - (cols - 1) * gap) / cols;
        const centreX = (tile + gap) * gridX + tile / 2;
        const centreY = (tile + gap) * gridY + tile / 2;

        const colors = variant === 'skill' ? [...PALETTE[kind], SKILL_ACCENT[kind]] : PALETTE[kind];
        const scatterCount = variant === 'skill' ? SKILL_SCATTER_PARTICLES : PARTICLES_PER_BURST;
        // Skill shards run bigger too — not just more of them — so a skill
        // hit reads as heavier debris, not just a denser version of the same
        // spray.
        const sizeBase = variant === 'skill' ? 4 : 3;
        const sizeJitter = variant === 'skill' ? 3 : 2;

        for (let i = 0; i < scatterCount; i += 1) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 50 + Math.random() * 110;
          const maxLife = 0.34 + Math.random() * 0.2;
          particlesRef.current.push({
            x: centreX,
            y: centreY,
            vx: Math.cos(angle) * speed,
            // Biased upward so the burst pops before gravity pulls it down.
            vy: Math.sin(angle) * speed - 40,
            life: maxLife,
            maxLife,
            size: sizeBase + Math.random() * sizeJitter,
            color: colors[Math.floor(Math.random() * colors.length)],
            gravity: true,
          });
        }

        // The skill flourish: two concentric rings of shards launched at even
        // angles and immune to gravity, so it reads as a double magic-circle
        // pulse radiating outward — an inner ring that pops fast and tight,
        // and a slower, farther-reaching outer ring right behind it.
        if (variant === 'skill') {
          for (let i = 0; i < SKILL_RING_INNER_PARTICLES; i += 1) {
            const angle = (i / SKILL_RING_INNER_PARTICLES) * Math.PI * 2;
            const speed = 160 + Math.random() * 30;
            const maxLife = 0.3 + Math.random() * 0.08;
            particlesRef.current.push({
              x: centreX,
              y: centreY,
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed,
              life: maxLife,
              maxLife,
              size: 3,
              color: SKILL_ACCENT[kind],
              gravity: false,
            });
          }
          for (let i = 0; i < SKILL_RING_OUTER_PARTICLES; i += 1) {
            const angle = (i / SKILL_RING_OUTER_PARTICLES) * Math.PI * 2 + Math.PI / SKILL_RING_OUTER_PARTICLES;
            const speed = 260 + Math.random() * 40;
            const maxLife = 0.4 + Math.random() * 0.1;
            particlesRef.current.push({
              x: centreX,
              y: centreY,
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed,
              life: maxLife,
              maxLife,
              size: 3.5,
              color: colors[Math.floor(Math.random() * colors.length)],
              gravity: false,
            });
          }
        }

        if (frameRef.current === null) {
          lastFrameRef.current = performance.now();
          frameRef.current = requestAnimationFrame(step);
        }
      },
    }),
    [cols, step],
  );

  // The canvas is wrapped rather than positioned directly: <canvas> is a
  // replaced element, so an absolutely positioned one with `width: auto`
  // keeps its intrinsic 300x150 instead of stretching to the inset box. A
  // plain div does stretch, and the canvas then fills it at 100%.
  return (
    <div className="we-particles" aria-hidden="true">
      <canvas ref={canvasRef} className="we-particles__canvas" />
    </div>
  );
});
