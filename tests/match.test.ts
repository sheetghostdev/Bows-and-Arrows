import { describe, expect, it } from 'vitest';
import { aimPoint, solvePower } from '../src/shared/bot';
import { CONFIG } from '../src/shared/config';
import { applyShot, createMatch, flightFor, nextRound, skipTurn, type MatchState } from '../src/shared/match';
import { BODY } from '../src/shared/body';
import type { ShotInput } from '../src/shared/physics';

const players = [{ name: 'A', color: '#f00' }, { name: 'B', color: '#00f' }];

function perfect(s: MatchState, aimY = 0): ShotInput {
  const t = aimPoint(s, s.turn);
  for (const angle of [35, 45, 55, 65, 75, 25, 15]) {
    const power = solvePower(s, s.turn, angle, t.x, t.y + aimY);
    if (power !== null) return { angle, power };
  }
  throw new Error('unreachable target');
}

const miss: ShotInput = { angle: 80, power: 0.25 };

describe('match rules', () => {
  it('is deterministic: same seed + inputs => identical states', () => {
    const run = () => {
      let s = createMatch({ seed: 42, modeId: 'duel', windOn: true, players });
      const inputs = [{ angle: 40, power: 0.7 }, { angle: 30, power: 0.8 }, { angle: 50, power: 0.9 }, miss];
      for (const i of inputs) if (s.phase === 'aim') s = applyShot(s, i).state;
      return JSON.stringify(s);
    };
    expect(run()).toBe(run());
  });

  it('replaying a shot record reproduces the impact exactly', () => {
    const s = createMatch({ seed: 7, modeId: 'duel', windOn: true, players });
    const { shot, flight } = applyShot(s, { angle: 42, power: 0.77 });
    const replay = flightFor(s, shot.shooter, shot.vx, shot.vy, shot.wind);
    expect(replay.impact).toEqual(flight.impact);
    expect(replay.path).toEqual(flight.path);
  });

  it('headshot kills; best of 3 ends the match', () => {
    let s = createMatch({ seed: 3, modeId: 'duel', windOn: false, players });
    const first = s.turn;
    s = applyShot(s, perfect(s)).state;
    expect(s.lastEvent?.zone).toBe('head');
    expect(s.phase).toBe('roundOver');
    expect(s.roundWinner).toBe(first);
    s = nextRound(s);
    expect(s.turn).toBe(1 - first); // first shooter alternates
    // Round 2: the other player misses, first player headshots.
    s = applyShot(s, miss).state;
    s = applyShot(s, perfect(s)).state;
    expect(s.phase).toBe('matchOver');
    expect(s.matchWinner).toBe(first);
    expect(s.roundWins[first]).toBe(2);
  });

  it(`body hits deal ${CONFIG.duel.bodyDamage} damage`, () => {
    let s = createMatch({ seed: 5, modeId: 'duel', windOn: false, players });
    const shooter = s.turn;
    const torsoDrop = BODY.head.y - 1.15; // aim at the chest
    s = applyShot(s, perfect(s, -torsoDrop)).state;
    expect(s.lastEvent?.zone).toBe('body');
    expect(s.hp[1 - shooter]).toBe(CONFIG.duel.hp - CONFIG.duel.bodyDamage);
    expect(s.arrows[0].owner).toBe(1 - shooter);
  });

  it('apple shot scores apples, penalises hits, ends after N shots each', () => {
    let s = createMatch({ seed: 11, modeId: 'apple', windOn: false, players });
    const a = s.turn;
    s = applyShot(s, perfect(s)).state; // a hits apple
    expect(s.lastEvent?.zone).toBe('apple');
    expect(s.points[a]).toBe(CONFIG.apple.applePoints);
    s = applyShot(s, perfect(s, -0.25)).state; // b hits a's head
    expect(s.lastEvent?.zone).toBe('head');
    expect(s.points[1 - a]).toBe(CONFIG.apple.hitPenalty);
    while (s.phase === 'aim') s = skipTurn(s);
    expect(s.phase).toBe('matchOver');
    expect(s.matchWinner).toBe(a);
    expect(s.shots[0]).toBe(CONFIG.apple.shotsPerPlayer);
  });

  it('apple shot ties go to sudden death pairs', () => {
    let s = createMatch({ seed: 12, modeId: 'apple', windOn: false, players });
    for (let i = 0; i < CONFIG.apple.shotsPerPlayer * 2; i++) s = skipTurn(s);
    expect(s.phase).toBe('aim');
    s = applyShot(s, perfect(s)).state;
    expect(s.phase).toBe('aim'); // opponent still gets their reply
    s = skipTurn(s);
    expect(s.phase).toBe('matchOver');
  });
});

describe('balloons mode', () => {
  it('places mirrored balloons so both sides get the same shots', () => {
    for (let seed = 1; seed < 50; seed++) {
      const s = createMatch({ seed, modeId: 'balloons', windOn: true, players });
      expect(s.balloons.length).toBe(CONFIG.balloons.count);
      const key = (x: number, y: number) => `${x.toFixed(2)},${y.toFixed(2)}`;
      const set = new Set(s.balloons.map((b) => key(b.x, b.y)));
      for (const b of s.balloons) expect(set.has(key(Math.round((s.distance - b.x) * 100) / 100, b.y))).toBe(true);
    }
  });

  it('pops balloons for points, arrows pass through archers, first to N wins', () => {
    let s = createMatch({ seed: 21, modeId: 'balloons', windOn: false, players });
    const first = s.turn;
    let guard = 0;
    while (s.phase === 'aim' && guard++ < 40) {
      // Only the first player shoots; the other skips.
      if (s.turn === first) {
        const before = s.points[first];
        s = applyShot(s, perfect(s)).state;
        expect(s.lastEvent!.pops).toBeGreaterThanOrEqual(1);
        expect(s.points[first]).toBe(before + s.lastEvent!.pops);
      } else s = skipTurn(s);
    }
    expect(s.phase).toBe('matchOver');
    expect(s.matchWinner).toBe(first);
    expect(s.points[first]).toBeGreaterThanOrEqual(CONFIG.balloons.pointsToWin);
    // Nobody got shot.
    expect(s.arrows.every((a) => a.owner === null)).toBe(true);
  });

  it('one arrow can pop several balloons in a row', () => {
    const s = createMatch({ seed: 3, modeId: 'balloons', windOn: false, players });
    s.terrain = { x0: -80, step: 5, h: new Array(60).fill(0) };
    s.turn = 0;
    s.balloons = [];
    // Put two balloons right on the path of a known shot.
    const input = { angle: 30, power: 0.7 };
    const path = applyShot(s, input).flight.path;
    const at = (i: number) => ({ x: path[i * 2], y: path[i * 2 + 1], r: 0.32, color: 0, alive: true });
    s.balloons = [at(40), at(80)];
    const r = applyShot(s, input);
    expect(r.flight.pops.map((p) => p.id)).toEqual([0, 1]);
    expect(r.state.points[0]).toBe(2);
    expect(r.state.balloons.every((b) => !b.alive)).toBe(true);
  });
});
