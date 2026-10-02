import { CONFIG } from '../shared/config';
import { modeOf, type MatchState } from '../shared/match';
import { MODES } from '../shared/modes';
import type { ShotInput } from '../shared/physics';
import { MAX_NAME, ROOM_CODE, type ClientMsg, type RoomView, type ServerMsg } from '../shared/protocol';
import { sfx } from './audio';
import type { Driver, GameView } from './game';
import { prefs } from './prefs';
import { banner, colorPicker, el, hideBanner, type Hud, modePicker, roundBanner, scoreLine, showOverlay, windPicker } from './ui';

const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';

export function newRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

export function roomFromPath(path: string): string | null {
  const m = path.match(/^\/m\/([a-z0-9]+)\/?$/);
  return m && ROOM_CODE.test(m[1]) ? m[1] : null;
}

type Stage = 'join' | 'connecting' | 'lobby' | 'game' | 'full';

interface Opts {
  creating: boolean;
  onExit: () => void;
  showCorner: (on: boolean) => void;
}

/**
 * Online play. The server is the referee: we send angle+power, it sends back
 * the shot (launch velocity + wind) and the resulting state, which we animate.
 */
export class OnlineSession implements Driver {
  private ws: WebSocket | null = null;
  private room: RoomView | null = null;
  private you = -1;
  private offset = 0;
  private stage: Stage = 'join';
  private retries = 0;
  private disposed = false;
  private pendingShot = false;
  private lastAimSent = 0;
  private aimTimer = 0;
  private ticker = 0;
  private reconnectTimer = 0;
  private lastTick = -1;
  private overShown = false;
  private matchKey = '';

  constructor(
    private code: string,
    private view: GameView,
    private hud: Hud,
    private opts: Opts,
  ) {
    view.interactive = false;
    view.setDriver(null);
    view.hooks = {
      shown: (s) => this.hud.update(s, this.you),
      idle: (s) => this.onIdle(s),
    };
    if (prefs.hasToken(code) && prefs.name) this.connect();
    else this.showJoin();
    this.ticker = window.setInterval(() => this.tick(), 200);
  }

  dispose() {
    this.disposed = true;
    clearInterval(this.ticker);
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.aimTimer);
    this.ws?.close();
    this.ws = null;
    this.view.setDriver(null);
    this.view.hooks = {};
    this.hud.show(false);
    this.hud.setTimer(null);
    this.opts.showCorner(false);
  }

  /** True while a match is being played (leaving would count against you). */
  get activeMatch(): boolean {
    const m = this.room?.match;
    return !!m && m.phase !== 'matchOver';
  }

  private get serverNow() {
    return Date.now() + this.offset;
  }

  // ---------------------------------------------------------------- Driver

  controls(player: number): boolean {
    const r = this.room;
    return !!r && player === this.you && !r.paused && !this.pendingShot && this.ws?.readyState === WebSocket.OPEN;
  }

  shoot(input: ShotInput) {
    const m = this.room?.match;
    if (!m) return;
    this.pendingShot = true;
    clearTimeout(this.aimTimer);
    this.send({ t: 'shoot', angle: input.angle, power: input.power, seq: m.seq });
  }

  aim(input: ShotInput | null) {
    clearTimeout(this.aimTimer);
    if (!input) {
      this.send({ t: 'aimOff' });
      return;
    }
    const wait = 80 - (performance.now() - this.lastAimSent);
    const go = () => {
      this.lastAimSent = performance.now();
      this.send({ t: 'aim', angle: input.angle, power: input.power });
    };
    if (wait <= 0) go();
    else this.aimTimer = window.setTimeout(go, wait);
  }

  private onIdle(s: MatchState) {
    if (s.phase === 'roundOver' && s.roundWinner !== null) roundBanner(s);
    if (s.phase === 'matchOver' && !this.overShown) {
      window.setTimeout(() => {
        if (this.disposed || this.room?.match?.phase !== 'matchOver') return;
        this.overShown = true;
        const w = this.room.match.matchWinner;
        if (w === this.you) sfx.win();
        else sfx.lose();
        this.render();
      }, 500);
    }
  }

  // ---------------------------------------------------------------- network

  private connect() {
    if (this.disposed) return;
    if (this.stage === 'join') {
      this.stage = 'connecting';
      this.render();
    }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws/${this.code}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retries = 0;
      this.send({ t: 'hello', token: prefs.token(this.code), name: prefs.name, color: prefs.color });
      hideBanner();
    };
    ws.onmessage = (e) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      this.handle(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws || this.disposed || this.stage === 'full') return;
      this.ws = null;
      if (this.stage === 'game') banner('Reconnecting…', 60000);
      const delay = Math.min(5000, 400 * 2 ** this.retries++);
      this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
    };
  }

  private send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private handle(msg: ServerMsg) {
    switch (msg.t) {
      case 'room':
      case 'shot':
        this.offset = msg.now - Date.now();
        this.you = msg.you;
        this.apply(msg.room, msg.t === 'shot' ? msg : null);
        break;
      case 'aim':
        if (msg.seat !== this.you) this.view.setRemoteAim(msg.seat, { angle: msg.angle, power: msg.power });
        break;
      case 'aimOff':
        this.view.setRemoteAim(msg.seat, null);
        break;
      case 'error':
        if (msg.code === 'full') {
          this.stage = 'full';
          this.render();
        }
        break;
    }
  }

  private apply(room: RoomView, shotMsg: Extract<ServerMsg, { t: 'shot' }> | null) {
    const prev = this.room;
    this.room = room;
    const m = room.match;
    if (prev && prev.seats[1] === null && room.seats[1] && this.you === 0) {
      banner(`${room.seats[1].name} joined!`);
      sfx.win();
    }
    if (!m) {
      this.stage = 'lobby';
      this.matchKey = '';
      this.overShown = false;
      this.pendingShot = false;
      this.view.interactive = false;
      this.view.setDriver(null);
      this.hud.show(false);
      this.opts.showCorner(false);
      this.render();
      return;
    }
    const key = `${m.seed}`;
    if (this.stage !== 'game' || key !== this.matchKey) {
      // New match (or we just arrived): start the view from this state.
      this.stage = 'game';
      this.matchKey = key;
      this.overShown = m.phase === 'matchOver';
      this.view.setDriver(this);
      this.view.interactive = true;
      this.view.reset(m);
      this.hud.show(true);
      this.opts.showCorner(true);
    } else if (shotMsg) {
      this.view.push({ kind: 'shot', shot: shotMsg.shot, state: m });
    } else if (!prev?.match || prev.match.seq !== m.seq) {
      this.view.push({ kind: 'state', state: m });
    }
    if (!prev?.match || prev.match.seq !== m.seq) this.pendingShot = false;
    if (m.turn !== this.you || m.phase !== 'aim') this.view.setRemoteAim(this.you, null);
    this.render();
  }

  // ---------------------------------------------------------------- clocks

  private tick() {
    const r = this.room;
    const m = r?.match;
    if (this.stage !== 'game' || !r || !m) return;
    if (r.paused) {
      this.hud.setTimer(null);
      this.render();
      return;
    }
    if (m.phase === 'aim' && r.turnDeadline && this.view.settled) {
      const left = Math.min(CONFIG.online.turnSeconds, (r.turnDeadline - this.serverNow) / 1000);
      this.hud.setTimer(left);
      const whole = Math.ceil(left);
      if (m.turn === this.you && whole <= 5 && whole > 0 && whole !== this.lastTick) sfx.tick();
      this.lastTick = whole;
    } else {
      this.hud.setTimer(null);
    }
  }

  // ---------------------------------------------------------------- screens

  private render() {
    if (this.disposed) return;
    switch (this.stage) {
      case 'join':
        return showOverlay(this.joinPanel());
      case 'connecting':
        return showOverlay(el('div', { class: 'panel' }, el('p', { class: 'sub waiting' }, 'Connecting…')), false, 'connecting');
      case 'full':
        return showOverlay(
          el(
            'div',
            { class: 'panel' },
            el('h1', { class: 'title' }, 'Match is full'),
            el('p', { class: 'sub' }, 'Two archers are already in this one.'),
            el('button', { class: 'btn accent big', onclick: () => this.opts.onExit() }, 'Start your own'),
          ),
        );
      case 'lobby':
        return showOverlay(this.lobbyPanel(), false, 'lobby');
      case 'game': {
        const r = this.room!;
        if (r.paused) return showOverlay(this.pausedPanel(r), true, 'paused');
        if (r.match?.phase === 'matchOver' && this.overShown) return showOverlay(this.gameOverPanel(r), true, 'over');
        return showOverlay(null);
      }
    }
  }

  private showJoin() {
    this.stage = 'join';
    this.render();
  }

  private joinPanel() {
    const creating = this.opts.creating;
    let color = prefs.color;
    const input = el('input', {
      class: 'field',
      value: prefs.name,
      placeholder: 'Your name',
      maxlength: MAX_NAME,
      autocomplete: 'nickname',
      enterkeyhint: 'go',
      onkeydown: (e: Event) => (e as KeyboardEvent).key === 'Enter' && go(),
    });
    const go = () => {
      prefs.name = input.value.trim() || 'Archer';
      prefs.color = color;
      this.connect();
    };
    const panel = el(
      'div',
      { class: 'panel' },
      el('h1', { class: 'title' }, creating ? 'New match' : "You've been challenged!"),
      el('p', { class: 'sub' }, 'Pick a name and a color.'),
      input,
      colorPicker(color, null, (c) => (color = c)),
      el('button', { class: 'btn accent big', onclick: go }, creating ? 'Create match' : 'Join'),
      el('button', { class: 'btn light small', onclick: () => this.opts.onExit() }, 'Back'),
    );
    if (!matchMedia('(pointer: coarse)').matches) setTimeout(() => input.focus(), 50);
    return panel;
  }

  private lobbyPanel() {
    const r = this.room!;
    const host = this.you === 0;
    const url = `${location.origin}/m/${this.code}`;
    const other = r.seats[1 - this.you];
    const ready = r.seats.every((s) => s?.connected);

    const slots = el(
      'div',
      { class: 'slots' },
      ...r.seats.map((s, i) =>
        s
          ? el(
              'div',
              { class: 'slot', style: { '--pc': s.color } as Record<string, string> },
              el('span', { class: 'dot' }),
              el('span', { class: 'who' }, s.name + (i === this.you ? ' (you)' : '')),
              !s.connected ? el('span', { class: 'tag' }, 'away') : null,
            )
          : el('div', { class: 'slot empty' }, el('span', { class: 'dot' }), el('span', { class: 'who' }, 'waiting…')),
      ),
    );
    slots.querySelectorAll<HTMLElement>('.slot').forEach((n, i) => {
      const s = r.seats[i];
      if (s) n.querySelector<HTMLElement>('.dot')!.style.background = s.color;
    });

    const copyBtn = el('button', { class: 'btn small', onclick: () => copy() }, 'Copy');
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(url);
        copyBtn.textContent = 'Copied!';
      } catch {
        linkInput.select();
        document.execCommand?.('copy');
        copyBtn.textContent = 'Copied!';
      }
      setTimeout(() => (copyBtn.textContent = 'Copy'), 1500);
    };
    const linkInput = el('input', { value: url, readonly: true, onfocus: () => linkInput.select() });
    const share = 'share' in navigator;
    const settings = r.settings;
    const sendSettings = (modeId = settings.modeId, windOn = settings.windOn) => this.send({ t: 'settings', modeId, windOn });

    return el(
      'div',
      { class: 'panel' },
      el('h1', { class: 'title' }, other ? (ready ? 'Ready!' : 'Almost ready') : 'Invite a friend'),
      !other ? el('p', { class: 'sub' }, 'Send them this link. They tap it, they’re in.') : null,
      !other ? el('div', { class: 'link-box' }, linkInput, copyBtn) : null,
      !other && share
        ? el(
            'button',
            {
              class: 'btn accent',
              onclick: () => navigator.share({ title: 'Bows & Arrows', text: 'Archery duel? Tap to join:', url }).catch(() => {}),
            },
            'Send link',
          )
        : null,
      slots,
      host
        ? modePicker(settings.modeId, (m) => sendSettings(m, settings.windOn))
        : el('p', { class: 'sub' }, `${MODES[settings.modeId].name} · ${settings.windOn ? 'wind on' : 'no wind'}`),
      host ? windPicker(settings.windOn, (on) => sendSettings(settings.modeId, on)) : null,
      host
        ? el('button', { class: 'btn accent big', disabled: !ready, onclick: () => this.send({ t: 'start' }) }, ready ? 'Start' : 'Waiting for friend…')
        : el('p', { class: 'sub waiting' }, `Waiting for ${r.seats[0]?.name ?? 'host'} to start…`),
      el('button', { class: 'btn light small', onclick: () => this.opts.onExit() }, 'Leave'),
    );
  }

  private pausedPanel(r: RoomView) {
    const p = r.paused!;
    const left = Math.max(0, Math.ceil((p.until - this.serverNow) / 1000));
    const name = r.seats[p.seat]?.name ?? 'Opponent';
    return el(
      'div',
      { class: 'panel' },
      el('h1', { class: 'title' }, 'Paused'),
      el('p', { class: 'sub waiting' }, `${name} dropped out. Waiting ${left}s…`),
      el('p', { class: 'muted' }, 'If they don’t come back, you win by forfeit.'),
    );
  }

  private gameOverPanel(r: RoomView) {
    const m = r.match!;
    const w = m.matchWinner!;
    const me = r.seats[this.you];
    const other = r.seats[1 - this.you];
    const youWon = w === this.you;
    const otherName = other?.name ?? 'Opponent';
    const reason = m.endReason === 'forfeit' ? (youWon ? `${otherName} left the match` : 'You left the match') : null;
    let rematchLabel = 'Rematch';
    let disabled = false;
    if (me?.rematch) {
      rematchLabel = `Waiting for ${otherName}…`;
      disabled = true;
    } else if (other?.rematch) rematchLabel = 'Rematch!';
    const mode = modeOf(m);
    return el(
      'div',
      { class: 'panel' },
      el('p', { class: 'result', style: { color: m.players[w].color } }, youWon ? 'You win!' : `${m.players[w].name} wins`),
      reason ? el('p', { class: 'sub' }, reason) : null,
      scoreLine(m),
      el('p', { class: 'muted' }, `${mode.name} · all-time ${r.tally[this.you]} – ${r.tally[1 - this.you]}`),
      other?.rematch && !me?.rematch ? el('p', { class: 'sub waiting' }, `${otherName} wants a rematch!`) : null,
      el('button', { class: 'btn accent big', disabled, onclick: () => this.send({ t: 'rematch' }) }, rematchLabel),
      !other?.connected ? el('p', { class: 'muted' }, `${otherName} is away. They can come back with the same link.`) : null,
      el(
        'div',
        { class: 'row' },
        this.you === 0 ? el('button', { class: 'btn light small', onclick: () => this.send({ t: 'lobby' }) }, 'Change mode') : null,
        el('button', { class: 'btn light small', onclick: () => this.opts.onExit() }, 'Menu'),
      ),
    );
  }
}
