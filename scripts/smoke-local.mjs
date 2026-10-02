// Drives the local (vs bot) game in headless Chromium and saves screenshots.
// Usage: node scripts/smoke-local.mjs [baseUrl] [outDir]
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = process.argv[3] ?? 'test-results';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: false });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(base);
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/01-home.png` });
await page.getByText('Vs bot').click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/02-game.png` });

// Drag back (down-left) from the middle of the screen.
const drag = async (dx, dy, shotName) => {
  await page.mouse.move(420, 200);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(420 + (dx * i) / 10, 200 + (dy * i) / 10);
  await page.waitForTimeout(250);
  if (shotName) await page.screenshot({ path: `${out}/${shotName}-aim.png` });
  await page.mouse.up();
};
await drag(-110, 95, '03');
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/04-flight.png` });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/05-landed.png` });
await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}/06-bot-turn.png` });
await page.waitForTimeout(2000);
await page.screenshot({ path: `${out}/07-my-second-turn.png` });
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
