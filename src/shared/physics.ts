import { CONFIG } from './config';
import { distToSegment, sweepOffset, type Hitbox, type Zone } from './body';
import { groundY, type Terrain } from './terrain';

/** What a player sends: angle in degrees relative to facing, power 0..1, and (moving target) where it was on release. */
export interface ShotInput {
  angle: number;
  power: number;
  phase?: number;
}

export interface Launch {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Horizontal acceleration from wind (world space, signed). */
  wind: number;
}

export type ImpactKind = 'ground' | 'archer' | 'apple' | 'none';

export interface Impact {
  kind: ImpactKind;
  owner: number | null;
  zone: Zone | null;
  x: number;
  y: number;
  /** Velocity at impact (for the stuck arrow's angle). */
  vx: number;
  vy: number;
  /** Simulation step at which the arrow stopped. */
  step: number;
}

export interface Pop {
  id: number;
  x: number;
  y: number;
  step: number;
  /** Closest the arrow got to the target's centre while passing through (for ring scoring). */
  center: number;
}

export interface Flight {
  /** Tip position at every step, flattened [x0, y0, x1, y1, ...]. */
  path: number[];
  impact: Impact;
  /** Balloons (pierce targets) the arrow went through, in order. */
  pops: Pop[];
  /** Closest miss on an opponent hitbox surface (only meaningful when nothing was hit). */
  nearest: { dist: number; step: number };
}

const q = (v: number, scale: number) => Math.round(v * scale) / scale;

export function clampInput(input: ShotInput): ShotInput {
  const { minAngle, maxAngle } = CONFIG.aim;
  const angle = q(Math.min(maxAngle, Math.max(minAngle, input.angle)), 10);
  const power = q(Math.min(1, Math.max(0, input.power)), 1000);
  const out: ShotInput = { angle, power };
  if (input.phase !== undefined && Number.isFinite(input.phase)) out.phase = q(Math.max(0, input.phase), 100);
  return out;
}

/**
 * Angle/power -> launch velocity. Trig only happens here, and the result is
 * rounded to 1mm/s, so tiny cross-engine differences in Math.cos/sin vanish.
 * The server is still the authority: it sends vx/vy along with every shot.
 */
export function launchVelocity(input: ShotInput, facing: 1 | -1): { vx: number; vy: number } {
  const rad = (input.angle * Math.PI) / 180;
  const speed = input.power * CONFIG.aim.maxSpeed;
  return { vx: q(facing * speed * Math.cos(rad), 1000), vy: q(speed * Math.sin(rad), 1000) };
}

/**
 * Fixed-timestep projectile flight. Only + - * / sqrt after launch: bit-identical everywhere.
 * Collision is tested at `substeps` points along each step so fast arrows can't skip a head.
 * Pierce targets (balloons) are popped and the arrow keeps going.
 */
export function simulate(launch: Launch, terrain: Terrain, targets: Hitbox[]): Flight {
  const hitIds = new Map<number, Pop>();
  const { dt, substeps, gravity, maxFlightSeconds } = CONFIG.physics;
  const maxSteps = Math.ceil(maxFlightSeconds / dt);
  let x = launch.x;
  let y = launch.y;
  let vx = launch.vx;
  let vy = launch.vy;
  const path = [x, y];
  const nearest = { dist: Infinity, step: 0 };
  const pops: Pop[] = [];

  for (let step = 1; step <= maxSteps; step++) {
    vx += launch.wind * dt;
    vy -= gravity * dt;
    const nx = x + vx * dt;
    const ny = y + vy * dt;
    for (let s = 1; s <= substeps; s++) {
      const t = s / substeps;
      const px = x + (nx - x) * t;
      const py = y + (ny - y) * t;
      const time = (step - 1 + t) * dt;
      for (const h of targets) {
        const center = distToSegment(h.move ? px - sweepOffset(h.move, time) : px, py, h);
        const d = center - h.r;
        if (d <= 0 && h.pierce) {
          const id = h.id ?? -1;
          const seen = hitIds.get(id);
          if (seen) seen.center = Math.min(seen.center, center);
          else {
            const pop = { id, x: px, y: py, step, center };
            hitIds.set(id, pop);
            pops.push(pop);
          }
          continue;
        }
        if (d <= 0) {
          path.push(px, py);
          const kind: ImpactKind = h.zone === 'apple' ? 'apple' : 'archer';
          return { path, pops, nearest, impact: { kind, owner: h.owner, zone: h.zone, x: px, y: py, vx, vy, step } };
        }
        if (h.owner >= 0 && d < nearest.dist) {
          nearest.dist = d;
          nearest.step = step;
        }
      }
      if (py <= groundY(terrain, px)) {
        path.push(px, py);
        return { path, pops, nearest, impact: { kind: 'ground', owner: null, zone: null, x: px, y: py, vx, vy, step } };
      }
    }
    x = nx;
    y = ny;
    path.push(x, y);
  }
  return { path, pops, nearest, impact: { kind: 'none', owner: null, zone: null, x, y, vx, vy, step: maxSteps } };
}
