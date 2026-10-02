// Scripted perfect shots against the dev server to eyeball headshots, KOs, Apple Shot and game over.
// Usage: node scripts/smoke-feel.mjs [baseUrl] [outDir]
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = process.argv[3] ?? 'test-results';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

/** Fire a solved shot for whoever's turn it is. yOffset aims above/below the target point. */
const shoot = (yOffset = 0, angle = 38) =>
  page.evaluate(
    ([yOffset, angle]) => {
      const { bot, local, view } = window.__ba;
      const d = local();
      const s = d.state;
      if (s.targets.some((t) => t.kind === 'mover')) {
        const phase = view.sweepPhase;
        d.shoot({ angle, power: bot.solveLead(s, s.turn, angle, phase), phase });
        return;
      }
      const t = bot.aimPoint(s, s.turn);
      const power = bot.solvePower(s, s.turn, angle, t.x, t.y + yOffset);
      d.shoot({ angle, power });
    },
    [yOffset, angle],
  );

await page.goto(base);
await page.waitForFunction(() => !!window.__ba);
await page.getByText('Duel').click();
await page.getByText('Same screen').click();
await page.waitForTimeout(2600);
await shoot(-0.45); // body shot
await page.waitForTimeout(1600);
await page.screenshot({ path: `${out}/f1-body-hit.png` });
await page.waitForTimeout(2000);
await shoot(0); // headshot by player 2
const t0 = Date.now();
await page.waitForTimeout(1250);
await page.screenshot({ path: `${out}/f2-headshot.png` });
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/f3-ko.png` });
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/f3b-ragdoll-settled.png` });
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/f4-round-banner.png` });
await page.waitForTimeout(4900);
// Round 2: headshot ends the match.
await shoot(0);
await page.waitForTimeout(5000);
await page.screenshot({ path: `${out}/f5-game-over.png` });
// Near miss slow-mo: aim just above the head.
await page.getByText('Rematch').click();
await page.waitForTimeout(2600);
await shoot(0.5);
await page.waitForTimeout(1350);
await page.screenshot({ path: `${out}/f6-near-miss.png` });

// Apple Shot
await page.goto(base);
await page.waitForFunction(() => !!window.__ba);
await page.getByText('Apple Shot').click();
await page.getByText('Same screen').click();
await page.waitForTimeout(2600);
await page.screenshot({ path: `${out}/f7-apple-start.png` });
await shoot(0);
await page.waitForTimeout(1250);
await page.screenshot({ path: `${out}/f8-apple-hit.png` });

// Balloons
await page.goto(base);
await page.waitForFunction(() => !!window.__ba);
await page.getByText('Balloons').click();
await page.getByText('Same screen').click();
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/f9-balloons-intro.png` });
await page.waitForTimeout(2000);
await page.screenshot({ path: `${out}/f10-balloons-aim.png` });
await shoot(0);
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/f11-balloon-pop.png` });
await page.waitForTimeout(2600);
await page.screenshot({ path: `${out}/f12-next-shooter.png` });
// Ladder
const modeRun = async (name, prefix) => {
  await page.goto(base);
  await page.waitForFunction(() => !!window.__ba);
  await page.getByText(name, { exact: true }).click();
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${out}/${prefix}-menu.png` });
  await page.getByText('Same screen').click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/${prefix}-intro.png` });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${out}/${prefix}-aim.png` });
  await shoot(0);
  await page.waitForTimeout(1100);
  await page.screenshot({ path: `${out}/${prefix}-hit.png` });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${out}/${prefix}-after.png` });
};
await modeRun('Ladder', 'g1');
await modeRun('Moving Target', 'g2');

console.log(errors.length ? errors.join('\n') : 'no errors', Date.now() - t0);
await browser.close();
