import { access, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const analysis = join(root, '경보', 'trueblink');
const marker = join(analysis, 'node_modules', '.sky-lab-lock');
const lock = await readFile(join(analysis, 'package-lock.json'));
const fingerprint = createHash('sha256').update(lock).digest('hex');
const installed = await access(join(analysis, 'node_modules', 'vite', 'bin', 'vite.js')).then(() => true, () => false);
const prior = await readFile(marker, 'utf8').catch(() => '');
if (installed && prior === fingerprint) {
  console.log('TrueBlink dependencies are ready.');
} else {
  console.log('Installing TrueBlink dependencies from package-lock.json…');
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--no-audit', '--no-fund'], {
    cwd: analysis, stdio: 'inherit', shell: process.platform === 'win32', windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
  await writeFile(marker, fingerprint);
}
