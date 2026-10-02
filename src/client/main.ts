import { PALETTE } from '../shared/config';
import { createMatch, type MatchState } from '../shared/match';
import { sfx } from './audio';
import { GameView } from './game';
import { LocalDriver } from './local';
import { OnlineSession, newRoomCode, roomFromPath } from './online';
import { prefs } from './prefs';
import { MODES } from '../shared/modes';
import { el, hideBanner, Hud, iconButton, ICONS, modePicker, roundBanner, scoreLine, showOverlay, wallsPicker, windPicker } from './ui';

/** Offline build (no game server): vs bot and same screen only. See scripts/build-offline.mjs. */
const OFFLINE = import.meta.env.VITE_OFFLINE === '1';

const view = new GameView(document.getElementById('game') as HTMLCanvasElement);
const hud = new Hud();

let local: LocalDriver | null = null;
let online: OnlineSession | null = null;

// Corner buttons: home + sound
const soundBtn = iconButton(sfx.muted ? ICONS.muted : ICONS.sound, 'Sound', () => {
  sfx.setMuted(!sfx.muted);
  soundBtn.innerHTML = sfx.muted ? ICONS.muted : ICONS.sound;
});
const corner = el('div', { class: 'corner', hidden: true }, iconButton(ICONS.home, 'Menu', () => {
    const m = online?.activeMatch;
    if (m && !confirm('Leave the match? If you don’t come back within 30 seconds, you forfeit.')) return;
    goHome();
  }), soundBtn);
document.body.append(corner, el('div', { class: 'rotate-hint' }, '↻ Turn your phone sideways'));

// Full screen (where the browser allows it; iPhones use "Add to Home Screen" instead).
if (document.fullscreenEnabled) {
  const fsBtn = iconButton(ICONS.fullscreen, 'Full screen', () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else
      void document.documentElement
        .requestFullscreen({ navigationUI: 'hide' })
        .then(() => (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
        .catch(() => {});
  });
  fsBtn.classList.add('fs-btn');
  document.addEventListener('fullscreenchange', () => {
    fsBtn.innerHTML = document.fullscreenElement ? ICONS.exitFullscreen : ICONS.fullscreen;
  });
  document.body.append(fsBtn);
}

function stopEverything() {
  local?.dispose();
  local = null;
  online?.dispose();
  online = null;
  hideBanner();
  hud.setTimer(null);
}

// ------------------------------------------------------------------ home

function backdropState(): MatchState {
  return createMatch({
    seed: 2024,
    modeId: 'duel',
    windOn: true,
    players: [
      { name: '', color: prefs.color },
      { name: '', color: prefs.color === PALETTE[1] ? PALETTE[0] : PALETTE[1] },
    ],
  });
}

function goHome() {
  stopEverything();
  if (!OFFLINE && location.pathname !== '/') history.pushState(null, '', '/');
  view.interactive = false;
  view.hooks = {};
  view.reset(backdropState());
  hud.show(false);
  corner.hidden = true;

  const walls = wallsPicker(prefs.walls, prefs.modeId, (w) => (prefs.walls = w));
  const panel = el(
    'div',
    { class: 'panel' },
    el('h1', { class: 'title' }, 'Bows & Arrows'),
    el('p', { class: 'sub' }, 'Drag. Release. Headshot.'),
    ...(OFFLINE
      ? [
          el('button', { class: 'btn accent big', onclick: () => playLocal(true) }, 'Vs bot'),
          el('button', { class: 'btn', onclick: () => playLocal(false) }, 'Same screen'),
        ]
      : [
          el('button', { class: 'btn accent big', onclick: () => playFriend() }, 'Play a friend'),
          el(
            'div',
            { class: 'row' },
            el('button', { class: 'btn', onclick: () => playLocal(true) }, 'Vs bot'),
            el('button', { class: 'btn', onclick: () => playLocal(false) }, 'Same screen'),
          ),
        ]),
    modePicker(prefs.modeId, (m) => {
      prefs.modeId = m;
      walls.hidden = !MODES[m].obstacles;
    }),
    walls,
    windPicker(prefs.windOn, (on) => (prefs.windOn = on)),
  );
  showOverlay(panel);
}

// ------------------------------------------------------------------ local / bot

function playLocal(vsBot: boolean) {
  stopEverything();
  const me = { name: prefs.name || 'You', color: prefs.color };
  const other = PALETTE.find((c) => c !== me.color)!;
  const players = vsBot
    ? [me, { name: 'Bot', color: other }]
    : [
        { name: 'Red', color: PALETTE[0] },
        { name: 'Blue', color: PALETTE[1] },
      ];
  local = new LocalDriver(view, { modeId: prefs.modeId, windOn: prefs.windOn, walls: prefs.walls, players, bot: vsBot ? 1 : null });
  const driver = local;
  view.hooks = {
    shown: (s) => hud.update(s),
    idle: (s) => {
      if (s.phase === 'roundOver' && s.roundWinner !== null) roundBanner(s);
      if (s.phase === 'matchOver') {
        window.setTimeout(() => {
          if (local !== driver) return;
          showLocalGameOver(s, vsBot);
        }, 500);
      }
    },
  };
  showOverlay(null);
  hud.show(true);
  corner.hidden = false;
  view.interactive = true;
  local.start();
}

function showLocalGameOver(s: MatchState, vsBot: boolean) {
  const w = s.matchWinner!;
  const youWon = vsBot && w === 0;
  const title = vsBot ? (youWon ? 'You win!' : 'Bot wins') : `${s.players[w].name} wins!`;
  if (!vsBot || youWon) sfx.win();
  else sfx.lose();
  showOverlay(
    el(
      'div',
      { class: 'panel' },
      el('p', { class: 'result', style: { color: s.players[w].color } }, title),
      scoreLine(s),
      el(
        'button',
        {
          class: 'btn accent big',
          onclick: () => {
            showOverlay(null);
            local?.rematch();
          },
        },
        'Rematch',
      ),
      el('button', { class: 'btn light small', onclick: () => goHome() }, 'Menu'),
    ),
    true,
  );
}

// ------------------------------------------------------------------ online

function playFriend() {
  const code = newRoomCode();
  history.pushState(null, '', `/m/${code}`);
  joinRoom(code, true);
}

function joinRoom(code: string, creating: boolean) {
  stopEverything();
  showOverlay(null);
  view.hooks = {};
  view.reset(backdropState());
  online = new OnlineSession(code, view, hud, {
    creating,
    onExit: () => goHome(),
    showCorner: (on) => (corner.hidden = !on),
  });
}

function route() {
  const code = OFFLINE ? null : roomFromPath(location.pathname);
  if (code) joinRoom(code, false);
  else goHome();
}

// Dev-only handle for scripted smoke tests (scripts/*.mjs). Stripped from production builds.
if (import.meta.env.DEV) {
  void import('../shared/bot').then((bot) => {
    (window as unknown as Record<string, unknown>).__ba = { view, bot, local: () => local };
  });
}

window.addEventListener('popstate', route);
route();
