// Builds a single self-contained HTML file of the game without online play
// (vs bot + same screen), for hosting anywhere static.
// Usage: node scripts/build-offline.mjs [outFile]
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';

const out = process.argv[2] ?? 'dist-offline/bows-and-arrows.html';
const dir = 'dist-offline/build';
execSync(`npx vite build --base ./ --outDir ${dir}`, { stdio: 'inherit', env: { ...process.env, VITE_OFFLINE: '1' } });
const assets = readdirSync(`${dir}/assets`);
const css = readFileSync(`${dir}/assets/${assets.find((f) => f.endsWith('.css'))}`, 'utf8');
const js = readFileSync(`${dir}/assets/${assets.find((f) => f.endsWith('.js'))}`, 'utf8');
if (js.includes('</script')) throw new Error('inline script would terminate early');
const html = `<title>Bows &amp; Arrows</title>
<style>${css}</style>
<canvas id="game"></canvas>
<div id="hud" hidden></div>
<div id="banner"></div>
<div id="overlay"></div>
<script type="module">${js}</script>
`;
writeFileSync(out, html);
rmSync(dir, { recursive: true, force: true });
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
