// Two browsers play online against `npm run preview` (http://localhost:8787).
// Usage: node scripts/smoke-online.mjs [baseUrl] [outDir]
import { chromium, devices } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:8787';
const out = process.argv[3] ?? 'test-results';
const browser = await chromium.launch();
const errors = [];
const mk = async (opts) => {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return { ctx, page };
};

// Host on a desktop-ish window, guest on an emulated phone (landscape, touch).
const host = await mk({ viewport: { width: 1000, height: 560 } });
const phone = devices['iPhone 13 landscape'] ?? { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true };
const guest = await mk({ ...phone });

await host.page.goto(base);
await host.page.getByText('Play a friend').click();
await host.page.getByPlaceholder('Your name').fill('Alice');
await host.page.getByText('Create match').click();
await host.page.waitForTimeout(800);
await host.page.screenshot({ path: `${out}/o1-host-lobby.png` });
const url = host.page.url();
console.log('room url', url);

await guest.page.goto(url);
await guest.page.waitForTimeout(500);
await guest.page.screenshot({ path: `${out}/o2-guest-join.png` });
await guest.page.getByPlaceholder('Your name').fill('Bob');
await guest.page.locator('.swatch').nth(1).tap();
await guest.page.getByText('Join', { exact: true }).tap();
await guest.page.waitForTimeout(800);
await host.page.screenshot({ path: `${out}/o3-host-ready.png` });
await guest.page.screenshot({ path: `${out}/o4-guest-waiting.png` });

await host.page.getByText('Start', { exact: true }).click();
await host.page.waitForTimeout(1200);

// Host aims (mouse), and the guest should see the bow being drawn.
await host.page.mouse.move(500, 300);
await host.page.mouse.down();
for (let i = 1; i <= 8; i++) await host.page.mouse.move(500 - 14 * i, 300 + 11 * i);
await host.page.waitForTimeout(400);
await guest.page.screenshot({ path: `${out}/o5-guest-sees-aim.png` });
await host.page.mouse.up();
await host.page.waitForTimeout(600);
await guest.page.screenshot({ path: `${out}/o6-guest-flight.png` });
await host.page.waitForTimeout(4000);
await guest.page.screenshot({ path: `${out}/o7-guest-turn.png` });

// Guest shoots with a touch drag via CDP touch events.
const cdp = await guest.ctx.newCDPSession(guest.page);
const touch = async (type, x, y) =>
  cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
await touch('touchStart', 420, 200);
for (let i = 1; i <= 8; i++) await touch('touchMove', 420 + 15 * i, 200 + 12 * i);
await guest.page.waitForTimeout(300);
await guest.page.screenshot({ path: `${out}/o8-guest-aiming-touch.png` });
await touch('touchEnd', 0, 0);
await guest.page.waitForTimeout(5000);
await host.page.screenshot({ path: `${out}/o9-host-after-guest-shot.png` });

// Guest drops: host sees the pause.
await guest.ctx.close();
await host.page.waitForTimeout(1500);
await host.page.screenshot({ path: `${out}/o10-host-paused.png` });

console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
