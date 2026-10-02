# Bows & Arrows

A tiny two-archer duel for the browser. Drag back, release, and find the right angle and power. Play the bot, pass one phone around, or send a friend a link: they tap it, type a name, and they're in. No account, no install.

## Play modes

| | |
|---|---|
| **Play a friend** | Creates a match link (`/m/abc123`). Send it in Discord. The link is permanent: refresh, drop out, come back later, rematch as often as you like. The room keeps an all-time tally. |
| **Vs bot** | Solo practice. The bot visibly draws its bow and gets more accurate as it adjusts during a round. |
| **Same screen** | Pass-and-play on one device. |

Games: **Duel** (best of 3; a headshot kills, three body hits kill) and **Apple Shot** (5 arrows each; hit their apple for +1, hit *them* for −1; ties go to sudden-death pairs).

## Run it

```bash
npm install
npm run dev        # game at http://localhost:5173, game server on :8787 (all modes, incl. online)
```

To try online play with two windows, click **Play a friend**, then open the link in a second (private) window. On your local network, `npm run dev` also prints a LAN URL you can open on your phone.

Other scripts:

```bash
npm test           # rules, determinism, wind fairness sweep (fast)
npm run preview    # production build served by the real Worker at http://localhost:8787
npm run e2e        # with `npm run preview` running: full online matches over WebSockets (~70s)
npm run typecheck
```

## Put it online (one-time, ~5 minutes, free)

Online play runs on Cloudflare Workers + Durable Objects. The free plan is enough.

1. Create a free account at <https://dash.cloudflare.com/sign-up>.
2. `npx wrangler login` (opens a browser to authorize).
3. `npm run deploy`

Wrangler prints your URL, e.g. `https://bows-and-arrows.<you>.workers.dev`. Open it, hit **Play a friend**, paste the link in Discord. Each redeploy keeps existing rooms. A custom domain can be added in the Cloudflare dashboard (Workers → your worker → Settings → Domains).

## How it works

```
src/shared/   rules that run identically everywhere
  config.ts     every tunable number (damage, power, wind, distances, timers, feel, bot)
  physics.ts    fixed-timestep (1/120 s) projectile + capsule hit tests
  match.ts      match state + pure transitions: applyShot, skipTurn, nextRound, forfeit, rematch
  modes.ts      game modes as data
  body.ts       stick-man geometry (hitboxes == what's drawn)
  bot.ts        power solver + human-ish error
  protocol.ts   client/server messages
src/client/   canvas renderer, input, camera, effects, synthesized sound, menus
src/server/   Cloudflare Worker + MatchRoom Durable Object (one per link)
```

**Determinism and anti-cheat.** On your turn your device sends only `angle` and `power`. The server (the room's Durable Object) clamps them, converts them to a launch velocity rounded to 1 mm/s, simulates the shot with the shared code, and broadcasts the velocity, the wind and the resulting state. Clients replay the same flight for the animation. After launch the simulation uses only `+ − × ÷ √` (no trig), which is bit-identical across browsers, so both players see exactly the same arrow. The server's state is final either way.

**Timers.** 20 s per turn online (a timeout uses up the shot). If someone disconnects, the match freezes for 30 s and then they forfeit. Reconnecting with the same browser puts you back in your seat, because a per-room token is stored in `localStorage`.

### Wind fairness

Wind changes every turn, but shots come in **pairs** (one per archer), and both shots of a pair get the **same wind relative to the shooter**. If you get a strength-3 tailwind, your opponent's reply also gets a strength-3 tailwind. On screen the flag flips direction between your turn and theirs. Pair strengths come from a seeded sequence (−10…+10), so neither player is systematically favored. The first shooter also alternates every round.

Wind is capped (`wind.maxAccel`) so that full power always reaches the opponent. `tests/fairness.test.ts` checks that a headshot is possible for both archers at every distance (12–26 m), in full headwind, no wind and full tailwind. At the furthest distance into a full headwind, a headshot needs about 86% power. Wind can be turned off from the menu or the lobby.

## Tuning

Everything lives in [`src/shared/config.ts`](src/shared/config.ts): `duel.bodyDamage` (40 → 3 body hits; 50 → 2), `aim.maxSpeed`, `arena.minDistance`/`maxDistance`, `wind.maxAccel`, `online.turnSeconds`, `online.disconnectGraceSeconds`, `apple.*`, `feel.*` (freeze, shake, slow-mo), `bot.*`. Run `npm test` after changing power, distance or wind: the fairness sweep will tell you if a hit became impossible.

## Adding a mode

Add an entry to `MODES` in [`src/shared/modes.ts`](src/shared/modes.ts). A mode declares an apple or not, HP or not, what each hit zone does (`damage` and/or `points`), rounds to win, and an optional shots-per-player limit. Menus, scoreboard, server and bot pick it up automatically. Mechanics that need new behavior (moving targets, arrow types) need a small hook in `match.ts`/`physics.ts`.

## Assumptions made

- "Persists over time" means a **permanent room link**: live matches with reconnect, unlimited rematches, and an all-time head-to-head tally. Rooms are deleted after 30 days of no activity. Asynchronous play (shoot hours apart) isn't built, because it conflicts with the turn timer.
- Your own arrows never hit you.
- The distance is re-rolled every **round**, not just every match, for a little variety inside a best-of-3.
- The angle/power readout shows one decimal, which is exactly the precision that gets sent, so remembering "41.5°, 73.2%" reproduces a shot when the wind and distance are the same.
- Phones work best sideways. Portrait works, smaller, with a gentle "turn your phone" hint.
