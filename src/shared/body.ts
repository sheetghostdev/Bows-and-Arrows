/**
 * Stick-man geometry in archer-local space: feet at (0,0), +x = facing direction, +y = up.
 * The renderer draws the idle pose from these same numbers, so what you see is what you hit.
 */
export type Zone = 'head' | 'body' | 'apple';

export const BODY = {
  hip: { x: 0, y: 0.92 },
  neck: { x: 0, y: 1.44 },
  shoulder: { x: 0, y: 1.38 },
  head: { x: 0, y: 1.63, r: 0.15 },
  footFront: { x: 0.17, y: 0.02 },
  footBack: { x: -0.15, y: 0.02 },
  armLength: 0.42,
  /** Bow arm angle when not aiming (degrees, relative to facing). */
  idleAngle: -14,
  /** Bow hand in the idle pose: shoulder + armLength at idleAngle (precomputed, no trig in the sim). */
  idleHand: { x: 0.408, y: 1.278 },
  /** Arrows leave from here (in front of the archer, at shoulder height). */
  launch: { x: 0.5, y: 1.4 },
  apple: { x: 0, y: 1.86, r: 0.085 },
  torsoR: 0.11,
  legR: 0.085,
  armR: 0.06,
} as const;

export interface Hitbox {
  /** Capsule from a to b with radius r (a circle when a == b). */
  ax: number;
  ay: number;
  bx: number;
  by: number;
  r: number;
  zone: Zone;
  owner: number;
}

export const facingOf = (player: number): 1 | -1 => (player === 0 ? 1 : -1);

/** World-space hitboxes for one archer standing at (x, ground) in its idle pose. */
export function archerHitboxes(owner: number, x: number, ground: number, withApple: boolean): Hitbox[] {
  const f = facingOf(owner);
  const P = (lx: number, ly: number) => [x + lx * f, ground + ly] as const;
  const cap = (a: { x: number; y: number }, b: { x: number; y: number }, r: number, zone: Zone): Hitbox => {
    const [ax, ay] = P(a.x, a.y);
    const [bx, by] = P(b.x, b.y);
    return { ax, ay, bx, by, r, zone, owner };
  };
  const boxes: Hitbox[] = [];
  // Apple first: on a tie it's the apple that gets hit.
  if (withApple) boxes.push(cap(BODY.apple, BODY.apple, BODY.apple.r, 'apple'));
  boxes.push(
    cap(BODY.head, BODY.head, BODY.head.r, 'head'),
    cap(BODY.hip, BODY.neck, BODY.torsoR, 'body'),
    cap(BODY.hip, BODY.footFront, BODY.legR, 'body'),
    cap(BODY.hip, BODY.footBack, BODY.legR, 'body'),
    cap(BODY.shoulder, BODY.idleHand, BODY.armR, 'body'),
  );
  return boxes;
}

/** Distance from point p to the capsule's core segment (caller compares it to r). */
export function distToSegment(px: number, py: number, h: Hitbox): number {
  const dx = h.bx - h.ax;
  const dy = h.by - h.ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - h.ax) * dx + (py - h.ay) * dy) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = h.ax + dx * t - px;
  const cy = h.ay + dy * t - py;
  return Math.sqrt(cx * cx + cy * cy);
}
