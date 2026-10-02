import { BODY, facingOf, sweepOffset } from './body';
import { CONFIG } from './config';
import { archerGround, archerX, launchFor, modeOf, sweepPeriod, windAccel, type MatchState, type Target } from './match';
import { launchVelocity, simulate, type ShotInput } from './physics';

/** Height of a flight path where it crosses x = tx (or -Infinity if it lands first). */
function heightAtX(path: number[], tx: number, facing: number): number {
  for (let i = 2; i < path.length; i += 2) {
    const ax = (path[i - 2] - tx) * facing;
    const bx = (path[i] - tx) * facing;
    if (ax < 0 && bx >= 0) {
      const t = -ax / (bx - ax);
      return path[i - 1] + (path[i + 1] - path[i - 1]) * t;
    }
  }
  return -Infinity;
}

/** Power that makes an arrow at `angle` pass through (tx, ty), or null if out of reach. */
export function solvePower(s: MatchState, shooter: number, angle: number, tx: number, ty: number): number | null {
  const f = facingOf(shooter);
  const wind = windAccel(s.windLevel, shooter);
  const g = (power: number) => {
    const v = launchVelocity({ angle, power }, f);
    const flight = simulate(launchFor(s, shooter, v.vx, v.vy, wind), s.terrain, []);
    return heightAtX(flight.path, tx, f) - ty;
  };
  let lo = 0.02;
  let hi = 1;
  if (g(hi) < 0) return null;
  if (g(lo) > 0) return lo;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (g(mid) < 0) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** The target this shooter should go for: own ladder board, nearest balloon, the moving target; else null. */
export function targetFor(s: MatchState, shooter: number): Target | null {
  const from = archerX(s, shooter);
  const mine = s.targets.filter((t) => t.alive && (t.owner === -1 || t.owner === shooter));
  if (!mine.length) return null;
  return mine.reduce((best, c) => (Math.abs(c.x - from) < Math.abs(best.x - from) ? c : best));
}

/** Where the bot (or a test) aims: a field target if there is one, else the head (Duel) or apple (Apple Shot). */
export function aimPoint(s: MatchState, shooter: number): { x: number; y: number } {
  const o = 1 - shooter;
  const t = targetFor(s, shooter);
  if (t) return { x: t.x, y: t.y };
  const p = modeOf(s).apple ? BODY.apple : BODY.head;
  return { x: archerX(s, o) + p.x * facingOf(o), y: archerGround(s, o) + p.y };
}

/**
 * Power to hit a moving target released at `phase`: aim where it will be when the
 * arrow arrives, re-estimating the flight time a few times.
 */
export function solveLead(s: MatchState, shooter: number, angle: number, phase: number): number | null {
  const t = targetFor(s, shooter);
  if (!t) return null;
  const f = facingOf(shooter);
  const wind = windAccel(s.windLevel, shooter);
  let time = 1;
  let power: number | null = null;
  for (let i = 0; i < 5; i++) {
    const tx = t.x + sweepOffset({ range: t.range, speed: t.speed, phase }, time);
    power = solvePower(s, shooter, angle, tx, t.y);
    if (power === null) return null;
    const v = launchVelocity({ angle, power }, f);
    const path = simulate(launchFor(s, shooter, v.vx, v.vy, wind), s.terrain, []).path;
    let idx = path.length / 2 - 1;
    for (let k = 1; k < path.length / 2; k++) if ((path[k * 2] - tx) * f >= 0) { idx = k; break; }
    time = idx * CONFIG.physics.dt;
  }
  return power;
}

function gauss(): number {
  return (Math.random() + Math.random() + Math.random() - 1.5) * 1.4;
}

/**
 * The bot picks a comfortable angle, solves for the perfect power, then adds
 * human-ish error that shrinks each shot — like a player adjusting by feel.
 */
export function botShot(s: MatchState, shooter: number, preferredAngle: number, releasePhase?: number): ShotInput {
  const { angleErrorDeg, powerError, learnRate } = CONFIG.bot;
  const target = aimPoint(s, shooter);
  const skill = Math.pow(learnRate, s.shots[shooter]);
  const period = sweepPeriod(s);
  const phase = period > 0 ? (releasePhase ?? Math.random() * period) : undefined;
  const solve = (a: number) => (phase !== undefined ? solveLead(s, shooter, a, phase) : solvePower(s, shooter, a, target.x, target.y));
  let angle = preferredAngle;
  let power = solve(angle);
  for (let a = 30; power === null && a <= 85; a += 5) {
    angle = a;
    power = solve(angle);
  }
  return {
    angle: angle + gauss() * angleErrorDeg * skill,
    power: Math.min(1, (power ?? 1) * (1 + gauss() * powerError * skill)),
    phase,
  };
}
