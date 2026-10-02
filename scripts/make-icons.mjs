// Renders the app icons (public/icon-*.png, apple-touch-icon.png) from code-drawn shapes.
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fd3ec"/><stop offset="1" stop-color="#e8f6fb"/></linearGradient></defs>
  <rect width="100" height="100" fill="url(#g)"/>
  <path d="M0 78 Q50 70 100 78 V100 H0z" fill="#8cc56f"/>
  <g stroke-linecap="round" fill="none">
    <line x1="30" y1="76" x2="30" y2="52" stroke="#e4572e" stroke-width="7"/>
    <line x1="30" y1="76" x2="24" y2="88" stroke="#e4572e" stroke-width="6"/>
    <line x1="30" y1="76" x2="36" y2="88" stroke="#e4572e" stroke-width="6"/>
    <line x1="30" y1="56" x2="44" y2="48" stroke="#e4572e" stroke-width="5"/>
    <path d="M38 34 Q54 44 46 62" stroke="#5b3a1e" stroke-width="3"/>
    <line x1="44" y1="48" x2="86" y2="22" stroke="#3b3b4f" stroke-width="3"/>
    <path d="M86 22 l-9 1 M86 22 l-4 8" stroke="#3b3b4f" stroke-width="3"/>
  </g>
  <circle cx="30" cy="44" r="7" fill="#e4572e"/>
</svg>`;
for (const [file, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0">${svg(size)}</body>`);
  await page.screenshot({ path: `public/${file}`, clip: { x: 0, y: 0, width: size, height: size } });
}
await browser.close();
console.log('icons written');
