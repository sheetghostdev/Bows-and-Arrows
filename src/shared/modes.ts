import { CONFIG } from './config';
import type { Zone } from './body';

/**
 * Game modes are data. The match engine (match.ts) reads these fields and
 * never checks a mode id directly, so a new mode is usually just a new entry.
 */
export type ModeId = 'duel' | 'apple' | 'balloons';

export interface ZoneRule {
  /** HP removed from the archer that was hit ('kill' = all of it). */
  damage?: number | 'kill';
  /** Points awarded to the shooter (negative = penalty). */
  points?: number;
}

export interface ModeDef {
  id: ModeId;
  name: string;
  /** One line shown in menus. */
  blurb: string;
  /** Put an apple on each archer's head. */
  apple: boolean;
  /** Archers have HP; reaching 0 ends the round. */
  usesHp: boolean;
  /** Can arrows hit the other archer at all? (false = they fly through) */
  hitArchers: boolean;
  /** Balloons floating over the field (0 = none). Popped balloons stay popped for the round. */
  balloons: number;
  /** What happens when the opponent is hit in each zone. Missing zone = nothing. */
  zones: Partial<Record<Zone, ZoneRule>>;
  /** First to this many rounds wins the match. */
  roundsToWin: number;
  /** If set, a round ends after both players took this many shots (most points wins; ties go to sudden death). */
  shotsPerPlayer: number | null;
  /** If set, the first player to reach this many points wins the round. */
  pointsToWin: number | null;
  /** What the scoreboard shows. */
  score: 'rounds' | 'points';
}

export const MODES: Record<ModeId, ModeDef> = {
  duel: {
    id: 'duel',
    name: 'Duel',
    blurb: 'Best of 3. Headshots kill.',
    apple: false,
    usesHp: true,
    hitArchers: true,
    balloons: 0,
    zones: {
      head: { damage: 'kill' },
      body: { damage: CONFIG.duel.bodyDamage },
    },
    roundsToWin: CONFIG.duel.roundsToWin,
    shotsPerPlayer: null,
    pointsToWin: null,
    score: 'rounds',
  },
  apple: {
    id: 'apple',
    name: 'Apple Shot',
    blurb: `Hit their apple. Not them. ${CONFIG.apple.shotsPerPlayer} arrows each.`,
    apple: true,
    usesHp: false,
    hitArchers: true,
    balloons: 0,
    zones: {
      apple: { points: CONFIG.apple.applePoints },
      head: { points: CONFIG.apple.hitPenalty },
      body: { points: CONFIG.apple.hitPenalty },
    },
    roundsToWin: 1,
    shotsPerPlayer: CONFIG.apple.shotsPerPlayer,
    pointsToWin: null,
    score: 'points',
  },
  balloons: {
    id: 'balloons',
    name: 'Balloons',
    blurb: `Take turns popping balloons. First to ${CONFIG.balloons.pointsToWin} wins.`,
    apple: false,
    usesHp: false,
    hitArchers: false,
    balloons: CONFIG.balloons.count,
    zones: { balloon: { points: 1 } },
    roundsToWin: 1,
    shotsPerPlayer: null,
    pointsToWin: CONFIG.balloons.pointsToWin,
    score: 'points',
  },
};

export const MODE_LIST: ModeDef[] = Object.values(MODES);

export function isModeId(v: unknown): v is ModeId {
  return typeof v === 'string' && v in MODES;
}
