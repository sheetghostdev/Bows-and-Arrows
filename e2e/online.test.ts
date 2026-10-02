/**
 * Plays real matches over WebSockets against a running server.
 * Start one with `npm run preview` (port 8787), then `npm run e2e`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { aimPoint, solvePower } from '../src/shared/bot';
import { CONFIG } from '../src/shared/config';
import type { RoomView, ServerMsg } from '../src/shared/protocol';

const BASE = process.env.BASE ?? 'ws://localhost:8787';
const open: Client[] = [];

class Client {
  ws: WebSocket;
  room: RoomView | null = null;
  you = -1;
  msgs: ServerMsg[] = [];
  private waiters: (() => void)[] = [];

  constructor(
    public code: string,
    public token: string,
    public name: string,
    public color: string,
  ) {
    this.ws = new WebSocket(`${BASE}/ws/${code}`);
    this.ws.onopen = () => this.send({ t: 'hello', token, name, color });
    this.ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as ServerMsg;
      this.msgs.push(m);
      if (m.t === 'room' || m.t === 'shot') {
        this.room = m.room;
        this.you = m.you;
      }
      this.waiters.splice(0).forEach((w) => w());
    };
    open.push(this);
  }

  send(m: object) {
    this.ws.send(JSON.stringify(m));
  }

  async until(pred: (c: Client) => boolean, ms = 10_000): Promise<void> {
    const end = Date.now() + ms;
    const safe = () => {
      try {
        return pred(this);
      } catch {
        return false;
      }
    };
    while (!safe()) {
      if (Date.now() > end) throw new Error(`timeout waiting; room=${JSON.stringify(this.room?.match?.phase)}`);
      await new Promise<void>((r) => {
        this.waiters.push(r);
        setTimeout(r, 200);
      });
    }
  }

  close() {
    this.ws.close();
  }

  /** Shoot a perfect headshot (or apple) using the shared solver. */
  perfectShot() {
    const m = this.room!.match!;
    const t = aimPoint(m, this.you);
    const power = solvePower(m, this.you, 35, t.x, t.y)!;
    this.send({ t: 'shoot', angle: 35, power, seq: m.seq });
  }
}

const code = () => Math.random().toString(36).slice(2, 10);

afterEach(() => {
  open.splice(0).forEach((c) => c.close());
});

async function lobby(modeId: 'duel' | 'apple' = 'duel', walls: 'off' | 'some' | 'always' = 'off') {
  const room = code();
  const a = new Client(room, 'token-alice-1', 'Alice', '#e4572e');
  await a.until((c) => !!c.room);
  const b = new Client(room, 'token-bob-123', 'Bob', '#e4572e'); // same color on purpose
  await a.until((c) => !!c.room?.seats[1]?.connected);
  await b.until((c) => !!c.room);
  a.send({ t: 'settings', modeId, windOn: true, walls });
  await b.until((c) => c.room?.settings.modeId === modeId && c.room?.settings.walls === walls);
  return { room, a, b };
}

async function started(...cs: Client[]) {
  for (const c of cs) await c.until((x) => !!x.room?.match);
}

describe('online rooms', () => {
  it('seats two players, fixes duplicate colors, rejects a third', async () => {
    const { room, a, b } = await lobby();
    expect(a.you).toBe(0);
    expect(b.you).toBe(1);
    expect(b.room!.seats[1]!.color).not.toBe(b.room!.seats[0]!.color);
    const c = new Client(room, 'token-carol-1', 'Carol', '#2e86ab');
    await c.until((x) => x.msgs.some((m) => m.t === 'error'));
    expect(c.msgs.find((m) => m.t === 'error')).toMatchObject({ code: 'full' });
  });

  it('plays a full best-of-3 duel, then a rematch, with an all-time tally', async () => {
    const { a, b } = await lobby('duel');
    b.send({ t: 'start' }); // guest can't start
    a.send({ t: 'start' });
    await started(a, b);
    const players = [a, b];
    let guard = 0;
    while (a.room!.match!.phase !== 'matchOver' && guard++ < 20) {
      const m = a.room!.match!;
      if (m.phase === 'roundOver') {
        await a.until((c) => c.room!.match!.phase !== 'roundOver', 15_000);
        continue;
      }
      const shooter = players[m.turn];
      // Both clients must be looking at the same turn before anyone shoots
      // (a shot from a stale view is correctly rejected by the server).
      for (const p of players) await p.until((c) => c.room!.match!.seq === m.seq);
      // Out-of-turn shots are ignored.
      players[1 - m.turn].send({ t: 'shoot', angle: 45, power: 0.5, seq: m.seq });
      shooter.perfectShot();
      await a.until((c) => c.room!.match!.seq > m.seq);
      expect(a.msgs.some((x) => x.t === 'shot')).toBe(true);
      expect(a.room!.match!.lastEvent?.zone).toBe('head');
    }
    const end = a.room!.match!;
    expect(end.phase).toBe('matchOver');
    expect(end.roundWins[end.matchWinner!]).toBe(CONFIG.duel.roundsToWin);
    expect(a.room!.tally[end.matchWinner!]).toBe(1);
    // Both clients agree on the final state.
    await b.until((c) => c.room!.match!.phase === 'matchOver');
    expect(JSON.stringify(b.room!.match)).toBe(JSON.stringify(end));

    a.send({ t: 'rematch' });
    await b.until((c) => !!c.room!.seats[0]!.rematch);
    b.send({ t: 'rematch' });
    await a.until((c) => c.room!.match!.phase === 'aim' && c.room!.match!.seed !== end.seed);
    expect(a.room!.match!.turn).toBe(1); // the other player opens the rematch
  });

  it('the host\'s walls setting reaches the match', async () => {
    const { a, b } = await lobby('duel', 'always');
    a.send({ t: 'start' });
    await started(a, b);
    expect(a.room!.match!.walls).toBe('always');
    expect(b.room!.match!.obstacles.length).toBe(1);
  });

  it('apple shot runs through the same server', async () => {
    const { a, b } = await lobby('apple');
    a.send({ t: 'start' });
    await started(a, b);
    expect(a.room!.match!.modeId).toBe('apple');
    a.perfectShot();
    await a.until((c) => c.room!.match!.seq === 1);
    expect(a.room!.match!.points[0]).toBe(CONFIG.apple.applePoints);
  });

  it('pauses on disconnect, resumes on reconnect with the same token', async () => {
    const { room, a, b } = await lobby('duel');
    a.send({ t: 'start' });
    await started(a, b);
    b.close();
    await a.until((c) => c.room!.paused?.seat === 1);
    expect(a.room!.turnDeadline).toBeNull();
    const b2 = new Client(room, 'token-bob-123', 'Bob', '#2e86ab');
    await a.until((c) => c.room!.paused === null && !!c.room!.seats[1]!.connected);
    await b2.until((c) => c.you === 1 && !!c.room?.match);
    expect(a.room!.turnDeadline).not.toBeNull();
  });

  it('forfeits after the grace period', async () => {
    const { a, b } = await lobby('duel');
    a.send({ t: 'start' });
    await started(a, b);
    b.close();
    await a.until((c) => c.room!.match!.phase === 'matchOver', (CONFIG.online.disconnectGraceSeconds + 10) * 1000);
    expect(a.room!.match!.endReason).toBe('forfeit');
    expect(a.room!.match!.matchWinner).toBe(0);
  });

  it('turn timer skips a stalled turn', async () => {
    const { a, b } = await lobby('duel');
    a.send({ t: 'start' });
    await started(a, b);
    const first = a.room!.match!.turn;
    await a.until((c) => c.room!.match!.turn !== first, (CONFIG.online.turnSeconds + 10) * 1000);
    expect(a.room!.match!.lastEvent?.kind).toBe('skip');
  });
});
