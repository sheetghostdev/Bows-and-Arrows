import { BODY } from '../shared/body';
import type { StuckArrow } from '../shared/match';
import { groundY, type Terrain } from '../shared/terrain';
import { BURY, COLORS, drawArrow, type ArcherPose } from './draw';

/**
 * A floppy stick figure for knockouts: Verlet points joined by sticks, knocked
 * over by the arrow that killed it. Purely cosmetic (client-side only).
 */
const HEAD = 0;
const NECK = 1;
const HIP = 2;
const HAND_F = 7;
// head, neck, hip, kneeF, footF, kneeB, footB, bow hand, elbow, string hand
const STICKS: [number, number][] = [
  [HEAD, NECK],
  [NECK, HIP],
  [HIP, 3],
  [3, 4],
  [HIP, 5],
  [5, 6],
  [NECK, HAND_F],
  [NECK, 8],
  [8, 9],
];
/** [a, b, minimum distance]: soft braces that stop the figure folding up. */
const BRACES: [number, number, number][] = [
  [HEAD, HIP, 0.66],
  [HIP, 4, 0.78],
  [HIP, 6, 0.78],
  [NECK, 9, 0.2],
];
const RADII = [BODY.head.r, 0.08, 0.1, 0.07, 0.06, 0.07, 0.06, 0.05, 0.05, 0.05];
const STEP = 1 / 120;
const GRAVITY = 14;

interface Pt {
  x: number;
  y: number;
  px: number;
  py: number;
}

interface Bound {
  a: number;
  b: number;
  t: number;
  n: number;
  ang: number;
  color: string;
}

export class Ragdoll {
  private pts: Pt[];
  private rest: number[];
  private arrows: Bound[] = [];
  private acc = 0;
  private age = 0;

  constructor(
    x: number,
    ground: number,
    facing: 1 | -1,
    pose: ArcherPose,
    stuck: { a: StuckArrow; color: string }[],
    hit: { x: number; y: number; vx: number; vy: number } | null,
    private terrain: Terrain,
  ) {
    const a = (pose.angle * Math.PI) / 180;
    const S = BODY.shoulder;
    const local: [number, number][] = [
      [BODY.head.x, BODY.head.y],
      [0, 1.4],
      [BODY.hip.x, BODY.hip.y],
      [0.09, 0.47],
      [BODY.footFront.x, BODY.footFront.y],
      [-0.07, 0.47],
      [BODY.footBack.x, BODY.footBack.y],
      [S.x + Math.cos(a) * BODY.armLength, S.y + Math.sin(a) * BODY.armLength],
      [0.12, 1.24],
      [0.26, 1.3],
    ];
    this.pts = local.map(([lx, ly]) => {
      const wx = x + lx * facing;
      const wy = ground + ly;
      return { x: wx, y: wy, px: wx, py: wy };
    });
    this.rest = STICKS.map(([i, j]) => Math.hypot(this.pts[i].x - this.pts[j].x, this.pts[i].y - this.pts[j].y));

    // The killing blow: points near the hit get most of the arrow's push, the rest a little, plus a backwards stagger.
    for (const p of this.pts) {
      // Higher points get pushed back more, so it tips over rather than sliding.
      const height = Math.max(0, p.y - ground);
      let vx = -facing * 1.1 * height;
      let vy = 0.5;
      if (hit) {
        const d2 = (p.x - hit.x) ** 2 + (p.y - hit.y) ** 2;
        const w = 0.03 * height + 0.16 * Math.exp(-d2 / 0.1);
        vx += hit.vx * w;
        vy += hit.vy * w * 0.4;
      }
      p.px = p.x - vx * STEP;
      p.py = p.y - vy * STEP;
    }

    // Pin each stuck arrow to the nearest limb so it rides along.
    for (const { a: s, color } of stuck) {
      const ang = facing > 0 ? s.angle : Math.PI - s.angle;
      const tipX = x + s.x * facing + Math.cos(ang) * BURY.archer;
      const tipY = ground + s.y + Math.sin(ang) * BURY.archer;
      let best: Bound | null = null;
      let bestD = Infinity;
      STICKS.forEach(([i, j]) => {
        const A = this.pts[i];
        const B = this.pts[j];
        const dx = B.x - A.x;
        const dy = B.y - A.y;
        const len = Math.hypot(dx, dy) || 1;
        const t = Math.max(0, Math.min(1, ((tipX - A.x) * dx + (tipY - A.y) * dy) / (len * len)));
        const cx = A.x + dx * t;
        const cy = A.y + dy * t;
        const d = Math.hypot(tipX - cx, tipY - cy);
        if (d < bestD) {
          bestD = d;
          const n = ((tipX - cx) * -dy + (tipY - cy) * dx) / len;
          best = { a: i, b: j, t, n, ang: ang - Math.atan2(dy, dx), color };
        }
      });
      if (best) this.arrows.push(best);
    }
  }

  update(dt: number) {
    this.acc += dt;
    this.age += dt;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.step();
    }
  }

  private step() {
    for (const p of this.pts) {
      const vx = (p.x - p.px) * 0.995;
      const vy = (p.y - p.py) * 0.995;
      p.px = p.x;
      p.py = p.y;
      p.x += vx;
      p.y += vy - GRAVITY * STEP * STEP;
    }
    for (let k = 0; k < 8; k++) {
      STICKS.forEach(([i, j], s) => {
        const A = this.pts[i];
        const B = this.pts[j];
        const dx = B.x - A.x;
        const dy = B.y - A.y;
        const d = Math.hypot(dx, dy) || 1e-6;
        const diff = ((d - this.rest[s]) / d) * 0.5;
        A.x += dx * diff;
        A.y += dy * diff;
        B.x -= dx * diff;
        B.y -= dy * diff;
      });
      // Some stiffness so the body topples like a tree before going limp:
      // the spine stays nearly straight and knees can only bend a little.
      for (const [i, j, min] of BRACES) this.keepApart(i, j, min);
      this.pts.forEach((p, i) => {
        const g = groundY(this.terrain, p.x) + RADII[i];
        if (p.y < g) {
          p.y = g;
          // Ground friction
          p.px = p.x - (p.x - p.px) * 0.55;
          if (p.py < p.y) p.py = p.y + (p.y - p.py) * 0.2;
        }
      });
    }
  }

  private keepApart(i: number, j: number, min: number) {
    const A = this.pts[i];
    const B = this.pts[j];
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const d = Math.hypot(dx, dy) || 1e-6;
    if (d >= min) return;
    const push = ((min - d) / d) * 0.5;
    A.x -= dx * push;
    A.y -= dy * push;
    B.x += dx * push;
    B.y += dy * push;
  }

  draw(ctx: CanvasRenderingContext2D, color: string) {
    const p = this.pts;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    const seg = (i: number, j: number, w: number) => {
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(p[i].x, p[i].y);
      ctx.lineTo(p[j].x, p[j].y);
      ctx.stroke();
    };
    seg(HIP, 3, BODY.legR * 2);
    seg(3, 4, BODY.legR * 2);
    seg(HIP, 5, BODY.legR * 2);
    seg(5, 6, BODY.legR * 2);
    seg(NECK, HIP, BODY.torsoR * 2);
    seg(HEAD, NECK, BODY.torsoR * 1.4);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p[HEAD].x, p[HEAD].y, BODY.head.r, 0, Math.PI * 2);
    ctx.fill();

    // Bow still in hand, perpendicular to the arm
    const h = p[HAND_F];
    let dx = h.x - p[NECK].x;
    let dy = h.y - p[NECK].y;
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl;
    dy /= dl;
    const tA = { x: h.x - dx * 0.12 - dy * 0.4, y: h.y - dy * 0.12 + dx * 0.4 };
    const tB = { x: h.x - dx * 0.12 + dy * 0.4, y: h.y - dy * 0.12 - dx * 0.4 };
    ctx.strokeStyle = COLORS.bow;
    ctx.lineWidth = 0.045;
    ctx.beginPath();
    ctx.moveTo(tA.x, tA.y);
    ctx.quadraticCurveTo(h.x + dx * 0.2, h.y + dy * 0.2, tB.x, tB.y);
    ctx.stroke();
    ctx.strokeStyle = COLORS.string;
    ctx.lineWidth = 0.014;
    ctx.beginPath();
    ctx.moveTo(tA.x, tA.y);
    ctx.lineTo(tB.x, tB.y);
    ctx.stroke();

    ctx.strokeStyle = color;
    seg(NECK, HAND_F, BODY.armR * 2);
    seg(NECK, 8, BODY.armR * 2);
    seg(8, 9, BODY.armR * 2);

    for (const b of this.arrows) {
      const A = p[b.a];
      const B = p[b.b];
      const sx = B.x - A.x;
      const sy = B.y - A.y;
      const len = Math.hypot(sx, sy) || 1;
      const ang = Math.atan2(sy, sx) + b.ang;
      const x = A.x + sx * b.t + (-sy / len) * b.n;
      const y = A.y + sy * b.t + (sx / len) * b.n;
      drawArrow(ctx, x, y, ang, b.color);
    }
  }

  /** Where the body ended up (for the camera). */
  get center(): { x: number; y: number } {
    return { x: this.pts[HIP].x, y: this.pts[HIP].y };
  }
}

