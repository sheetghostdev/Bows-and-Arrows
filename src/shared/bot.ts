import { BODY, facingOf } from './body';
import { CONFIG } from './config';
import { archerGround, archerX, launchFor, modeOf, windAccel, type MatchState } from './match';
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

/** Where the bot (or a test) aims: the head in Duel, the apple in Apple Shot, the nearest balloon in Balloons. */
export function aimPoint(s: MatchState, shooter: number): { x: number; y: number } {
  const o = 1 - shooter;
  const alive = s.balloons.filter((b) => b.alive);
  if (alive.length) {
    const from = archerX(s, shooter);
    const b = alive.reduce((best, c) => (Math.abs(c.x - from) < Math.abs(best.x - from) ? c : best));
    return { x: b.x, y: b.y };
  }
  const p = modeOf(s).apple ? BODY.apple : BODY.head;
  return { x: archerX(s, o) + p.x * facingOf(o), y: archerGround(s, o) + p.y };
}

function gauss(): number {
  return (Math.random() + Math.random() + Math.random() - 1.5) * 1.4;
}

/**
 * The bot picks a comfortable angle, solves for the perfect power, then adds
 * human-ish error that shrinks each shot — like a player adjusting by feel.
 */
export function botShot(s: MatchState, shooter: number, preferredAngle: number): ShotInput {
  const { angleErrorDeg, powerError, learnRate } = CONFIG.bot;
  const target = aimPoint(s, shooter);
  const skill = Math.pow(learnRate, s.shots[shooter]);
  let angle = preferredAngle;
  let power = solvePower(s, shooter, angle, target.x, target.y);
  for (let a = 30; power === null && a <= 85; a += 5) {
    angle = a;
    power = solvePower(s, shooter, angle, target.x, target.y);
  }
  return {
    angle: angle + gauss() * angleErrorDeg * skill,
    power: Math.min(1, (power ?? 1) * (1 + gauss() * powerError * skill)),
  };
}
