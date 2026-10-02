import { CONFIG } from './config';
import type { Zone } from './body';

/**
 * Game modes are data. The match engine (match.ts) reads these fields and
 * never checks a mode id directly, so a new mode is usually just a new entry.
 */
export type ModeId = 'duel' | 'apple' | 'balloons' | 'ladder' | 'mover';

/** Things on the field to shoot at (besides the other archer). Each kind has a small setup hook in match.ts. */
export type TargetSet = 'balloons' | 'ladder' | 'mover';

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
  /** Can this mode have walls/houses in the middle of the field? */
  obstacles: boolean;
  /** Targets on the field, or null for none. */
  targets: TargetSet | null;
  /** Ring scoring for targets: points by ring, bullseye first. Without it a target hit uses zones.target. */
  rings?: readonly number[];
  /** Override the distance between archers [min, max]. */
  distance?: [number, number];
  /** What happens when the opponent is hit in each zone. Missing zone = nothing. */
  zones: Partial<Record<Zone, ZoneRule>>;
  /** First to this many rounds wins the match. */
  roundsToWin: number;
  /** If set, a round ends after both players took this many shots (most points wins; ties go to sudden death). */
  shotsPerPlayer: number | null;
  /** If set, a player with this many points (and more than the other) wins the round once both have had the same number of shots. */
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
    obstacles: true,
    targets: null,
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
    obstacles: true,
    targets: null,
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
    obstacles: false,
    targets: 'balloons',
    zones: { target: { points: 1 } },
    roundsToWin: 1,
    shotsPerPlayer: null,
    pointsToWin: CONFIG.balloons.pointsToWin,
    score: 'points',
  },
  ladder: {
    id: 'ladder',
    name: 'Ladder',
    blurb: `Hit your target and it moves further out. First to clear all ${CONFIG.ladder.stages.length} wins.`,
    apple: false,
    usesHp: false,
    hitArchers: false,
    obstacles: false,
    targets: 'ladder',
    zones: { target: { points: 1 } },
    roundsToWin: 1,
    shotsPerPlayer: null,
    pointsToWin: CONFIG.ladder.stages.length,
    distance: CONFIG.ladder.distance,
    score: 'points',
  },
  mover: {
    id: 'mover',
    name: 'Moving Target',
    blurb: `Lead your shot. Bullseye ${CONFIG.mover.rings[0]}, first to ${CONFIG.mover.pointsToWin}.`,
    apple: false,
    usesHp: false,
    hitArchers: false,
    obstacles: false,
    targets: 'mover',
    zones: { target: { points: 1 } },
    rings: CONFIG.mover.rings,
    roundsToWin: 1,
    shotsPerPlayer: null,
    pointsToWin: CONFIG.mover.pointsToWin,
    distance: CONFIG.mover.distance,
    score: 'points',
  },
};

/** Map setting: no obstacles, an obstacle in about half the rounds, or every round. */
export type WallsSetting = 'off' | 'some' | 'always';
export const WALLS_SETTINGS: WallsSetting[] = ['off', 'some', 'always'];
export function isWallsSetting(v: unknown): v is WallsSetting {
  return typeof v === 'string' && (WALLS_SETTINGS as string[]).includes(v);
}

export const MODE_LIST: ModeDef[] = Object.values(MODES);

export function isModeId(v: unknown): v is ModeId {
  return typeof v === 'string' && v in MODES;
}
