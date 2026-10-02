// Renders the link-preview card (public/og.png) from the live home screen.
// Usage: node scripts/make-og.mjs [baseUrl]
import { chromium } from 'playwright';
const base = process.argv[2] ?? 'http://localhost:5173';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(base);
await page.waitForTimeout(600);
// Keep the title, drop the menu controls: the card is an invitation, not a UI.
await page.evaluate(() => {
  const panel = document.querySelector('.panel');
  panel.querySelectorAll('.row, .seg, .btn.big').forEach((n) => n.remove());
  const tag = document.createElement('p');
  tag.className = 'sub';
  tag.textContent = "You've been challenged to a duel. Tap to join.";
  panel.append(tag);
  panel.style.width = '640px';
  panel.style.transform = 'translateY(-90px)';
});
await page.waitForTimeout(400);
await page.screenshot({ path: 'public/og.png' });
await browser.close();
