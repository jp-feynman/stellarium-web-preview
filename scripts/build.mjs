import { access, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist');
const staging = join(root, `.site-building-${process.pid}`);
const previous = join(root, `.site-previous-${process.pid}`);
const marker = '.spherex-sky-lab-build.json';
const planetarium = join(root, '중선', 'v1.2.0');
const analysis = join(root, '경보', 'trueblink');
const entrance = join(root, '한결', 'BLACKHOLE_BG');
const exists = async path => access(path).then(() => true, () => false);

function childPath(path) {
  const absolute = resolve(path);
  if (dirname(absolute) !== root || !absolute.startsWith(root + sep)) throw new Error(`Unsafe build path: ${path}`);
  return absolute;
}

async function verifyGenerated(path) {
  childPath(path);
  const data = JSON.parse(await readFile(join(path, marker), 'utf8'));
  if (data.project !== 'spherex-sky-lab') throw new Error(`Unrecognized output directory: ${path}`);
}

function run(script, cwd, args = [], extraEnv = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd, stdio: 'inherit', env: { ...process.env, ...extraEnv }, windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Build step failed (${result.status}): ${script}`);
}

if (await exists(output)) await verifyGenerated(output);
if (await exists(staging) || await exists(previous)) throw new Error('This build has an unfinished staging directory. Inspect it before retrying.');
if (!(await exists(join(analysis, 'node_modules', 'vite', 'bin', 'vite.js')))) throw new Error('Run npm run setup first to install the analysis dependencies.');

run(join(planetarium, 'scripts', 'build.mjs'), planetarium);
run(join(analysis, 'node_modules', 'typescript', 'bin', 'tsc'), analysis, ['--noEmit']);
run(join(analysis, 'node_modules', 'vite', 'bin', 'vite.js'), analysis, ['build'], {
  VITE_API_BASE: process.env.VITE_API_BASE || '../api',
  VITE_SKY_APP_URL: '../planetarium/',
});

await mkdir(staging);
try {
  // Only the entrance and its renderer assets belong at the public root, not the demo/test files.
  const landingAssets = (await readdir(entrance, { withFileTypes: true }))
    .filter(entry => entry.isFile() && (entry.name === 'index.html' || ['.js', '.css', '.webp', '.png', '.jpg', '.svg', '.woff2'].includes(extname(entry.name))))
    .map(entry => entry.name);
  if (!landingAssets.includes('index.html')) throw new Error('The entrance index.html is missing.');
  for (const name of landingAssets) await cp(join(entrance, name), join(staging, name));
  await cp(join(planetarium, 'dist'), join(staging, 'planetarium'), { recursive: true });
  await cp(join(analysis, 'dist'), join(staging, 'analysis'), { recursive: true });
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'AI_USE.md']) {
    await cp(join(analysis, name), join(staging, 'analysis', name));
  }
  await cp(join(root, 'README.md'), join(staging, 'README.md'));
  await writeFile(join(staging, '.nojekyll'), '');
  await writeFile(join(staging, marker), JSON.stringify({ project: 'spherex-sky-lab', version: '2.2.0', builtAt: new Date().toISOString() }, null, 2) + '\n');
  for (const required of ['index.html', 'planetarium/index.html', 'analysis/index.html', 'planetarium/engine/stellarium-web-engine.wasm']) {
    if (!(await exists(join(staging, required)))) throw new Error(`Missing combined output: ${required}`);
  }

  // Keep the previous complete build until the replacement has been assembled successfully.
  if (await exists(output)) {
    await verifyGenerated(output);
    await rename(childPath(output), childPath(previous));
  }
  try { await rename(childPath(staging), childPath(output)); }
  catch (error) {
    if (await exists(previous)) await rename(childPath(previous), childPath(output));
    throw error;
  }
  if (await exists(previous)) {
    await verifyGenerated(previous);
    await rm(childPath(previous), { recursive: true });
  }
  let files = 0;
  let bytes = 0;
  async function count(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await count(path);
      else { files++; bytes += (await stat(path)).size; }
    }
  }
  await count(output);
  console.log(`SPHEREx Sky Lab v2.2.0 built: ${files} files, ${(bytes / 1048576).toFixed(1)} MiB.\nRun npm run preview, then open the printed local URL.`);
} catch (error) {
  console.error(`The last successful build is preserved. Inspect incomplete output at ${staging}.`);
  throw error;
}
