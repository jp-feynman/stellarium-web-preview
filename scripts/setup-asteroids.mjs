import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const environment = join(root, '.venv-asteroid');
const python = join(environment, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const requirements = join(root, '지호', 'spherex-asteroid-analysis', 'requirements.txt');
const lockedRequirements = join(root, '지호', 'spherex-asteroid-analysis', 'requirements-web.lock.txt');
const installRequirements = existsSync(lockedRequirements) ? lockedRequirements : requirements;
const marker = join(environment, '.sky-lab-requirements');
const fingerprint = createHash('sha256').update(readFileSync(requirements)).update('\0')
  .update(installRequirements === lockedRequirements ? readFileSync(lockedRequirements) : 'unlocked').digest('hex');
const env = { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1', MPLBACKEND: 'Agg' };

function run(executable, args, { quiet = false } = {}) {
  const result = spawnSync(executable, args, { cwd: root, env, shell: false, windowsHide: true,
    stdio: quiet ? 'pipe' : 'inherit', encoding: quiet ? 'utf8' : undefined });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(quiet ? (result.stderr?.trim() || `Python exited with code ${result.status}.`) : `Command exited with code ${result.status}.`);
  return result;
}

try {
  if (!existsSync(python)) {
    const candidates = process.env.SPHEREX_PYTHON ? [[process.env.SPHEREX_PYTHON, []]]
      : [...(process.platform === 'win32' ? [['py', ['-3']]] : []), ['python', []], ['python3', []]];
    let selected;
    for (const [executable, args] of candidates) {
      try {
        run(executable, [...args, '-c', 'import sys; assert sys.version_info >= (3,11), "Python 3.11 or newer required"'], { quiet: true });
        selected = { executable, args }; break;
      } catch { /* Try the next available Python launcher. */ }
    }
    if (!selected) throw new Error('Install Python 3.11 or newer, then run npm run setup:asteroids again.');
    console.log('Creating the project-only asteroid Python environment…');
    run(selected.executable, [...selected.args, '-m', 'venv', environment]);
  }
  const modules = 'import numpy, scipy, pandas, astropy, astroquery, matplotlib, sklearn, sbpy, synphot, yaml, requests, streamlit';
  let ready = false;
  if (existsSync(marker) && readFileSync(marker, 'utf8').trim() === fingerprint) {
    try { run(python, ['-X', 'utf8', '-B', '-c', modules], { quiet: true }); ready = true; } catch { /* Repair this dedicated environment. */ }
  }
  if (!ready) {
    console.log('Installing asteroid analysis dependencies in .venv-asteroid…');
    run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', installRequirements]);
    run(python, ['-X', 'utf8', '-B', '-c', modules], { quiet: true });
    mkdirSync(environment, { recursive: true });
    writeFileSync(marker, fingerprint + '\n');
  }
  console.log('Asteroid dependencies are ready. Start the website and use the Asteroid tab.');
} catch (error) {
  console.error(`Asteroid setup failed: ${error.message}`);
  process.exitCode = 1;
}
