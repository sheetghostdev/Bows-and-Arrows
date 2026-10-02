import { CONFIG } from './config';

/**
 * Ground height is a smoothstep between seeded control points. It uses only
 * + - * / and floor, so every client and the server agree to the bit.
 */
export interface Terrain {
  x0: number;
  step: number;
  h: number[];
}

const MARGIN = 80;

export function makeTerrain(rng: () => number, distance: number): Terrain {
  const { terrainStep: step, terrainAmplitude: amp } = CONFIG.arena;
  const x0 = -MARGIN;
  const n = Math.ceil((distance + 2 * MARGIN) / step) + 1;
  const h: number[] = [];
  for (let i = 0; i < n; i++) h.push(Math.round((rng() * 2 - 1) * amp * 100) / 100);
  return { x0, step, h };
}

export function groundY(t: Terrain, x: number): number {
  const f = (x - t.x0) / t.step;
  const i = Math.floor(f);
  if (i < 0) return t.h[0];
  if (i >= t.h.length - 1) return t.h[t.h.length - 1];
  const s = f - i;
  const e = s * s * (3 - 2 * s);
  return t.h[i] + (t.h[i + 1] - t.h[i]) * e;
}
