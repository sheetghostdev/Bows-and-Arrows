import { PALETTE } from './config';
import type { MatchState, ShotRecord } from './match';
import type { ModeId } from './modes';

export interface SeatView {
  name: string;
  color: string;
  connected: boolean;
  rematch: boolean;
}

/** Everything a client needs to draw a room. Seat 0 is the host (whoever opened the link first). */
export interface RoomView {
  code: string;
  seats: (SeatView | null)[];
  settings: { modeId: ModeId; windOn: boolean };
  match: MatchState | null;
  /** Server epoch ms when the current turn times out (null = no timer running). */
  turnDeadline: number | null;
  /** A player dropped: the match is frozen until `until`, then they forfeit. */
  paused: { seat: number; until: number } | null;
  /** Lifetime match wins per seat in this room. */
  tally: number[];
}

export type ClientMsg =
  | { t: 'hello'; token: string; name: string; color: string }
  | { t: 'settings'; modeId: ModeId; windOn: boolean }
  | { t: 'start' }
  | { t: 'shoot'; angle: number; power: number; seq: number }
  | { t: 'aim'; angle: number; power: number }
  | { t: 'aimOff' }
  | { t: 'rematch' }
  | { t: 'lobby' }
  | { t: 'ping' };

export type ServerMsg =
  | { t: 'room'; room: RoomView; you: number; now: number }
  | { t: 'shot'; shot: ShotRecord; room: RoomView; you: number; now: number }
  | { t: 'aim'; seat: number; angle: number; power: number }
  | { t: 'aimOff'; seat: number }
  | { t: 'error'; code: 'full' | 'bad'; message: string }
  | { t: 'pong'; now: number };

export const ROOM_CODE = /^[a-z0-9]{4,12}$/;
export const MAX_NAME = 14;

export function cleanName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  // Drop control characters, collapse whitespace.
  const name = s.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  return name || 'Archer';
}

export function cleanColor(raw: unknown): string {
  return typeof raw === 'string' && (PALETTE as readonly string[]).includes(raw) ? raw : PALETTE[0];
}
