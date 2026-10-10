// Builds the deployable site into _site/ with cache-busted URLs.
// GitHub Pages caches files for 10 minutes; without versioned URLs a browser can combine a new
// index.html with old JavaScript modules (e.g., a new menu link whose page the old router
// doesn't know). Every module import and asset URL gets ?v=<version> so each deploy is atomic.
// Usage: node scripts/build-site.mjs [version]
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '_site');
const version = (process.argv[2] || process.env.GITHUB_SHA || Date.now().toString(36)).slice(0, 12);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const p of ['index.html', 'css', 'js', 'assets', '.nojekyll']) cpSync(join(root, p), join(out, p), { recursive: true });

// Relative module specifiers in static import/export statements.
const SPEC = /(\b(?:import|export)\b[^'"]*?\bfrom\s*|\bimport\s*)(['"])(\.{1,2}\/[^'"?]+\.js)\2/g;
let files = 0;
let rewrites = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) {
      const src = readFileSync(p, 'utf8');
      const next = src.replace(SPEC, (_m, pre, q, spec) => { rewrites += 1; return `${pre}${q}${spec}?v=${version}${q}`; });
      writeFileSync(p, next);
      files += 1;
    }
  }
}
walk(join(out, 'js'));

let html = readFileSync(join(out, 'index.html'), 'utf8');
html = html
  .replace('src="js/app.js"', `src="js/app.js?v=${version}"`)
  .replace('href="css/styles.css"', `href="css/styles.css?v=${version}"`)
  .replace('<head>', `<head>\n  <meta name="app-version" content="${version}">`);
writeFileSync(join(out, 'index.html'), html);
console.log(`Built _site/ (version ${version}): ${files} modules, ${rewrites} imports versioned.`);
