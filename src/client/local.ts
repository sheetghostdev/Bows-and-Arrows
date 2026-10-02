import { botShot } from '../shared/bot';
import { CONFIG } from '../shared/config';
import { applyShot, createMatch, nextRound, rematch, type MatchState, type PlayerInfo } from '../shared/match';
import type { ModeId, WallsSetting } from '../shared/modes';
import type { ShotInput } from '../shared/physics';
import { randomSeed } from '../shared/rng';
import type { Driver, GameView } from './game';

/** Same-screen play and vs-bot play: the rules run right here in the browser. */
export class LocalDriver implements Driver {
  state: MatchState;
  readonly bot: number | null;
  private timers: number[] = [];
  private botAngle = 40;

  constructor(
    private view: GameView,
    opts: { modeId: ModeId; windOn: boolean; walls: WallsSetting; players: PlayerInfo[]; bot: number | null },
  ) {
    this.bot = opts.bot;
    this.state = createMatch({ seed: randomSeed(), modeId: opts.modeId, windOn: opts.windOn, walls: opts.walls, players: opts.players });
  }

  start() {
    this.view.setDriver(this);
    this.view.reset(this.state);
  }

  controls(player: number): boolean {
    return player !== this.bot;
  }

  shoot(input: ShotInput) {
    if (this.state.phase !== 'aim' || !this.controls(this.state.turn)) return;
    this.fire(input);
  }

  private fire(input: ShotInput) {
    const r = applyShot(this.state, input);
    this.state = r.state;
    this.view.push({ kind: 'shot', shot: r.shot, state: r.state });
  }

  idle(s: MatchState) {
    if (s.seq !== this.state.seq) return;
    if (s.phase === 'roundOver') {
      this.later(() => {
        this.state = nextRound(this.state);
        this.view.push({ kind: 'state', state: this.state });
      }, CONFIG.online.betweenRoundsMs);
    } else if (s.phase === 'aim' && s.turn === this.bot) {
      this.botTurn();
    }
  }

  /** The bot "thinks", visibly draws its bow, then fires. */
  private botTurn() {
    const bot = this.bot!;
    const seq = this.state.seq;
    if (this.state.shots[bot] === 0) this.botAngle = 28 + Math.random() * 27;
    const input = botShot(this.state, bot, this.botAngle);
    const drawMs = 650;
    this.later(() => {
      const t0 = performance.now();
      const tick = () => {
        if (this.state.seq !== seq) return;
        const k = Math.min(1, (performance.now() - t0) / drawMs);
        const e = 1 - Math.pow(1 - k, 2);
        this.view.setRemoteAim(bot, { angle: input.angle, power: input.power * e });
        if (k < 1) this.later(tick, 16);
        else
          this.later(() => {
            if (this.state.seq !== seq) return;
            // Moving target: re-solve for where it actually is at the moment of release.
            const moving = this.state.targets.some((t) => t.kind === 'mover');
            this.fire(moving ? botShot(this.state, bot, this.botAngle, this.view.sweepPhase) : input);
          }, 180);
      };
      tick();
    }, CONFIG.bot.thinkMs);
  }

  rematch() {
    this.clear();
    this.state = rematch(this.state, randomSeed());
    this.view.push({ kind: 'state', state: this.state });
  }

  dispose() {
    this.clear();
    this.view.setDriver(null);
  }

  private later(fn: () => void, ms: number) {
    this.timers.push(window.setTimeout(fn, ms));
  }

  private clear() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }
}
