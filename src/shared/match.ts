import { CONFIG } from './config';
import { archerHitboxes, BODY, facingOf, type Hitbox, type Zone } from './body';
import { MODES, type ModeDef, type ModeId } from './modes';
import { clampInput, launchVelocity, simulate, type Flight, type Launch, type ShotInput } from './physics';
import { mix, mulberry32 } from './rng';
import { groundY, makeTerrain, type Terrain } from './terrain';

/**
 * The whole match as plain JSON. Pure functions below turn one state into the
 * next; the same code runs in local play, in the bot, and on the server.
 */
export interface PlayerInfo {
  name: string;
  color: string;
}

/** owner === null: stuck in the ground (world coords). Otherwise archer-local coords (+x = forward). */
export interface StuckArrow {
  shooter: number;
  owner: number | null;
  x: number;
  y: number;
  angle: number;
}

export interface LastShot {
  vx: number;
  vy: number;
  wind: number;
}

export interface Balloon {
  x: number;
  y: number;
  r: number;
  color: number;
  alive: boolean;
}

export type Phase = 'aim' | 'roundOver' | 'matchOver';
export type EndReason = 'ko' | 'points' | 'forfeit';

export interface LastEvent {
  kind: 'shot' | 'skip';
  shooter: number;
  zone: Zone | null;
  damage: number;
  points: number;
  killed: boolean;
  /** Balloons popped by this shot. */
  pops: number;
}

export interface MatchState {
  modeId: ModeId;
  windOn: boolean;
  seed: number;
  players: PlayerInfo[];
  /** Who shot first in round 0; rounds alternate from there. */
  matchFirst: number;

  hp: number[];
  roundWins: number[];
  /** Points in the current round (points modes). */
  points: number[];
  /** Shots taken in the current round. */
  shots: number[];

  round: number;
  distance: number;
  terrain: Terrain;
  shotInRound: number;
  turn: number;
  /** Wind for the current shot, relative to the shooter: + is a tailwind. Integer -levels..levels. */
  windLevel: number;

  arrows: StuckArrow[];
  /** Balloons in the current round (Balloons mode). */
  balloons: Balloon[];
  /** Each player's previous shot this round (for the ghost trail). */
  lastShot: (LastShot | null)[];

  phase: Phase;
  roundWinner: number | null;
  matchWinner: number | null;
  endReason: EndReason | null;
  /** Increments on every state change; lets clients detect missed updates. */
  seq: number;
  lastEvent: LastEvent | null;
}

/** The only thing that crosses the network for a shot (besides the resulting state). */
export interface ShotRecord {
  shooter: number;
  vx: number;
  vy: number;
  wind: number;
  seqBefore: number;
}

export const modeOf = (s: MatchState): ModeDef => MODES[s.modeId];

export interface NewMatch {
  seed: number;
  modeId: ModeId;
  windOn: boolean;
  players: PlayerInfo[];
  firstPlayer?: number;
}

export function createMatch(o: NewMatch): MatchState {
  const s: MatchState = {
    modeId: o.modeId,
    windOn: o.windOn,
    seed: o.seed >>> 0,
    players: o.players.map((p) => ({ ...p })),
    matchFirst: o.firstPlayer ?? 0,
    hp: [0, 0],
    roundWins: [0, 0],
    points: [0, 0],
    shots: [0, 0],
    round: 0,
    distance: 0,
    terrain: { x0: 0, step: 1, h: [0, 0] },
    shotInRound: 0,
    turn: 0,
    windLevel: 0,
    arrows: [],
    balloons: [],
    lastShot: [null, null],
    phase: 'aim',
    roundWinner: null,
    matchWinner: null,
    endReason: null,
    seq: 0,
    lastEvent: null,
  };
  setupRound(s);
  return s;
}

function setupRound(s: MatchState): void {
  const rng = mulberry32(mix(s.seed, s.round, 0xa11));
  const { minDistance, maxDistance } = CONFIG.arena;
  s.distance = Math.round((minDistance + rng() * (maxDistance - minDistance)) * 10) / 10;
  s.terrain = makeTerrain(rng, s.distance);
  s.hp = [CONFIG.duel.hp, CONFIG.duel.hp];
  s.points = [0, 0];
  s.shots = [0, 0];
  s.arrows = [];
  s.balloons = makeBalloons(s, rng);
  s.lastShot = [null, null];
  s.shotInRound = 0;
  s.turn = (s.matchFirst + s.round) % 2;
  s.windLevel = windLevelFor(s);
  s.phase = 'aim';
  s.roundWinner = null;
  s.lastEvent = null;
}

/**
 * Balloons come in mirrored pairs (same height, same distance from each archer),
 * plus one in the middle when the count is odd, so neither side gets easier ones.
 */
function makeBalloons(s: MatchState, rng: () => number): Balloon[] {
  const n = modeOf(s).balloons;
  const { radius, minHeight, maxHeight } = CONFIG.balloons;
  const out: Balloon[] = [];
  const q2 = (v: number) => Math.round(v * 100) / 100;
  const ground = (x: number) => groundY(s.terrain, x);
  const ok = (x: number, y: number) => out.every((b) => (b.x - x) * (b.x - x) + (b.y - y) * (b.y - y) > (radius * 3.2) ** 2);
  const d = s.distance;
  if (n % 2 === 1) {
    const x = q2(d / 2);
    out.push({ x, y: q2(ground(x) + minHeight + rng() * (maxHeight - minHeight)), r: radius, color: 0, alive: true });
  }
  for (let tries = 0; out.length < n && tries < 400; tries++) {
    // Somewhere between 20% and 50% of the way across (mirrored to the other half).
    const x = q2(d * (0.2 + rng() * 0.28));
    const y = q2(Math.max(ground(x), ground(d - x)) + minHeight + rng() * (maxHeight - minHeight));
    if (!ok(x, y) || !ok(q2(d - x), y)) continue;
    const color = out.length % 5;
    out.push({ x, y, r: radius, color, alive: true }, { x: q2(d - x), y, r: radius, color: (color + 2) % 5, alive: true });
  }
  return out.slice(0, n);
}

/**
 * Wind fairness: shots come in pairs (one per archer). Both shots of a pair get
 * the SAME wind relative to the shooter, so if you get a 3-strength tailwind,
 * your opponent gets a 3-strength tailwind on their reply. On screen this means
 * the flag flips direction between your turn and theirs.
 */
export function windLevelFor(s: MatchState): number {
  if (!s.windOn) return 0;
  const L = CONFIG.wind.levels;
  const pair = Math.floor(s.shotInRound / 2);
  const r = mulberry32(mix(s.seed, s.round, pair, 0x77))();
  return Math.min(L, Math.floor(r * (2 * L + 1)) - L);
}

/** World-space horizontal wind acceleration for `shooter` at relative `level`. */
export function windAccel(level: number, shooter: number): number {
  return (Math.round((level / CONFIG.wind.levels) * CONFIG.wind.maxAccel * 1000) / 1000) * facingOf(shooter);
}

export const archerX = (s: MatchState, i: number) => (i === 0 ? 0 : s.distance);
export const archerGround = (s: MatchState, i: number) => groundY(s.terrain, archerX(s, i));

export function launchFor(s: MatchState, shooter: number, vx: number, vy: number, wind: number): Launch {
  const f = facingOf(shooter);
  return {
    x: archerX(s, shooter) + BODY.launch.x * f,
    y: archerGround(s, shooter) + BODY.launch.y,
    vx,
    vy,
    wind,
  };
}

/** What a shot from `shooter` can hit: the opponent (and their apple). Your own arrows never hit you. */
export function targetsFor(s: MatchState, shooter: number): Hitbox[] {
  const o = 1 - shooter;
  const mode = modeOf(s);
  const boxes: Hitbox[] = [];
  s.balloons.forEach((b, id) => {
    if (b.alive) boxes.push({ ax: b.x, ay: b.y, bx: b.x, by: b.y, r: b.r, zone: 'balloon', owner: -1, pierce: true, id });
  });
  if (mode.hitArchers) boxes.push(...archerHitboxes(o, archerX(s, o), archerGround(s, o), mode.apple));
  return boxes;
}

export function flightFor(s: MatchState, shooter: number, vx: number, vy: number, wind: number): Flight {
  return simulate(launchFor(s, shooter, vx, vy, wind), s.terrain, targetsFor(s, shooter));
}

/** Turn an aim input into a ShotRecord for the current shooter (no state change). */
export function prepareShot(s: MatchState, input: ShotInput): ShotRecord {
  const v = launchVelocity(clampInput(input), facingOf(s.turn));
  return { shooter: s.turn, vx: v.vx, vy: v.vy, wind: windAccel(s.windLevel, s.turn), seqBefore: s.seq };
}

/** Authoritative resolution of a shot. Returns a new state; `s` is untouched. */
export function applyShot(prev: MatchState, input: ShotInput): { state: MatchState; shot: ShotRecord; flight: Flight } {
  if (prev.phase !== 'aim') throw new Error('not aiming');
  const shot = prepareShot(prev, input);
  const flight = flightFor(prev, shot.shooter, shot.vx, shot.vy, shot.wind);
  const s = structuredClone(prev);
  const shooter = shot.shooter;
  const imp = flight.impact;
  const event: LastEvent = { kind: 'shot', shooter, zone: imp.zone, damage: 0, points: 0, killed: false, pops: 0 };

  const popRule = modeOf(s).zones.balloon;
  for (const pop of flight.pops) {
    s.balloons[pop.id].alive = false;
    event.pops++;
    if (popRule?.points) {
      s.points[shooter] += popRule.points;
      event.points += popRule.points;
    }
  }

  if (imp.kind === 'ground') {
    s.arrows.push({ shooter, owner: null, x: imp.x, y: imp.y, angle: Math.atan2(imp.vy, imp.vx) });
  } else if (imp.kind === 'archer' || imp.kind === 'apple') {
    const owner = imp.owner!;
    const f = facingOf(owner);
    if (imp.kind === 'archer') {
      s.arrows.push({
        shooter,
        owner,
        x: (imp.x - archerX(s, owner)) * f,
        y: imp.y - archerGround(s, owner),
        angle: Math.atan2(imp.vy, imp.vx * f),
      });
    }
    const rule = modeOf(s).zones[imp.zone!];
    if (rule?.damage !== undefined && modeOf(s).usesHp) {
      const dmg = rule.damage === 'kill' ? s.hp[owner] : Math.min(s.hp[owner], rule.damage);
      s.hp[owner] -= dmg;
      event.damage = dmg;
      event.killed = s.hp[owner] <= 0;
    }
    if (rule?.points) {
      s.points[shooter] += rule.points;
      event.points += rule.points;
    }
  }

  s.lastShot[shooter] = { vx: shot.vx, vy: shot.vy, wind: shot.wind };
  s.lastEvent = event;
  finishTurn(s);
  return { state: s, shot, flight };
}

/** Turn timer ran out: the shot is used up, nothing flies. */
export function skipTurn(prev: MatchState): MatchState {
  if (prev.phase !== 'aim') return prev;
  const s = structuredClone(prev);
  s.lastEvent = { kind: 'skip', shooter: s.turn, zone: null, damage: 0, points: 0, killed: false, pops: 0 };
  finishTurn(s);
  return s;
}

function finishTurn(s: MatchState): void {
  const mode = modeOf(s);
  s.shots[s.turn]++;
  s.shotInRound++;
  s.seq++;

  if (mode.usesHp) {
    const dead = s.hp.findIndex((h) => h <= 0);
    if (dead >= 0) return endRound(s, 1 - dead, 'ko');
  }
  const target = mode.pointsToWin;
  if (target !== null) {
    const leader = s.points[0] === s.points[1] ? -1 : s.points[0] > s.points[1] ? 0 : 1;
    const allPopped = mode.balloons > 0 && s.balloons.every((b) => !b.alive);
    if (leader >= 0 && (s.points[leader] >= target || allPopped)) return endRound(s, leader, 'points');
  }
  const n = mode.shotsPerPlayer;
  if (n !== null && s.shots[0] >= n && s.shots[0] === s.shots[1] && s.points[0] !== s.points[1]) {
    return endRound(s, s.points[0] > s.points[1] ? 0 : 1, 'points');
  }
  s.turn = 1 - s.turn;
  s.windLevel = windLevelFor(s);
}

function endRound(s: MatchState, winner: number, reason: EndReason): void {
  s.roundWinner = winner;
  s.roundWins[winner]++;
  if (s.roundWins[winner] >= modeOf(s).roundsToWin) {
    s.phase = 'matchOver';
    s.matchWinner = winner;
    s.endReason = reason;
  } else {
    s.phase = 'roundOver';
  }
}

export function nextRound(prev: MatchState): MatchState {
  if (prev.phase !== 'roundOver') return prev;
  const s = structuredClone(prev);
  s.round++;
  s.seq++;
  setupRound(s);
  return s;
}

export function forfeit(prev: MatchState, loser: number): MatchState {
  if (prev.phase === 'matchOver') return prev;
  const s = structuredClone(prev);
  s.phase = 'matchOver';
  s.matchWinner = 1 - loser;
  s.roundWinner = null;
  s.endReason = 'forfeit';
  s.seq++;
  return s;
}

/** Same players, same mode, fresh seed; the other player shoots first. */
export function rematch(prev: MatchState, seed: number, players = prev.players): MatchState {
  return createMatch({ seed, modeId: prev.modeId, windOn: prev.windOn, players, firstPlayer: 1 - prev.matchFirst });
}
