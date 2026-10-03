// Builds the no-server version (vs bot + same screen) into docs/ for GitHub Pages.
// Usage: node scripts/build-pages.mjs [publicUrl]
// Then: repo Settings → Pages → Deploy from a branch → <branch> / docs.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const url = (process.argv[2] ?? 'https://sheetghostdev.github.io/Bows-and-Arrows/').replace(/\/?$/, '/');
execSync('npx vite build --base ./ --outDir docs', { stdio: 'inherit', env: { ...process.env, VITE_OFFLINE: '1' } });

// Link previews need absolute URLs, and this version is "play the bot / pass the phone", not a challenge link.
let html = readFileSync('docs/index.html', 'utf8');
html = html
  .replace('content="./og.png"', `content="${url}og.png"`)
  .replace("content=\"Bows & Arrows: you've been challenged!\"", 'content="Bows & Arrows"')
  .replace('content="Tap to join the duel. No install, no account."', 'content="A tiny archery duel. Play the bot or pass the phone. No install, no account."')
  .replace('</head>', `  <meta property="og:url" content="${url}" />\n  </head>`);
writeFileSync('docs/index.html', html);
// Serve files as-is (no Jekyll processing).
writeFileSync('docs/.nojekyll', '');
console.log(`docs/ ready for ${url}`);
