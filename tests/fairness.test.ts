import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/shared/config';
import { aimPoint, solvePower } from '../src/shared/bot';
import { applyShot, createMatch, type MatchState } from '../src/shared/match';
import type { Obstacle } from '../src/shared/physics';

/** Build a match at an exact distance and wind level for `shooter`. */
function arena(distance: number, windLevel: number, shooter: number, modeId: 'duel' | 'apple' = 'duel'): MatchState {
  const s = createMatch({ seed: 1234, modeId, windOn: true, players: [{ name: 'A', color: '#f00' }, { name: 'B', color: '#00f' }], firstPlayer: shooter });
  s.distance = distance;
  s.terrain = { x0: -80, step: 5, h: new Array(60).fill(0) };
  s.windLevel = windLevel;
  return s;
}

/** Search angles; for each, solve for power and confirm the real sim scores a hit in `zone`. */
function canHit(s: MatchState, shooter: number, zone: 'head' | 'apple'): boolean {
  const t = aimPoint(s, shooter);
  for (let angle = 5; angle <= 87.5; angle += 2.5) {
    const power = solvePower(s, shooter, angle, t.x, t.y);
    if (power === null) continue;
    const { state } = applyShot(s, { angle, power });
    if (state.lastEvent?.zone === zone) return true;
  }
  return false;
}

describe('wind fairness and reachability', () => {
  const L = CONFIG.wind.levels;
  const { minDistance, maxDistance } = CONFIG.arena;
  const distances: number[] = [];
  for (let d = minDistance; d <= maxDistance + 1e-9; d += 1) distances.push(Math.round(d * 10) / 10);
  if (distances[distances.length - 1] !== maxDistance) distances.push(maxDistance);

  for (const shooter of [0, 1]) {
    for (const level of [-L, 0, L]) {
      it(`player ${shooter} can headshot at every distance with wind level ${level}`, () => {
        const failures = distances.filter((d) => !canHit(arena(d, level, shooter), shooter, 'head'));
        expect(failures).toEqual([]);
      });
    }
  }

  // The tallest wall and the tallest house the generator can make, at every distance.
  const W = CONFIG.walls;
  const cap = (d: number) => Math.min(W.maxHeight, W.maxHeightBase + W.maxHeightPerMetre * d);
  const blockers: Record<string, (d: number) => Obstacle> = {
    wall: (d) => ({ kind: 'wall', x: d / 2, w: W.wallWidth, base: -0.2, h: cap(d) + 0.2, roof: 0 }),
    house: (d) => ({ kind: 'house', x: d / 2, w: W.houseWidth[1], base: -0.2, h: W.houseHeight[1] + 0.2, roof: Math.max(0.4, cap(d) - W.houseHeight[1]) }),
  };
  for (const [name, make] of Object.entries(blockers)) {
    for (const level of [-L, L]) {
      it(`a headshot is possible over the tallest ${name} at every distance (wind ${level})`, () => {
        const failures = distances.filter((d) => {
          const s = arena(d, level, 0);
          s.obstacles = [make(d)];
          return !canHit(s, 0, 'head');
        });
        expect(failures).toEqual([]);
      });
    }
  }

  it('apple is reachable at max distance into a full headwind', () => {
    expect(canHit(arena(maxDistance, -L, 0, 'apple'), 0, 'apple')).toBe(true);
    expect(canHit(arena(maxDistance, -L, 1, 'apple'), 1, 'apple')).toBe(true);
  });

  it('both shots of a pair get the same relative wind (world wind flips)', () => {
    for (let seed = 1; seed < 200; seed++) {
      let s = createMatch({ seed, modeId: 'duel', windOn: true, players: [{ name: 'A', color: '' }, { name: 'B', color: '' }] });
      for (let shot = 0; shot < 10 && s.phase === 'aim'; shot++) {
        const level = s.windLevel;
        // Shoot straight up-ish and short so nobody gets hit.
        s = applyShot(s, { angle: 80, power: 0.2 }).state;
        if (shot % 2 === 0) expect(s.windLevel).toBe(level);
      }
    }
  });

  it('wind off means zero wind', () => {
    const s = createMatch({ seed: 9, modeId: 'duel', windOn: false, players: [{ name: 'A', color: '' }, { name: 'B', color: '' }] });
    expect(s.windLevel).toBe(0);
  });
});
