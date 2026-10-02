import { facingOf } from '../shared/body';
import { PALETTE } from '../shared/config';
import { modeOf, type MatchState } from '../shared/match';
import { MODE_LIST, type ModeId } from '../shared/modes';
import { sfx } from './audio';

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, unknown>;

/** Tiny DOM builder: el('button', { class: 'btn', onclick }, 'Go'). */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      const handler = v as (e: Event) => void;
      node.addEventListener(k.slice(2), (e) => {
        if (k === 'onclick') sfx.unlock();
        handler(e);
      });
    } else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k in node && typeof v !== 'string') (node as unknown as Record<string, unknown>)[k] = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

const overlay = document.getElementById('overlay')!;
const hudRoot = document.getElementById('hud')!;
const bannerEl = document.getElementById('banner')!;

/** Show a panel. Re-showing the same `key` swaps content without replaying the pop-in animation. */
export function showOverlay(node: HTMLElement | null, dim = false, key = '') {
  const current = overlay.firstElementChild as HTMLElement | null;
  if (node && key && current?.dataset.key === key) node.classList.add('still');
  if (node && key) node.dataset.key = key;
  overlay.replaceChildren(...(node ? [node] : []));
  overlay.classList.toggle('dim', !!node && dim);
}

let bannerTimer = 0;
export function banner(text: string, ms = 1800) {
  bannerEl.textContent = text;
  bannerEl.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => bannerEl.classList.remove('show'), ms);
}

export function hideBanner() {
  clearTimeout(bannerTimer);
  bannerEl.classList.remove('show');
}

// ------------------------------------------------------------------ HUD

const ARROW_SVG = '<svg viewBox="0 0 26 18"><path d="M2 9h18M14 3l7 6-7 6" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export class Hud {
  private cards: HTMLElement[] = [];
  private wind = el('div', { class: 'chip' });
  private timer = el('div', { class: 'chip', hidden: true });

  constructor() {
    const left = el('div', { class: 'card' });
    const right = el('div', { class: 'card right' });
    this.cards = [left, right];
    hudRoot.replaceChildren(left, el('div', { class: 'center-chips' }, this.wind, this.timer), right);
  }

  show(on: boolean) {
    hudRoot.hidden = !on;
  }

  update(s: MatchState, you: number | null = null) {
    const mode = modeOf(s);
    for (const p of [0, 1]) {
      const card = this.cards[p];
      card.style.setProperty('--pc', s.players[p].color);
      card.classList.toggle('active', s.phase === 'aim' && s.turn === p);
      const name = el('span', { class: 'name' }, s.players[p].name + (you === p ? ' (you)' : ''));
      let score: HTMLElement;
      if (mode.score === 'rounds') {
        score = el('span', { class: 'pips' });
        for (let i = 0; i < mode.roundsToWin; i++) score.append(el('span', { class: `pip${i < s.roundWins[p] ? ' on' : ''}` }));
      } else {
        score = el('span', { class: 'pts' }, String(s.points[p]));
      }
      const extra = mode.shotsPerPlayer ? el('span', { class: 'muted' }, `${Math.max(0, mode.shotsPerPlayer - s.shots[p])}➶`) : null;
      card.replaceChildren(...[el('span', { class: 'dot' }), name, score, extra].filter((n): n is HTMLElement => n !== null));
    }
    this.wind.hidden = !s.windOn;
    if (s.windOn) {
      const level = Math.abs(s.windLevel);
      const dir = Math.sign(s.windLevel * facingOf(s.turn));
      this.wind.innerHTML = level === 0 ? '<span>calm</span>' : `${ARROW_SVG}<span>${level}</span>`;
      const svg = this.wind.querySelector('svg');
      if (svg) svg.style.transform = dir < 0 ? 'scaleX(-1)' : '';
      this.wind.title = 'Wind';
    }
  }

  /** Seconds left on the turn timer, or null to hide it. */
  setTimer(seconds: number | null) {
    if (seconds === null) {
      this.timer.hidden = true;
      return;
    }
    this.timer.hidden = false;
    const s = Math.max(0, Math.ceil(seconds));
    const text = `⏱ ${s}`;
    if (this.timer.textContent !== text) this.timer.textContent = text;
    this.timer.classList.toggle('urgent', s <= 5);
  }
}

// ------------------------------------------------------------------ pieces

export function segmented<T extends string>(options: { value: T; label: string }[], value: T, onChange: (v: T) => void, disabled = false) {
  const root = el('div', { class: 'seg' });
  const render = (v: T) => {
    root.replaceChildren(
      ...options.map((o) =>
        el(
          'button',
          {
            class: o.value === v ? 'on' : '',
            disabled,
            onclick: () => {
              sfx.click();
              render(o.value);
              onChange(o.value);
            },
          },
          o.label,
        ),
      ),
    );
  };
  render(value);
  return root;
}

export function modePicker(value: ModeId, onChange: (m: ModeId) => void, disabled = false) {
  return segmented(
    MODE_LIST.map((m) => ({ value: m.id, label: m.name })),
    value,
    onChange,
    disabled,
  );
}

export function windPicker(value: boolean, onChange: (on: boolean) => void, disabled = false) {
  return segmented(
    [
      { value: 'on', label: 'Wind on' },
      { value: 'off', label: 'No wind' },
    ],
    value ? 'on' : 'off',
    (v) => onChange(v === 'on'),
    disabled,
  );
}

export function colorPicker(value: string, taken: string | null, onChange: (c: string) => void) {
  const root = el('div', { class: 'swatches' });
  const render = (v: string) => {
    root.replaceChildren(
      ...PALETTE.map((c) =>
        el('button', {
          class: `swatch${c === v ? ' on' : ''}`,
          style: { background: c },
          disabled: c === taken,
          'aria-label': `Color ${c}`,
          onclick: () => {
            sfx.click();
            render(c);
            onChange(c);
          },
        }),
      ),
    );
  };
  render(value);
  return root;
}

export const ICONS = {
  home: '<svg viewBox="0 0 24 24"><path d="M4 11l8-7 8 7M6 10v9h12v-9" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  muted: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
};

export function iconButton(svg: string, label: string, onclick: () => void) {
  const b = el('button', { class: 'icon-btn', 'aria-label': label, title: label, onclick });
  b.innerHTML = svg;
  return b;
}

export function roundBanner(s: MatchState) {
  banner(`${s.players[s.roundWinner!].name} takes round ${s.round + 1}`, 2200);
}

export function scoreLine(s: MatchState) {
  const mode = modeOf(s);
  const score = mode.score === 'rounds' ? s.roundWins : s.points;
  return el(
    'div',
    { class: 'score-line' },
    el('span', { class: 'dot', style: { background: s.players[0].color } }),
    `${score[0]} – ${score[1]}`,
    el('span', { class: 'dot', style: { background: s.players[1].color } }),
  );
}

