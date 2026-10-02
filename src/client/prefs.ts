import { PALETTE } from '../shared/config';
import { isModeId, isWallsSetting, type ModeId, type WallsSetting } from '../shared/modes';

/** Remembered choices. Storage can be unavailable (private mode), so every access is guarded. */
function get(key: string): string | null {
  try {
    return localStorage.getItem(`ba.${key}`);
  } catch {
    return null;
  }
}

function set(key: string, value: string) {
  try {
    localStorage.setItem(`ba.${key}`, value);
  } catch {
    /* ignore */
  }
}

let hintedThisSession = false;

export const prefs = {
  get name(): string {
    return get('name') ?? '';
  },
  set name(v: string) {
    set('name', v);
  },
  get color(): string {
    return get('color') ?? PALETTE[0];
  },
  set color(v: string) {
    set('color', v);
  },
  /** The "drag back to aim" hint disappears after your first shot, forever. */
  get hinted(): boolean {
    return hintedThisSession || get('hinted') === '1';
  },
  set hinted(v: boolean) {
    hintedThisSession = v;
    set('hinted', v ? '1' : '0');
  },
  get modeId(): ModeId {
    const m = get('mode');
    return isModeId(m) ? m : 'duel';
  },
  set modeId(v: ModeId) {
    set('mode', v);
  },
  get windOn(): boolean {
    return get('wind') !== '0';
  },
  set windOn(v: boolean) {
    set('wind', v ? '1' : '0');
  },
  get walls(): WallsSetting {
    const w = get('walls');
    return isWallsSetting(w) ? w : 'some';
  },
  set walls(v: WallsSetting) {
    set('walls', v);
  },
  /** Per-room secret that lets you reconnect to your seat. */
  token(room: string): string {
    let t = get(`token.${room}`);
    if (!t) {
      t = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
      set(`token.${room}`, t);
    }
    return t;
  },
  hasToken(room: string): boolean {
    return get(`token.${room}`) !== null;
  },
};
