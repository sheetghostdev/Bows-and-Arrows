/**
 * Every balance knob in the game lives here.
 * Units: metres, seconds, m/s, m/s². Tweak, save, reload.
 */
export const CONFIG = {
  physics: {
    /** Fixed simulation step. Never depends on frame rate. */
    dt: 1 / 120,
    /** Collision checks per step (catches thin targets at full speed). */
    substeps: 4,
    gravity: 9.8,
    /** Safety cap; every real shot lands well before this. */
    maxFlightSeconds: 15,
  },

  aim: {
    /** Arrow speed at 100% power. */
    maxSpeed: 20,
    /** Releasing below this power cancels the shot (lets you "put the bow down"). */
    minPower: 0.08,
    /** Angles are relative to the archer's facing: 0 = flat toward opponent, 90 = straight up. */
    minAngle: -30,
    maxAngle: 89,
    /** Drag distance for 100% power, as a fraction of the smaller screen side. */
    dragForFullPower: 0.5,
    /** On release, use the aim from this long before the finger lifted (lifting a thumb nudges it). */
    releaseSettleMs: 80,
  },

  arena: {
    /** Horizontal distance between the two archers, re-rolled every round. */
    minDistance: 12,
    maxDistance: 26,
    /** Gentle rolling ground: control-point spacing and max height offset. */
    terrainStep: 5,
    terrainAmplitude: 0.3,
  },

  duel: {
    hp: 100,
    /** Body/limb damage. 40 => three body hits to kill. 50 => two. */
    bodyDamage: 40,
    /** Best of 3. */
    roundsToWin: 2,
  },

  apple: {
    shotsPerPlayer: 5,
    applePoints: 1,
    /** Hitting the opponent anywhere (body or head) costs this. */
    hitPenalty: -1,
  },

  balloons: {
    /** Odd, so a race to more than half can't tie. */
    count: 9,
    pointsToWin: 5,
    radius: 0.32,
    /** Height above the ground. */
    minHeight: 1.6,
    maxHeight: 7,
  },

  ladder: {
    /** Each player's target distances, in order (metres from the shooter). */
    stages: [7, 11, 15, 19],
    radius: 0.32,
    /** Board centre height above the ground. */
    height: 1.3,
    distance: [22, 24] as [number, number],
  },

  mover: {
    /** Points by ring, bullseye first. Rings are equal-width bands of the radius. */
    rings: [3, 2, 1],
    radius: 0.4,
    pointsToWin: 8,
    /** Per pair of shots: how high it flies, how far it sweeps each way, how fast. */
    minHeight: 1.5,
    maxHeight: 3,
    minRange: 1.5,
    maxRange: 3.5,
    minSpeed: 1.5,
    maxSpeed: 3.5,
    distance: [12, 18] as [number, number],
  },

  wind: {
    /**
     * Horizontal acceleration at strength 10. Kept small enough that full power
     * always reaches the opponent into a full headwind at max distance
     * (verified by tests/fairness.test.ts).
     */
    maxAccel: 1.6,
    /** Wind is shown and simulated as an integer strength 0..levels. */
    levels: 10,
  },

  online: {
    /** Seconds you get to take your shot (online only). Timeout skips the turn. */
    turnSeconds: 20,
    /** How long a disconnected player has to come back before forfeiting. */
    disconnectGraceSeconds: 30,
    /** Pause between rounds so everyone sees the knockout. */
    betweenRoundsMs: 3200,
    /** Rooms with no activity for this long are deleted. */
    roomExpiryDays: 30,
  },

  feel: {
    headshotFreezeMs: 200,
    shakeHeadshot: 14,
    shakeBody: 7,
    shakeGround: 2,
    /** Misses that pass this close (m) to the opponent trigger slow motion. */
    nearMissDistance: 0.45,
    slowMoScale: 0.3,
    /** Half-width (game seconds) of the slow-motion window around closest approach. */
    slowMoWindow: 0.07,
    /** While aiming, the archer fills this much of the screen height (the opponent is off-screen). */
    closeUp: 0.3,
    /** Aiming straight up lifts the view by this fraction of the screen height (less for lower angles). */
    aimLift: 0.22,
    /** Each round opens on the whole field for this long, then zooms to the shooter. */
    introSeconds: 1.8,
    /** Camera zoom while following the arrow, relative to the close-up. */
    followZoom: 0.8,
    /** Pause on the impact before the camera moves to the next shooter. */
    impactHoldMs: 1000,
  },

  bot: {
    /** Error on the bot's first shot of a round; shrinks each shot as it "adjusts". */
    angleErrorDeg: 5,
    powerError: 0.06,
    learnRate: 0.6,
    thinkMs: 900,
  },
} as const;

export const PALETTE = [
  '#e4572e', // red
  '#2e86ab', // blue
  '#f3a712', // amber
  '#8e5bbf', // purple
  '#e86a92', // pink
  '#17a398', // teal
  '#3b3b4f', // ink
  '#f4f1de', // cream
] as const;
