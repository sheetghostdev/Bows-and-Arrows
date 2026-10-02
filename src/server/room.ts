import { DurableObject } from 'cloudflare:workers';
import { CONFIG, PALETTE } from '../shared/config';
import { applyShot, createMatch, forfeit, nextRound, rematch, skipTurn, type MatchState } from '../shared/match';
import { isModeId, type ModeId } from '../shared/modes';
import { cleanColor, cleanName, type ClientMsg, type RoomView, type ServerMsg } from '../shared/protocol';
import { randomSeed } from '../shared/rng';

export interface Env {
  ROOMS: DurableObjectNamespace<MatchRoom>;
  ASSETS: Fetcher;
}

interface Seat {
  token: string;
  name: string;
  color: string;
  rematch: boolean;
}

interface Stored {
  code: string;
  seats: (Seat | null)[];
  settings: { modeId: ModeId; windOn: boolean };
  match: MatchState | null;
  turnDeadline: number | null;
  nextRoundAt: number | null;
  paused: { seat: number; until: number; turnLeft: number | null; roundLeft: number | null } | null;
  tally: number[];
  lastActive: number;
}

interface Attachment {
  seat: number;
  code: string;
}

const DAY = 24 * 3600 * 1000;
const ROUND_FADE_MS = 1200;

/**
 * One Durable Object per match link. It owns the authoritative match state,
 * runs every shot through the shared rules, keeps the clocks (turn timer,
 * disconnect grace, between-round pause) and persists everything, so a room
 * survives refreshes, reconnects and server restarts.
 */
export class MatchRoom extends DurableObject<Env> {
  private room: Stored | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get<Stored>('room')) ?? null;
    });
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const code = new URL(req.url).pathname.split('/')[2] ?? '';
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ seat: -1, code } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  // ---------------------------------------------------------------- sockets

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data));
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    const att = ws.deserializeAttachment() as Attachment;
    const now = Date.now();

    if (msg.t === 'ping') return this.send(ws, { t: 'pong', now });
    if (msg.t === 'hello') return this.hello(ws, att, msg, now);

    const room = this.room;
    const seat = att.seat;
    if (!room || seat < 0) return;

    switch (msg.t) {
      case 'aim':
        if (room.match?.turn === seat && Number.isFinite(msg.angle) && Number.isFinite(msg.power))
          this.broadcast({ t: 'aim', seat, angle: +msg.angle, power: +msg.power }, seat);
        return;
      case 'aimOff':
        this.broadcast({ t: 'aimOff', seat }, seat);
        return;
      case 'settings':
        if (seat !== 0 || !isModeId(msg.modeId) || (room.match && room.match.phase !== 'matchOver')) return;
        room.settings = { modeId: msg.modeId, windOn: !!msg.windOn };
        break;
      case 'start':
        if (seat !== 0 || room.match || !this.bothHere()) return;
        this.startMatch(createMatch(this.newMatchOpts(0)), now);
        break;
      case 'lobby':
        if (seat !== 0 || !room.match || room.match.phase !== 'matchOver') return;
        room.match = null;
        room.seats.forEach((s) => s && (s.rematch = false));
        break;
      case 'rematch': {
        const m = room.match;
        if (!m || m.phase !== 'matchOver') return;
        room.seats[seat]!.rematch = true;
        if (room.seats.every((s) => s?.rematch)) {
          const players = room.seats.map((s) => ({ name: s!.name, color: s!.color }));
          const next = rematch({ ...m, modeId: room.settings.modeId, windOn: room.settings.windOn }, randomSeed(), players);
          this.startMatch(next, now);
        }
        break;
      }
      case 'shoot':
        if (!this.shoot(seat, msg, now)) this.send(ws, this.roomMsg(seat, now));
        return;
      default:
        return;
    }
    room.lastActive = now;
    await this.persist();
    this.broadcastRoom(now);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      ws.close(code, reason);
    } catch {
      /* already closed */
    }
    await this.leave(ws);
  }

  async webSocketError(ws: WebSocket) {
    await this.leave(ws);
  }

  private async hello(ws: WebSocket, att: Attachment, msg: Extract<ClientMsg, { t: 'hello' }>, now: number) {
    const token = typeof msg.token === 'string' ? msg.token.slice(0, 64) : '';
    if (token.length < 8) return this.send(ws, { t: 'error', code: 'bad', message: 'Bad hello' });
    const room = (this.room ??= {
      code: att.code,
      seats: [null, null],
      settings: { modeId: 'duel', windOn: true },
      match: null,
      turnDeadline: null,
      nextRoundAt: null,
      paused: null,
      tally: [0, 0],
      lastActive: now,
    });

    let seat = room.seats.findIndex((s) => s?.token === token);
    const name = cleanName(msg.name);
    let color = cleanColor(msg.color);
    if (seat < 0) {
      seat = room.seats.findIndex((s) => s === null);
      if (seat < 0) {
        this.send(ws, { t: 'error', code: 'full', message: 'This match already has two players.' });
        ws.close(4001, 'full');
        return;
      }
      room.seats[seat] = { token, name, color, rematch: false };
    }
    // Names/colors can change any time a match isn't running.
    const s = room.seats[seat]!;
    const other = room.seats[1 - seat];
    if (other && other.color === color) color = PALETTE.find((c) => c !== other.color)!;
    if (!room.match || room.match.phase === 'matchOver') {
      s.name = name;
      s.color = color;
    }

    ws.serializeAttachment({ seat, code: att.code } satisfies Attachment);
    // One live socket per seat: close stale tabs.
    for (const w of this.ctx.getWebSockets()) {
      if (w !== ws && (w.deserializeAttachment() as Attachment).seat === seat) {
        w.serializeAttachment({ seat: -1, code: att.code } satisfies Attachment);
        try {
          w.close(4000, 'replaced');
        } catch {
          /* ignore */
        }
      }
    }

    if (room.paused && room.paused.seat === seat) {
      this.resume(now);
      // If the other player dropped while we were away, now it's their clock.
      if (!this.isConnected(1 - seat)) this.pause(1 - seat, now);
    }
    room.lastActive = now;
    await this.persist();
    this.broadcastRoom(now);
  }

  private async leave(ws: WebSocket) {
    const att = ws.deserializeAttachment() as Attachment | null;
    const room = this.room;
    if (!att || att.seat < 0 || !room) return;
    if (this.isConnected(att.seat, ws)) return;
    const now = Date.now();
    this.pause(att.seat, now);
    await this.persist();
    this.broadcastRoom(now, ws);
  }

  // ---------------------------------------------------------------- game flow

  private bothHere(): boolean {
    return !!this.room && this.room.seats.every((s, i) => s && this.isConnected(i));
  }

  private newMatchOpts(first: number) {
    const r = this.room!;
    return {
      seed: randomSeed(),
      modeId: r.settings.modeId,
      windOn: r.settings.windOn,
      players: r.seats.map((s) => ({ name: s!.name, color: s!.color })),
      firstPlayer: first,
    };
  }

  private startMatch(match: MatchState, now: number) {
    const r = this.room!;
    r.match = match;
    r.seats.forEach((s) => s && (s.rematch = false));
    r.paused = null;
    r.nextRoundAt = null;
    r.turnDeadline = now + ROUND_FADE_MS + CONFIG.online.turnSeconds * 1000;
  }

  private shoot(seat: number, msg: Extract<ClientMsg, { t: 'shoot' }>, now: number): boolean {
    const r = this.room!;
    const m = r.match;
    if (!m || m.phase !== 'aim' || r.paused || m.turn !== seat || msg.seq !== m.seq) return false;
    if (!Number.isFinite(msg.angle) || !Number.isFinite(msg.power) || msg.power < CONFIG.aim.minPower) return false;
    const phase = Number.isFinite(msg.phase) ? +msg.phase! : undefined;
    const { state, shot, flight } = applyShot(m, { angle: +msg.angle, power: +msg.power, phase });
    // How long clients spend showing this shot before the next turn starts.
    const animMs =
      flight.impact.step * CONFIG.physics.dt * 1000 + CONFIG.feel.impactHoldMs + CONFIG.feel.headshotFreezeMs + (state.lastEvent?.killed ? 600 : 0) + 900;
    this.afterTurn(state, now, animMs);
    r.lastActive = now;
    void this.persist();
    for (const ws of this.ctx.getWebSockets()) {
      const s = (ws.deserializeAttachment() as Attachment).seat;
      this.send(ws, { t: 'shot', shot, room: this.view(), you: s, now });
    }
    void this.schedule();
    return true;
  }

  /** Install the post-turn state and set the right clock. */
  private afterTurn(state: MatchState, now: number, animMs: number) {
    const r = this.room!;
    r.match = state;
    r.turnDeadline = null;
    r.nextRoundAt = null;
    if (state.phase === 'aim') r.turnDeadline = now + animMs + CONFIG.online.turnSeconds * 1000;
    else if (state.phase === 'roundOver') r.nextRoundAt = now + animMs + CONFIG.online.betweenRoundsMs;
    else if (state.phase === 'matchOver') this.finishMatch();
  }

  private finishMatch() {
    const r = this.room!;
    const w = r.match?.matchWinner;
    if (w !== null && w !== undefined) r.tally[w]++;
    r.turnDeadline = null;
    r.nextRoundAt = null;
    r.paused = null;
    r.seats.forEach((s) => s && (s.rematch = false));
  }

  /** Freeze the clocks while `seat` is away; they forfeit when `until` passes. */
  private pause(seat: number, now: number) {
    const r = this.room!;
    if (!r.match || r.match.phase === 'matchOver' || r.paused) return;
    r.paused = {
      seat,
      until: now + CONFIG.online.disconnectGraceSeconds * 1000,
      turnLeft: r.turnDeadline !== null ? Math.max(0, r.turnDeadline - now) : null,
      roundLeft: r.nextRoundAt !== null ? Math.max(0, r.nextRoundAt - now) : null,
    };
    r.turnDeadline = null;
    r.nextRoundAt = null;
  }

  private resume(now: number) {
    const r = this.room!;
    const p = r.paused;
    if (!p) return;
    r.paused = null;
    if (p.turnLeft !== null) r.turnDeadline = now + Math.max(p.turnLeft, 8000);
    if (p.roundLeft !== null) r.nextRoundAt = now + Math.max(p.roundLeft, 1500);
  }

  async alarm() {
    const r = this.room;
    if (!r) return;
    const now = Date.now();
    if (now - r.lastActive > CONFIG.online.roomExpiryDays * DAY) {
      for (const ws of this.ctx.getWebSockets()) ws.close(4002, 'expired');
      await this.ctx.storage.deleteAll();
      this.room = null;
      return;
    }
    let changed = false;
    const m = r.match;
    if (r.paused && now >= r.paused.until) {
      if (this.isConnected(r.paused.seat)) this.resume(now);
      else if (m) {
        r.match = forfeit(m, r.paused.seat);
        this.finishMatch();
      }
      changed = true;
    } else if (!r.paused && m) {
      if (r.nextRoundAt !== null && now >= r.nextRoundAt) {
        r.match = nextRound(m);
        r.nextRoundAt = null;
        r.turnDeadline = now + ROUND_FADE_MS + CONFIG.online.turnSeconds * 1000;
        changed = true;
      } else if (r.turnDeadline !== null && now >= r.turnDeadline && m.phase === 'aim') {
        this.afterTurn(skipTurn(m), now, 1200);
        changed = true;
      }
    }
    if (changed) {
      await this.persist();
      this.broadcastRoom(now);
    } else {
      await this.schedule();
    }
  }

  // ---------------------------------------------------------------- plumbing

  private isConnected(seat: number, except?: WebSocket): boolean {
    return this.ctx.getWebSockets().some((w) => w !== except && w.readyState === WebSocket.OPEN && (w.deserializeAttachment() as Attachment).seat === seat);
  }

  private view(except?: WebSocket): RoomView {
    const r = this.room!;
    return {
      code: r.code,
      seats: r.seats.map((s, i) => (s ? { name: s.name, color: s.color, rematch: s.rematch, connected: this.isConnected(i, except) } : null)),
      settings: r.settings,
      match: r.match,
      turnDeadline: r.turnDeadline,
      paused: r.paused ? { seat: r.paused.seat, until: r.paused.until } : null,
      tally: r.tally,
    };
  }

  private roomMsg(seat: number, now: number, except?: WebSocket): ServerMsg {
    return { t: 'room', room: this.view(except), you: seat, now };
  }

  private broadcastRoom(now: number, except?: WebSocket) {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const seat = (ws.deserializeAttachment() as Attachment).seat;
      if (seat >= 0) this.send(ws, this.roomMsg(seat, now, except));
    }
    void this.schedule();
  }

  private broadcast(msg: ServerMsg, exceptSeat: number) {
    for (const ws of this.ctx.getWebSockets()) {
      const seat = (ws.deserializeAttachment() as Attachment).seat;
      if (seat >= 0 && seat !== exceptSeat) this.send(ws, msg);
    }
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket went away */
    }
  }

  private async persist() {
    if (this.room) await this.ctx.storage.put('room', this.room);
  }

  /** One alarm covers every clock: the earliest pending deadline wins. */
  private async schedule() {
    const r = this.room;
    if (!r) return;
    const times = [r.lastActive + CONFIG.online.roomExpiryDays * DAY];
    if (r.paused) times.push(r.paused.until);
    else {
      if (r.nextRoundAt !== null) times.push(r.nextRoundAt);
      if (r.turnDeadline !== null) times.push(r.turnDeadline);
    }
    await this.ctx.storage.setAlarm(Math.min(...times));
  }
}
