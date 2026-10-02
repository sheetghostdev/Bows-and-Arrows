import { BODY, facingOf, sweepOffset } from '../shared/body';
import { CONFIG } from '../shared/config';
import { archerGround, archerX, flightFor, modeOf, windAccel, type MatchState, type ShotRecord, type Target } from '../shared/match';
import { clampInput, type Flight, type ShotInput } from '../shared/physics';
import { groundY } from '../shared/terrain';
import { sfx } from './audio';
import { Camera } from './camera';
import { ARROW_LEN, BALLOON_COLORS, BURY, drawArcher, drawArrow, drawBalloon, drawBoard, drawFlag, drawMover, drawObstacle, idlePose, type ArcherPose } from './draw';
import { Ragdoll } from './ragdoll';
import { Fx } from './fx';
import { prefs } from './prefs';

/** Whoever feeds the view: local rules, the bot, or the network. */
export interface Driver {
  /** Can someone on this device aim for `player`? */
  controls(player: number): boolean;
  shoot(input: ShotInput): void;
  /** Live aim preview (for the opponent's screen). null = stopped aiming. */
  aim?(input: ShotInput | null): void;
  /** Called once per state when everything has finished animating. */
  idle?(state: MatchState): void;
}

export type ViewEvent = { kind: 'state'; state: MatchState } | { kind: 'shot'; shot: ShotRecord; state: MatchState };

export interface ViewHooks {
  /** The displayed state changed (update the HUD). */
  shown?(state: MatchState): void;
  /** Nothing left to animate for this state. */
  idle?(state: MatchState): void;
}

interface ActiveShot {
  shot: ShotRecord;
  flight: Flight;
  after: MatchState;
  /** Game seconds since release. */
  t: number;
  impacted: boolean;
  /** Real seconds to hold on the impact before returning to the wide view. */
  hold: number;
  slowmo: { from: number; to: number } | null;
  wispTimer: number;
  /** Index of the next target hit to play. */
  popIdx: number;
}

interface Drag {
  id: number;
  sx: number;
  sy: number;
  cx: number;
  cy: number;
  player: number;
  /** Recent pointer positions, so a release can ignore the last-instant twitch. */
  hist: { t: number; x: number; y: number }[];
}

const DT = CONFIG.physics.dt;

export class GameView {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  w = 0;
  h = 0;
  private dpr = 1;

  state: MatchState | null = null;
  driver: Driver | null = null;
  hooks: ViewHooks = {};
  /** False on the menu backdrop. */
  interactive = false;

  private queue: ViewEvent[] = [];
  private active: ActiveShot | null = null;
  private cam = new Camera();
  private fx = new Fx();
  private poses: ArcherPose[] = [idlePose(), idlePose()];
  /** Knocked-out archers become ragdolls until the next round. */
  private ragdolls: (Ragdoll | null)[] = [null, null];
  /** Where the moving target is along its sweep (advances while nobody's arrow is flying). */
  private sweepU = 0;
  private remoteAim: (ShotInput | null)[] = [null, null];
  private drag: Drag | null = null;
  private freeze = 0;
  private fade = 0;
  private time = 0;
  private last = 0;
  private idleSeq = -1;
  private ghost: { key: string; path: number[] } | null = null;
  private lastCreak = 0;
  private apples = [true, true];
  /** Seconds left of the whole-field view at the start of a round. */
  private intro = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', () => this.cancelDrag());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    requestAnimationFrame((t) => this.frame(t));
  }

  private resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    if (this.state) {
      this.aimCamera();
      this.cam.snap();
    }
  }

  // ---------------------------------------------------------------- feeding

  /** Start fresh from a state (no animation). */
  reset(state: MatchState) {
    this.queue = [];
    this.active = null;
    this.drag = null;
    this.remoteAim = [null, null];
    this.idleSeq = -1;
    this.state = null;
    sfx.stopWhoosh();
    this.setState(state);
    this.aimCamera();
    this.cam.snap();
  }

  push(ev: ViewEvent) {
    this.queue.push(ev);
  }

  setDriver(d: Driver | null) {
    this.driver = d;
    this.idleSeq = -1;
  }

  setRemoteAim(player: number, input: ShotInput | null) {
    this.remoteAim[player] = input;
  }

  /** Where the moving target is right now (the bot fires with this, like a player would). */
  get sweepPhase(): number {
    return this.sweepU;
  }

  /** True when the view has caught up with everything it was given. */
  get settled(): boolean {
    return !this.active && this.queue.length === 0;
  }

  private canAim(): boolean {
    const s = this.state;
    return !!(this.interactive && s && s.phase === 'aim' && this.settled && this.intro <= 0 && this.driver?.controls(s.turn));
  }

  private setState(s: MatchState) {
    const prev = this.state;
    this.state = s;
    if (!prev || prev.round !== s.round || prev.seed !== s.seed) {
      this.poses = [idlePose(), idlePose()];
      this.ragdolls = [null, null];
      this.apples = [true, true];
      this.fx.clear();
      this.ghost = null;
      if (prev) this.fade = 1;
      this.intro = CONFIG.feel.introSeconds;
      this.aimCamera();
      this.cam.snap();
    } else if (s.lastEvent?.kind === 'skip' && prev.seq !== s.seq) {
      const p = s.lastEvent.shooter;
      this.fx.text(archerX(s, p), archerGround(s, p) + 2.4, "Time's up", '#b3261e', 24);
    }
    this.hooks.shown?.(s);
  }

  private pump() {
    while (!this.active && this.queue.length) {
      const ev = this.queue.shift()!;
      if (ev.kind === 'state') this.setState(ev.state);
      else this.startShot(ev.shot, ev.state);
    }
    const s = this.state;
    if (s && this.settled && this.idleSeq !== s.seq) {
      this.idleSeq = s.seq;
      this.hooks.idle?.(s);
      this.driver?.idle?.(s);
    }
  }

  private startShot(shot: ShotRecord, after: MatchState) {
    const s = this.state;
    if (!s || s.seq !== shot.seqBefore) {
      // We missed something (e.g. reconnect): jump straight to the result.
      this.setState(after);
      return;
    }
    const flight = flightFor(s, shot.shooter, shot.vx, shot.vy, shot.wind, shot.phase);
    const imp = flight.impact;
    const near = flight.nearest;
    const missed = imp.kind === 'ground' || imp.kind === 'none';
    const w = CONFIG.feel.slowMoWindow;
    const slowmo = missed && near.dist < CONFIG.feel.nearMissDistance ? { from: near.step * DT - w, to: near.step * DT + w } : null;

    const pose = this.poses[shot.shooter];
    pose.recoil = 1;
    pose.nocked = false;
    pose.angle = (Math.atan2(shot.vy, shot.vx * facingOf(shot.shooter)) * 180) / Math.PI;
    this.remoteAim[shot.shooter] = null;
    if (this.driver?.controls(shot.shooter)) prefs.hinted = true;
    sfx.release();
    sfx.startWhoosh();
    this.active = { shot, flight, after, t: 0, impacted: false, hold: 0, slowmo, wispTimer: 0, popIdx: 0 };
  }

  private onImpact(a: ActiveShot) {
    sfx.stopWhoosh();
    const imp = a.flight.impact;
    const ev = a.after.lastEvent;
    const s = a.after;
    const mode = modeOf(s);
    const feel = CONFIG.feel;
    a.hold = feel.impactHoldMs / 1000;

    if (imp.kind === 'wall') {
      // Thunk into stone or plaster: chips and a solid knock.
      const o = s.obstacles[0];
      this.fx.burst(imp.x, imp.y, 12, o?.kind === 'house' ? '#e6cfa6' : '#8a8a98', 2.6);
      this.cam.shake += feel.shakeGround * 1.5;
      sfx.thud();
    } else if (imp.kind === 'ground' || imp.kind === 'none') {
      this.fx.burst(imp.x, imp.y, 10, '#8a6f4d', 2.4);
      this.cam.shake += feel.shakeGround;
      sfx.thud();
    } else if (imp.kind === 'apple' && imp.owner !== null) {
      const o = imp.owner;
      this.apples[o] = false;
      this.fx.burst(imp.x, imp.y, 16, '#d7263d', 3.5);
      this.fx.burst(imp.x, imp.y, 8, '#fff6e0', 3);
      this.fx.text(imp.x, imp.y + 0.5, `+${ev?.points ?? 1}`, '#3fa34d', 34);
      this.cam.shake += feel.shakeBody;
      this.freeze = feel.headshotFreezeMs / 2000;
      sfx.apple();
    } else if (imp.owner !== null) {
      const o = imp.owner;
      const pc = s.players[o].color;
      this.poses[o].flinch = 1;
      this.fx.burst(imp.x, imp.y, 12, pc, 3);
      const head = imp.zone === 'head';
      if (head && mode.usesHp) {
        this.freeze = feel.headshotFreezeMs / 1000;
        this.cam.shake += feel.shakeHeadshot;
        this.fx.text(imp.x, imp.y + 0.55, 'HEADSHOT!', '#ffffff', 40, 1.5);
        sfx.headshot();
      } else {
        this.cam.shake += feel.shakeBody;
        sfx.hit();
        if (ev?.damage) this.fx.text(imp.x, imp.y + 0.5, `-${ev.damage}`, '#ffffff', 30);
        if (ev?.points) this.fx.text(imp.x, imp.y + 0.5, `${ev.points > 0 ? '+' : ''}${ev.points}`, '#b3261e', 34);
      }
      if (ev?.killed) a.hold += 0.9;
    }
    this.setState(a.after);
    if (ev?.killed && imp.owner !== null) {
      const o = imp.owner;
      this.ragdolls[o] = new Ragdoll(
        archerX(s, o),
        archerGround(s, o),
        facingOf(o),
        this.poses[o],
        s.arrows.filter((x) => x.owner === o).map((x) => ({ a: x, color: s.players[x.shooter].color })),
        { x: imp.x, y: imp.y, vx: imp.vx, vy: imp.vy },
        s.terrain,
      );
    }
  }

  /** The moving target this round, if any. */
  private mover(): Target | null {
    return this.state?.targets.find((t) => t.kind === 'mover') ?? null;
  }

  // ---------------------------------------------------------------- input

  private onDown(e: PointerEvent) {
    sfx.unlock();
    if (!this.canAim() || this.drag) return;
    const t = performance.now();
    this.drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY, player: this.state!.turn, hist: [{ t, x: e.clientX, y: e.clientY }] };
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  private onMove(e: PointerEvent) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    d.cx = e.clientX;
    d.cy = e.clientY;
    const now = performance.now();
    d.hist.push({ t: now, x: d.cx, y: d.cy });
    while (d.hist.length > 2 && now - d.hist[0].t > 500) d.hist.shift();
    const input = this.dragInput(d);
    this.driver?.aim?.(input.power >= CONFIG.aim.minPower ? input : null);
    if (Math.abs(input.power - this.lastCreak) > 0.12) {
      this.lastCreak = input.power;
      sfx.creak(input.power);
    }
  }

  private onUp(e: PointerEvent) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    // Fire what was on screen just before the finger lifted, not the twitch of lifting it.
    const cutoff = performance.now() - CONFIG.aim.releaseSettleMs;
    let settled = d.hist[0];
    for (const h of d.hist) if (h.t <= cutoff) settled = h;
    d.cx = settled.x;
    d.cy = settled.y;
    const input = this.dragInput(d);
    this.drag = null;
    this.lastCreak = 0;
    // Moving target: the shot carries where the target was at the moment of release.
    if (this.mover()) input.phase = this.sweepU;
    if (input.power >= CONFIG.aim.minPower && this.canAim()) this.driver?.shoot(input);
    else this.driver?.aim?.(null);
  }

  private cancelDrag() {
    if (!this.drag) return;
    this.drag = null;
    this.driver?.aim?.(null);
  }

  /** Slingshot: pull back from where you touched. Direction = angle, length = power. */
  private dragInput(d: Drag): ShotInput {
    const dx = d.cx - d.sx;
    const dy = d.cy - d.sy;
    const f = facingOf(d.player);
    // Shot goes opposite the pull; screen y is down, world y is up.
    let angle = (Math.atan2(dy, -dx * f) * 180) / Math.PI;
    const { minAngle, maxAngle, dragForFullPower } = CONFIG.aim;
    if (angle > maxAngle || angle < -120) angle = maxAngle;
    else if (angle < minAngle) angle = minAngle;
    const power = Math.min(1, Math.hypot(dx, dy) / (dragForFullPower * Math.min(this.w, this.h)));
    return clampInput({ angle, power });
  }

  // ---------------------------------------------------------------- loop

  private frame(now: number) {
    const rdt = Math.min(0.05, this.last ? (now - this.last) / 1000 : 0);
    this.last = now;
    this.time += rdt;
    let gdt = rdt;
    if (this.freeze > 0) {
      this.freeze -= rdt;
      gdt = 0;
    } else if (this.active && !this.active.impacted && this.active.slowmo) {
      const { from, to } = this.active.slowmo;
      if (this.active.t >= from && this.active.t <= to) gdt *= CONFIG.feel.slowMoScale;
    }
    if (this.intro > 0 && this.settled) this.intro -= rdt;
    if (this.drag && !this.canAim()) this.cancelDrag();
    const m = this.mover();
    if (m && !this.active) this.sweepU = (this.sweepU + rdt * m.speed) % (4 * m.range);
    this.updateShot(gdt, rdt);
    this.updatePoses(rdt);
    for (const r of this.ragdolls) r?.update(gdt);
    this.fx.update(gdt);
    this.fade = Math.max(0, this.fade - rdt * 2.5);
    this.aimCamera();
    this.cam.update(rdt, this.active ? 5 : 2.6);
    this.render();
    this.pump();
    requestAnimationFrame((t) => this.frame(t));
  }

  private tip(a: ActiveShot): { x: number; y: number; vx: number; vy: number } {
    const p = a.flight.path;
    const n = p.length / 2 - 1;
    const f = Math.min(n, a.t / DT);
    const i = Math.min(n - 1, Math.floor(f));
    const k = f - i;
    const x = p[i * 2] + (p[i * 2 + 2] - p[i * 2]) * k;
    const y = p[i * 2 + 1] + (p[i * 2 + 3] - p[i * 2 + 1]) * k;
    return { x, y, vx: (p[i * 2 + 2] - p[i * 2]) / DT, vy: (p[i * 2 + 3] - p[i * 2 + 1]) / DT };
  }

  private updateShot(gdt: number, rdt: number) {
    const a = this.active;
    if (!a) return;
    if (!a.impacted) {
      a.t += gdt;
      if (a.t / DT >= a.flight.impact.step) {
        a.impacted = true;
        this.onImpact(a);
        return;
      }
      while (a.popIdx < a.flight.pops.length && a.flight.pops[a.popIdx].step <= a.t / DT) {
        const pop = a.flight.pops[a.popIdx++];
        const t = this.state?.targets[pop.id];
        if (t) this.targetHit(t, pop.x, pop.y, pop.center);
      }
      const tp = this.tip(a);
      sfx.whoosh(Math.min(1, Math.hypot(tp.vx, tp.vy) / CONFIG.aim.maxSpeed));
      a.wispTimer -= gdt;
      if (a.wispTimer <= 0) {
        a.wispTimer = 0.035;
        const wind = a.shot.wind;
        const sp = Math.hypot(tp.vx, tp.vy) || 1;
        const tx = tp.x - (tp.vx / sp) * ARROW_LEN;
        const ty = tp.y - (tp.vy / sp) * ARROW_LEN;
        this.fx.particles.push({
          x: tx,
          y: ty + (Math.random() - 0.5) * 0.1,
          vx: wind * 1.6 + (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.2,
          life: 0.5,
          max: 0.5,
          size: 0.025,
          color: 'rgba(255,255,255,0.9)',
          gravity: 0,
          streak: true,
        });
      }
    } else {
      a.hold -= rdt;
      if (a.hold <= 0) {
        // The moving target carries on from where it was when the arrow landed.
        const m = this.mover();
        if (m) this.sweepU = (a.shot.phase + a.flight.impact.step * DT * m.speed) % (4 * m.range);
        this.active = null;
      }
    }
  }

  /** Effects for an arrow passing through a field target. */
  private targetHit(t: Target, x: number, y: number, center: number) {
    const s = this.state!;
    const rings = modeOf(s).rings;
    if (t.kind === 'balloon') {
      this.fx.burst(x, y, 18, BALLOON_COLORS[t.color % BALLOON_COLORS.length], 4, { gravity: 3 });
      this.fx.text(x, y + 0.6, '+1', '#3fa34d', 34);
      sfx.pop();
    } else if (t.kind === 'board') {
      this.fx.burst(t.x, t.y, 14, s.players[t.owner].color, 3.5);
      this.fx.burst(t.x, t.y, 10, '#ffffff', 3);
      this.fx.text(t.x, t.y + 0.7, t.stage + 1 >= CONFIG.ladder.stages.length ? 'CLEARED!' : 'Next!', '#3fa34d', 32);
      sfx.apple();
    } else if (rings) {
      const ring = Math.min(rings.length - 1, Math.floor(center / (t.r / rings.length)));
      this.fx.burst(x, y, 14, ring === 0 ? '#ffd166' : '#e4572e', 3.5);
      if (ring === 0) {
        this.fx.text(x, y + 0.9, 'BULLSEYE!', '#ffffff', 38, 1.4);
        this.freeze = CONFIG.feel.headshotFreezeMs / 1000;
        sfx.headshot();
      } else sfx.apple();
      this.fx.text(x, y - 0.55, `+${rings[ring]}`, '#3fa34d', 30);
    }
    this.cam.shake += CONFIG.feel.shakeBody * 0.6;
  }

  /** Moving target's current offset: replaying the flight if one is in the air, otherwise the live sweep. */
  private moverOffset(t: Target): number {
    const a = this.active;
    const sweep = { range: t.range, speed: t.speed, phase: a ? a.shot.phase : this.sweepU };
    return sweepOffset(sweep, a ? Math.min(a.t, a.flight.impact.step * DT) : 0);
  }

  private updatePoses(rdt: number) {
    const s = this.state;
    if (!s) return;
    const k = 1 - Math.exp(-rdt * 18);
    const slow = 1 - Math.exp(-rdt * 3);
    for (const p of [0, 1]) {
      const pose = this.poses[p];
      const aim = this.drag && this.drag.player === p ? this.dragInput(this.drag) : this.remoteAim[p];
      if (aim) {
        pose.angle += (aim.angle - pose.angle) * k;
        pose.draw += (aim.power - pose.draw) * k;
      } else {
        pose.draw += (0 - pose.draw) * k;
        if (pose.recoil <= 0) pose.angle += (BODY.idleAngle - pose.angle) * slow;
      }
      pose.recoil = Math.max(0, pose.recoil - rdt * 3.2);
      pose.flinch = Math.max(0, pose.flinch - rdt * 3);
      pose.nocked = s.phase === 'aim' && s.turn === p && this.settled && !this.ragdolls[p];
    }
  }

  private wideView() {
    const s = this.state!;
    const g = (archerGround(s, 0) + archerGround(s, 1)) / 2;
    const zoom = Math.min(this.w / (s.distance + 6), this.h / 7);
    // Ground near the bottom in landscape; higher up in portrait so the scene isn't lost under the sky.
    const groundAt = this.h > this.w ? 0.62 : 0.8;
    return { x: s.distance / 2, y: g + ((groundAt - 0.5) * this.h) / zoom, zoom };
  }

  /** Close-up on one archer, a quarter of the way in from the screen edge behind them. */
  private closeView(p: number) {
    const s = this.state!;
    const zoom = Math.max(this.wideView().zoom, Math.min((CONFIG.feel.closeUp * this.h) / 1.9, this.w / 8));
    const groundAt = this.h > this.w ? 0.62 : 0.74;
    return {
      x: archerX(s, p) + facingOf(p) * (this.w / zoom) * 0.27,
      y: archerGround(s, p) + ((groundAt - 0.5) * this.h) / zoom,
      zoom,
    };
  }

  /**
   * Round start: the whole field, briefly. Aiming: close-up on the shooter, so you
   * judge the distance by feel. In flight: follow the arrow (zooming out for high
   * lobs so the ground stays in frame), hold on the landing, then pan to the next shooter.
   */
  private aimCamera() {
    const s = this.state;
    if (!s) return;
    const a = this.active;
    if (!a) {
      const down = this.ragdolls.findIndex((r) => r);
      if (this.interactive && s.phase !== 'aim' && down >= 0) {
        // Knockout: stay close on the fallen archer while the result sinks in.
        const v = this.closeView(down);
        this.cam.setTarget(this.ragdolls[down]!.center.x, v.y, v.zoom);
        return;
      }
      const v = !this.interactive || this.intro > 0 || s.phase !== 'aim' ? this.wideView() : this.closeView(s.turn);
      // Aiming up tilts the view up (without losing the archer), so you can see high targets.
      const aim = this.drag && this.drag.player === s.turn ? this.dragInput(this.drag) : this.remoteAim[s.turn];
      if (aim && this.intro <= 0 && s.phase === 'aim') v.y += Math.max(0, Math.sin((aim.angle * Math.PI) / 180)) * CONFIG.feel.aimLift * (this.h / v.zoom);
      this.cam.setTarget(v.x, v.y, v.zoom);
      return;
    }
    const h = this.h;
    const close = this.closeView(a.shot.shooter).zoom;
    // Landed: if the target is fairly close, pull back to show both, so you can see how far off you were.
    const o = 1 - a.shot.shooter;
    const ix = a.flight.impact.x;
    const span = Math.abs(archerX(s, o) - ix) + 5;
    if (a.impacted && modeOf(s).hitArchers && span < 2.2 * (this.w / close)) {
      const zoom = Math.max(this.wideView().zoom, Math.min(close * CONFIG.feel.followZoom, this.w / span));
      const g = Math.min(groundY(s.terrain, ix), archerGround(s, o));
      const groundAt = this.h > this.w ? 0.62 : 0.74;
      this.cam.setTarget((archerX(s, o) + ix) / 2, g + ((groundAt - 0.5) * h) / zoom, zoom);
      return;
    }
    const tp = a.impacted ? { x: a.flight.impact.x, y: a.flight.impact.y, vx: 0, vy: 0 } : this.tip(a);
    const g = groundY(s.terrain, tp.x);
    let zoom = Math.min(close * CONFIG.feel.followZoom, (0.6 * h) / (Math.max(0, tp.y - g) + 1.5));
    zoom = Math.max(zoom, close * 0.3);
    // Ground near the bottom; if the arrow is higher than fits, slide up with it.
    let y = g + (0.3 * h) / zoom;
    const top = y + (0.36 * h) / zoom;
    if (tp.y > top) y += tp.y - top;
    this.cam.setTarget(tp.x + tp.vx * 0.08, y, zoom);
  }

  // ---------------------------------------------------------------- render

  private render() {
    const { ctx, w, h, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#9fd3ec');
    sky.addColorStop(1, '#e8f6fb');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    const s = this.state;
    if (!s) return;

    this.drawBackdrop(s);

    this.cam.apply(ctx, w, h, dpr);
    const left = this.cam.toWorld(0, 0, w, h).x - 2;
    const right = this.cam.toWorld(w, 0, w, h).x + 2;
    const bottom = this.cam.toWorld(0, h, w, h).y - 2;

    this.drawGhost(s);

    // Arrows stuck in the ground or a wall go first, so the ground/wall hides their buried tips.
    for (const a of s.arrows) {
      if (a.owner !== null) continue;
      drawArrow(ctx, a.x + Math.cos(a.angle) * BURY.ground, a.y + Math.sin(a.angle) * BURY.ground, a.angle, s.players[a.shooter].color);
    }
    for (const o of s.obstacles) drawObstacle(ctx, o);

    // Ground
    const step = Math.max(0.25, 6 / this.cam.zoom);
    ctx.beginPath();
    ctx.moveTo(left, bottom);
    for (let x = left; x <= right + step; x += step) ctx.lineTo(x, groundY(s.terrain, x));
    ctx.lineTo(right + step, bottom);
    ctx.closePath();
    ctx.fillStyle = '#8cc56f';
    ctx.fill();
    ctx.strokeStyle = '#74ad59';
    ctx.lineWidth = 0.1;
    ctx.stroke();
    ctx.beginPath();
    for (let x = left; x <= right + step; x += step) ctx.lineTo(x, groundY(s.terrain, x) - 0.9);
    ctx.lineTo(right + step, bottom);
    ctx.lineTo(left, bottom);
    ctx.closePath();
    ctx.fillStyle = '#7db862';
    ctx.fill();

    // Wind flag (shows the wind for the shot being taken right now)
    const windWorld = s.windOn ? windAccel(s.windLevel, s.turn) / CONFIG.wind.maxAccel : 0;
    // One flag just behind each archer, so it's in view during the close-up and never in the line of fire.
    if (s.windOn) {
      const wind = this.active ? this.active.shot.wind / CONFIG.wind.maxAccel : windWorld;
      for (const p of [0, 1]) {
        const fx = archerX(s, p) - facingOf(p) * 1.7;
        drawFlag(ctx, fx, groundY(s.terrain, fx), wind, this.time + p);
      }
    }

    // Archers
    const mode = modeOf(s);
    const a0 = this.active;
    for (const p of [0, 1]) {
      const rag = this.ragdolls[p];
      if (rag) {
        rag.draw(ctx, s.players[p].color);
        continue;
      }
      drawArcher(ctx, {
        x: archerX(s, p),
        ground: archerGround(s, p),
        facing: facingOf(p),
        color: s.players[p].color,
        pose: this.poses[p],
        apple: mode.apple && this.apples[p],
        arrows: s.arrows.filter((a) => a.owner === p).map((a) => ({ a, color: s.players[a.shooter].color })),
      });
    }
    // Field targets. Ones this flight already went through vanish (the moving target just keeps going).
    if (s.targets.length) {
      const hit = new Set<number>();
      if (a0 && !a0.impacted) for (const pop of a0.flight.pops) if (pop.step <= a0.t / DT) hit.add(pop.id);
      s.targets.forEach((t, id) => {
        if (!t.alive || (hit.has(id) && t.kind !== 'mover')) return;
        if (t.kind === 'balloon') drawBalloon(ctx, t.x, t.y + Math.sin(this.time * 1.3 + id * 1.7) * 0.04, t.r, BALLOON_COLORS[t.color % BALLOON_COLORS.length]);
        else if (t.kind === 'board') drawBoard(ctx, t.x, t.y, groundY(s.terrain, t.x), t.r, s.players[t.owner].color);
        else drawMover(ctx, t.x + this.moverOffset(t), t.x, t.y, t.r, t.range);
      });
    }

    // A fresh apple pops back after an apple hit, once the camera returns.
    if (this.settled) this.apples = [true, true];

    // Arrow in flight + trail
    const a = this.active;
    if (a && !a.impacted) {
      const tp = this.tip(a);
      const p = a.flight.path;
      const i = Math.min(p.length / 2 - 1, Math.floor(a.t / DT));
      ctx.lineCap = 'round';
      const N = 28;
      for (let j = Math.max(1, i - N); j <= i; j++) {
        const alpha = 1 - (i - j) / N;
        ctx.strokeStyle = `rgba(255,255,255,${(alpha * 0.55).toFixed(3)})`;
        ctx.lineWidth = 0.05 * alpha + 0.01;
        ctx.beginPath();
        ctx.moveTo(p[j * 2 - 2], p[j * 2 - 1]);
        ctx.lineTo(p[j * 2], p[j * 2 + 1]);
        ctx.stroke();
      }
      drawArrow(ctx, tp.x, tp.y, Math.atan2(tp.vy, tp.vx), s.players[a.shot.shooter].color);
    }

    this.fx.drawWorld(ctx);

    // ---- screen space
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.interactive) this.drawHpAndTurn(s);
    this.drawAimUi(s);
    if (a && !a.impacted) {
      const tp = this.tip(a);
      const dist = Math.abs(tp.x - archerX(s, a.shot.shooter));
      const sp = this.cam.toScreen(tp.x, tp.y, w, h);
      this.label(`${dist.toFixed(1)} m`, sp.x, sp.y - 26, 17, '#2b2d42');
    }
    for (const t of this.fx.texts) {
      const sp = this.cam.toScreen(t.x, t.y, w, h);
      const age = t.max - t.life;
      const pop = age < 0.12 ? 0.6 + (age / 0.12) * 0.5 : 1.1 - Math.min(0.1, (age - 0.12) * 0.5);
      ctx.globalAlpha = Math.min(1, t.life / 0.3);
      this.label(t.text, sp.x, sp.y, t.size * pop, t.color, true);
      ctx.globalAlpha = 1;
    }
    if (this.fade > 0) {
      ctx.fillStyle = `rgba(255,255,255,${(this.fade * 0.85).toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  private label(text: string, x: number, y: number, size: number, color: string, outline = false) {
    const ctx = this.ctx;
    ctx.font = `900 ${Math.round(size)}px ui-rounded, 'Arial Rounded MT Bold', 'Nunito', system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (outline) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(4, size / 5);
      ctx.strokeStyle = '#2b2d42';
      ctx.strokeText(text, x, y);
    } else {
      ctx.lineJoin = 'round';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.strokeText(text, x, y);
    }
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  private drawBackdrop(s: MatchState) {
    const { ctx, w, h } = this;
    const groundScreen = this.cam.toScreen(this.cam.x, (archerGround(s, 0) + archerGround(s, 1)) / 2, w, h).y;
    // Sun
    ctx.fillStyle = 'rgba(255, 244, 200, 0.9)';
    ctx.beginPath();
    ctx.arc(w * 0.82 - this.cam.x * 0.4, h * 0.2, Math.min(w, h) * 0.07, 0, Math.PI * 2);
    ctx.fill();
    // Clouds drift slowly
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    const clouds = [
      [0.1, 0.16, 1],
      [0.45, 0.1, 0.8],
      [0.75, 0.22, 1.2],
      [1.05, 0.13, 0.9],
    ];
    const span = w + 300;
    for (const [cx, cy, sc] of clouds) {
      const x = ((((cx * span - this.cam.x * this.cam.zoom * 0.1 + this.time * 6 * sc) % span) + span) % span) - 150;
      const y = h * cy;
      const r = 26 * sc;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.arc(x + r * 1.1, y + r * 0.2, r * 0.8, 0, Math.PI * 2);
      ctx.arc(x - r * 1.0, y + r * 0.25, r * 0.7, 0, Math.PI * 2);
      ctx.arc(x + r * 0.3, y - r * 0.5, r * 0.75, 0, Math.PI * 2);
      ctx.fill();
    }
    // Two parallax hill layers
    const layers = [
      { p: 0.2, color: '#cfe9d2', rise: 0.2, amp: 0.06, k: 0.006 },
      { p: 0.45, color: '#b4dda8', rise: 0.1, amp: 0.045, k: 0.011 },
    ];
    for (const L of layers) {
      ctx.fillStyle = L.color;
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let sx = 0; sx <= w + 10; sx += 10) {
        const u = sx + this.cam.x * this.cam.zoom * L.p;
        const y = groundScreen - h * L.rise - h * L.amp * (Math.sin(u * L.k) + 0.5 * Math.sin(u * L.k * 2.3 + 1.7));
        ctx.lineTo(sx, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    }
  }

  private drawGhost(s: MatchState) {
    if (s.phase !== 'aim' || !this.settled) return;
    const p = s.turn;
    const last = s.lastShot[p];
    if (!last) return;
    const key = `${s.seed}:${s.round}:${s.seq}:${p}`;
    if (!this.ghost || this.ghost.key !== key) {
      this.ghost = { key, path: flightFor(s, p, last.vx, last.vy, last.wind, last.phase).path };
    }
    const ctx = this.ctx;
    const path = this.ghost.path;
    ctx.save();
    ctx.strokeStyle = s.players[p].color;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 2.5 / this.cam.zoom;
    ctx.setLineDash([10 / this.cam.zoom, 9 / this.cam.zoom]);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(path[0], path[1]);
    for (let i = 2; i < path.length; i += 2) ctx.lineTo(path[i], path[i + 1]);
    ctx.stroke();
    ctx.restore();
  }

  private drawHpAndTurn(s: MatchState) {
    const { ctx, w, h } = this;
    const mode = modeOf(s);
    for (const p of [0, 1]) {
      if (this.ragdolls[p]) continue;
      const head = this.cam.toScreen(archerX(s, p), archerGround(s, p) + (mode.apple ? 2.1 : 1.95), w, h);
      let top = head.y - 10;
      if (mode.usesHp) {
        const bw = 46;
        const frac = Math.max(0, s.hp[p] / CONFIG.duel.hp);
        ctx.fillStyle = 'rgba(43,45,66,0.18)';
        roundRect(ctx, head.x - bw / 2, top - 4, bw, 8, 4);
        ctx.fill();
        if (frac > 0) {
          ctx.fillStyle = s.players[p].color;
          roundRect(ctx, head.x - bw / 2, top - 4, bw * frac, 8, 4);
          ctx.fill();
        }
        top -= 14;
      }
      if (s.phase === 'aim' && s.turn === p && this.settled) {
        const bob = Math.sin(this.time * 6) * 3;
        ctx.fillStyle = s.players[p].color;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(head.x - 10, top - 14 + bob);
        ctx.lineTo(head.x + 10, top - 14 + bob);
        ctx.lineTo(head.x, top - 2 + bob);
        ctx.closePath();
        ctx.stroke();
        ctx.fill();
      }
    }
  }

  private drawAimUi(s: MatchState) {
    const { ctx, w, h } = this;
    const d = this.drag;
    const p = d ? d.player : this.remoteAim.findIndex((x) => x !== null);
    const input = d ? this.dragInput(d) : p >= 0 ? this.remoteAim[p] : null;

    if (input && p >= 0) {
      const f = facingOf(p);
      // Short direction line from the bow (direction only, not a trajectory).
      const ox = archerX(s, p) + BODY.launch.x * f;
      const oy = archerGround(s, p) + BODY.launch.y;
      const rad = (input.angle * Math.PI) / 180;
      const a = this.cam.toScreen(ox, oy, w, h);
      const len = 30 + input.power * 60;
      ctx.strokeStyle = 'rgba(43,45,66,0.45)';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 7]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(a.x + Math.cos(rad) * f * len, a.y - Math.sin(rad) * len);
      ctx.stroke();
      ctx.setLineDash([]);

      // Readout above the archer
      const top = this.cam.toScreen(archerX(s, p), archerGround(s, p) + 2.3, w, h);
      const text = `${input.angle.toFixed(1)}°   ${(input.power * 100).toFixed(1)}%`;
      ctx.font = `900 20px ui-rounded, 'Arial Rounded MT Bold', 'Nunito', system-ui, sans-serif`;
      const tw = ctx.measureText(text).width + 26;
      const bx = Math.min(w - tw / 2 - 8, Math.max(tw / 2 + 8, top.x));
      const by = Math.max(70, top.y - 46);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      roundRect(ctx, bx - tw / 2, by - 19, tw, 38, 19);
      ctx.fill();
      // power bar along the bottom of the pill
      ctx.save();
      roundRect(ctx, bx - tw / 2, by - 19, tw, 38, 19);
      ctx.clip();
      ctx.fillStyle = s.players[p].color;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(bx - tw / 2, by + 13, tw * input.power, 6);
      ctx.restore();
      ctx.fillStyle = '#2b2d42';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, bx, by - 1);
    }

    if (d) {
      // The "rubber band" from where you touched
      ctx.strokeStyle = 'rgba(43,45,66,0.35)';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(d.sx, d.sy);
      ctx.lineTo(d.cx, d.cy);
      ctx.stroke();
      ctx.fillStyle = 'rgba(43,45,66,0.35)';
      ctx.beginPath();
      ctx.arc(d.sx, d.sy, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(d.cx, d.cy, 14, 0, Math.PI * 2);
      ctx.fill();
    }

    // First-launch hint: animated "pull back" finger until the first shot.
    if (!prefs.hinted && !d && this.canAim()) {
      const p0 = s.turn;
      const f = facingOf(p0);
      const base = this.cam.toScreen(archerX(s, p0), archerGround(s, p0) + 1.2, w, h);
      const t = (this.time % 1.8) / 1.8;
      const e = t < 0.7 ? t / 0.7 : 1;
      // The pull can start anywhere; show it toward the middle so it stays on screen.
      const sx = Math.min(w - 40, Math.max(130, base.x + f * Math.min(160, w * 0.25)));
      const fx = sx - f * e * 90;
      const fy = base.y + e * 55;
      ctx.globalAlpha = t < 0.85 ? 1 : 1 - (t - 0.85) / 0.15;
      ctx.strokeStyle = 'rgba(43,45,66,0.35)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(sx, base.y);
      ctx.lineTo(fx, fy);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.strokeStyle = '#2b2d42';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(fx, fy, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = 1;
      this.label('Drag back to aim, release to fire', w / 2, Math.min(h - 40, base.y + 110), Math.min(19, w / 19), '#2b2d42');
    }
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
