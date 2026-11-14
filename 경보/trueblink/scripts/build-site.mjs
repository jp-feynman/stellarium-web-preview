// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Build the combined site: TrueBlink at the root and, when it has been built, the separate sky app
// (Stellarium Web Lab + SPHEREx, AGPL-3.0, its own program) under /sky/.
//   npm run build:site                      (runs "npm run build", then copies the sky app)
//   node scripts/build-site.mjs --no-build  (only copy the sky app into an existing dist/)
// The sky app is taken from SKYLAB_DIST (env) or ../skylab-spherex/dist (build it there first with
// "node scripts/build.mjs"). Without it, dist/ stays TrueBlink only and the "live sky" link hides itself.
// Prints file counts, total size and the largest files, and warns at the Cloudflare Pages limits
// (25 MiB per file, 20,000 files per deployment).
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const SKY_SRC = resolve(process.env.SKYLAB_DIST || join(ROOT, '..', 'skylab-spherex', 'dist'));
const SKY_DEST = join(DIST, 'sky');
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 20000;

const mib = (n) => `${(n / 1048576).toFixed(2)} MiB`;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (st.isFile()) out.push({ path: p, size: st.size });
  }
  return out;
}

if (!process.argv.includes('--no-build')) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    console.error('build-site: "npm run build" failed.');
    process.exit(r.status ?? 1);
  }
}
if (!existsSync(join(DIST, 'index.html'))) {
  console.error('build-site: dist/index.html is missing; run without --no-build.');
  process.exit(1);
}

if (existsSync(SKY_DEST)) rmSync(SKY_DEST, { recursive: true, force: true });
if (!existsSync(join(SKY_SRC, 'index.html')) || !statSync(SKY_SRC).isDirectory()) {
  console.log(`build-site: sky app not found at ${SKY_SRC} (no index.html). dist/ is TrueBlink only.`);
  console.log('  Build it with: cd ../skylab-spherex && node scripts/build.mjs   (or set SKYLAB_DIST=<its dist folder>)');
} else {
  cpSync(SKY_SRC, SKY_DEST, { recursive: true, dereference: false, filter: (src) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(src) });
  const sky = walk(SKY_DEST);
  const skyBytes = sky.reduce((a, f) => a + f.size, 0);
  console.log(`build-site: copied the sky app from ${SKY_SRC} to dist/sky/: ${sky.length} files, ${mib(skyBytes)}.`);
  console.log('  Largest files:');
  for (const f of [...sky].sort((a, b) => b.size - a.size).slice(0, 8)) {
    console.log(`    ${mib(f.size).padStart(11)}  ${relative(DIST, f.path).replace(/\\/g, '/')}`);
  }
}

const all = walk(DIST);
const total = all.reduce((a, f) => a + f.size, 0);
const tooBig = all.filter((f) => f.size > MAX_FILE_BYTES);
console.log(`build-site: dist/ now holds ${all.length} files, ${mib(total)}.`);
let ok = true;
for (const f of tooBig) {
  ok = false;
  console.error(`  TOO LARGE for Cloudflare Pages (25 MiB per file): ${relative(DIST, f.path)} ${mib(f.size)}`);
}
if (all.length > MAX_FILES) {
  ok = false;
  console.error(`  TOO MANY FILES for Cloudflare Pages: ${all.length} > ${MAX_FILES}`);
}
if (!ok) process.exit(2);
