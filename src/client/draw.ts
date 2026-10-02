import { BODY } from '../shared/body';
import type { StuckArrow } from '../shared/match';

/** All drawing functions here work in world metres with +y up (the camera sets that up). */

export const COLORS = {
  bow: '#5b3a1e',
  string: '#f4ecd8',
  shaft: '#4a3b2c',
  head: '#3b3b4f',
  apple: '#d7263d',
  leaf: '#4f9d45',
};

export const ARROW_LEN = 0.82;
/** How far a stuck arrow's tip is buried in what it hit. */
export const BURY = { ground: 0.16, archer: 0.07 };

export interface ArcherPose {
  /** Bow arm angle (deg, relative to facing). */
  angle: number;
  /** 0..1 how far the string is drawn back. */
  draw: number;
  /** 0..1 kick after release. */
  recoil: number;
  /** 0..1 fall-over progress (0 = standing). */
  fall: number;
  /** 0..1 hit flinch. */
  flinch: number;
  /** Arrow on the string. */
  nocked: boolean;
}

export function idlePose(): ArcherPose {
  return { angle: BODY.idleAngle, draw: 0, recoil: 0, fall: 0, flinch: 0, nocked: false };
}

function line(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number) {
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
}

/** Arrow with its tip at (x, y) pointing along `angle` (radians, world). */
export function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, fletch: string, alpha = 1) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.lineCap = 'round';
  ctx.strokeStyle = COLORS.shaft;
  ctx.lineWidth = 0.032;
  line(ctx, -ARROW_LEN, 0, -0.06, 0);
  // Head
  ctx.fillStyle = COLORS.head;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-0.11, 0.045);
  ctx.lineTo(-0.085, 0);
  ctx.lineTo(-0.11, -0.045);
  ctx.closePath();
  ctx.fill();
  // Fletching
  ctx.fillStyle = fletch;
  for (const s of [1, -1]) {
    ctx.beginPath();
    ctx.moveTo(-ARROW_LEN + 0.02, 0);
    ctx.lineTo(-ARROW_LEN + 0.17, 0);
    ctx.lineTo(-ARROW_LEN + 0.05, 0.075 * s);
    ctx.lineTo(-ARROW_LEN - 0.03, 0.075 * s);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

export function drawApple(ctx: CanvasRenderingContext2D, x: number, y: number, r = BODY.apple.r) {
  ctx.fillStyle = COLORS.apple;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.arc(x - r * 0.35, y + r * 0.3, r * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = COLORS.bow;
  ctx.lineWidth = 0.018;
  ctx.lineCap = 'round';
  line(ctx, x, y + r * 0.8, x + 0.01, y + r * 1.45);
  ctx.fillStyle = COLORS.leaf;
  ctx.beginPath();
  ctx.ellipse(x + 0.045, y + r * 1.35, 0.045, 0.02, 0.5, 0, Math.PI * 2);
  ctx.fill();
}

/** Fall uses a quick ease-out with a little bounce at the end. */
function fallEase(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const e = 1 - Math.pow(1 - t, 3);
  return e + Math.sin(t * Math.PI) * 0.06 * (t > 0.7 ? 1 : 0);
}

export interface ArcherDrawOpts {
  x: number;
  ground: number;
  facing: 1 | -1;
  color: string;
  pose: ArcherPose;
  apple: boolean;
  /** Arrows stuck in this archer (archer-local coords) with their fletching colors. */
  arrows: { a: StuckArrow; color: string }[];
}

export function drawArcher(ctx: CanvasRenderingContext2D, o: ArcherDrawOpts) {
  const { pose } = o;
  ctx.save();
  ctx.translate(o.x, o.ground);
  ctx.scale(o.facing, 1);
  // Fall backwards around the back foot, plus a little flinch lean.
  const fall = fallEase(pose.fall) * (Math.PI / 2 - 0.08);
  const pivot = BODY.footBack.x;
  ctx.translate(pivot, 0);
  ctx.rotate(fall + pose.flinch * 0.18);
  ctx.translate(-pivot, 0);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = o.color;
  ctx.fillStyle = o.color;

  const S = BODY.shoulder;
  const a = ((pose.angle + pose.recoil * 7) * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const px = -dy; // perpendicular (bow limbs)
  const py = dx;
  const hand = { x: S.x + dx * BODY.armLength, y: S.y + dy * BODY.armLength };
  const draw = pose.draw * (1 - pose.recoil);
  const nock = { x: hand.x - dx * (0.12 + draw * 0.36), y: hand.y - dy * (0.12 + draw * 0.36) };
  const bowBend = 0.2 + draw * 0.05;
  const tipA = { x: hand.x - dx * 0.12 + px * 0.4, y: hand.y - dy * 0.12 + py * 0.4 };
  const tipB = { x: hand.x - dx * 0.12 - px * 0.4, y: hand.y - dy * 0.12 - py * 0.4 };

  // Legs
  ctx.lineWidth = BODY.legR * 2;
  line(ctx, BODY.hip.x, BODY.hip.y, BODY.footBack.x, BODY.footBack.y);
  line(ctx, BODY.hip.x, BODY.hip.y, BODY.footFront.x, BODY.footFront.y);
  // Torso
  ctx.lineWidth = BODY.torsoR * 2;
  line(ctx, BODY.hip.x, BODY.hip.y, BODY.neck.x, BODY.neck.y);
  // Head
  ctx.beginPath();
  ctx.arc(BODY.head.x, BODY.head.y, BODY.head.r, 0, Math.PI * 2);
  ctx.fill();

  // Bow
  ctx.strokeStyle = COLORS.bow;
  ctx.lineWidth = 0.045;
  ctx.beginPath();
  ctx.moveTo(tipA.x, tipA.y);
  ctx.quadraticCurveTo(hand.x + dx * bowBend, hand.y + dy * bowBend, tipB.x, tipB.y);
  ctx.stroke();
  // String
  ctx.strokeStyle = COLORS.string;
  ctx.lineWidth = 0.014;
  ctx.beginPath();
  ctx.moveTo(tipA.x, tipA.y);
  ctx.lineTo(nock.x, nock.y);
  ctx.lineTo(tipB.x, tipB.y);
  ctx.stroke();

  // Nocked arrow
  if (pose.nocked) drawArrow(ctx, nock.x + dx * ARROW_LEN, nock.y + dy * ARROW_LEN, a, o.color);

  // Arms (drawn over the bow so the grip reads)
  ctx.strokeStyle = o.color;
  ctx.lineWidth = BODY.armR * 2;
  // Drawing arm: shoulder -> elbow -> string hand
  const elbow = {
    x: S.x + dx * (0.12 - 0.36 * draw) - px * (0.12 - 0.05 * draw),
    y: S.y + dy * (0.12 - 0.36 * draw) - py * (0.12 - 0.05 * draw),
  };
  ctx.beginPath();
  ctx.moveTo(S.x, S.y);
  ctx.lineTo(elbow.x, elbow.y);
  ctx.lineTo(nock.x, nock.y);
  ctx.stroke();
  // Bow arm
  line(ctx, S.x, S.y, hand.x, hand.y);

  // Arrows stuck in this archer
  for (const { a: s, color } of o.arrows) {
    drawArrow(ctx, s.x + Math.cos(s.angle) * BURY.archer, s.y + Math.sin(s.angle) * BURY.archer, s.angle, color);
  }
  ctx.restore();

  if (o.apple && pose.fall === 0) {
    ctx.save();
    ctx.translate(o.x, o.ground);
    ctx.scale(o.facing, 1);
    ctx.rotate(pose.flinch * 0.18);
    drawApple(ctx, BODY.apple.x, BODY.apple.y);
    ctx.restore();
  }
}

/** Wind pennant on a pole. `wind` is -1..1 (world direction and strength). */
export function drawFlag(ctx: CanvasRenderingContext2D, x: number, ground: number, wind: number, time: number) {
  const poleH = 2.6;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#6d6875';
  ctx.lineWidth = 0.06;
  line(ctx, x, ground, x, ground + poleH);
  const s = Math.min(1, Math.abs(wind));
  const dir = wind < 0 ? -1 : 1;
  const top = ground + poleH - 0.03;
  const hgt = 0.42;
  const len = 0.8 + s * 0.35;
  // Calm: hangs down along the pole. Strong: stands straight out.
  const ang = -(1 - s) * 1.35;
  const N = 12;
  const dx = dir * Math.cos(ang);
  const dy = Math.sin(ang);
  // Normal pointing "up" relative to the flag direction.
  let nx = -dy;
  let ny = dx;
  if (ny < 0 || (ny === 0 && nx * dir > 0)) {
    nx = -nx;
    ny = -ny;
  }
  const wave = (t: number) => Math.sin(time * (2 + s * 10) - t * 6) * 0.05 * t * (0.3 + s);
  const center = (t: number) => {
    const along = t * len;
    return { x: x + dx * along, y: top - hgt / 2 + dy * along + wave(t), half: (hgt / 2) * (1 - t) };
  };
  ctx.fillStyle = '#f3a712';
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const c = center(i / N);
    ctx.lineTo(c.x + nx * c.half, c.y + ny * c.half);
  }
  for (let i = N; i >= 0; i--) {
    const c = center(i / N);
    ctx.lineTo(c.x - nx * c.half, c.y - ny * c.half);
  }
  ctx.closePath();
  ctx.fill();
}

export const BALLOON_COLORS = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#9b5de5'];

/** Balloon centered at (x, y) with radius r, string hanging below. */
export function drawBalloon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.strokeStyle = 'rgba(80,80,90,0.6)';
  ctx.lineWidth = 0.02;
  ctx.beginPath();
  ctx.moveTo(x, y - r * 1.15);
  ctx.bezierCurveTo(x + 0.12, y - r * 1.15 - 0.35, x - 0.12, y - r * 1.15 - 0.7, x + 0.03, y - r * 1.15 - 1.0);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - r * 1.12);
  ctx.lineTo(x - 0.06, y - r * 1.12 - 0.08);
  ctx.lineTo(x + 0.06, y - r * 1.12 - 0.08);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 1.15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.ellipse(x - r * 0.38, y + r * 0.4, r * 0.18, r * 0.3, -0.5, 0, Math.PI * 2);
  ctx.fill();
}
