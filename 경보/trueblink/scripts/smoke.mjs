// AI-assisted code (Claude) written during NASA Space Apps Challenge 2026. See AI_USE.md.
//
// Post-deployment smoke test. No dependencies; Node 18+.
//   npm run smoke -- https://<project>.pages.dev
//   node scripts/smoke.mjs http://localhost:4173 --relay http://localhost:8787/api   (relay on another host)
//   node scripts/smoke.mjs https://<user>.github.io/trueblink/ --no-relay           (static-only fallback)
// It checks: the page, a baked exposure list, a baked pixel bundle, the SIA relay's self-description,
// one real exposure search through the relay, and one Range request to the SPHEREx S3 bucket.
// Prints one PASS / FAIL / SKIP line per check and exits 1 if any check failed.

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--relay'));
if (!positional[0] || flag('--help')) {
  console.log('Usage: node scripts/smoke.mjs <site url> [--relay <relay api base>] [--no-relay]');
  process.exit(positional[0] ? 0 : 2);
}

const site = positional[0].replace(/\/*$/, '/');
const noRelay = flag('--no-relay');
const relayBase = (option('--relay') ?? new URL('api', site).href).replace(/\/+$/, '');
const TIMEOUT_MS = 30000;
const HEADERS = { 'User-Agent': 'smoke-check/1.0' };

const results = [];
function report(status, name, detail) {
  results.push(status);
  console.log(`${status.padEnd(4)}  ${name}${detail ? ` - ${detail}` : ''}`);
}

async function get(url, init = {}) {
  const t0 = Date.now();
  const res = await fetch(url, { ...init, headers: { ...HEADERS, ...(init.headers || {}) }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  return { res, ms: Date.now() - t0 };
}

async function check(name, fn) {
  try {
    const detail = await fn();
    report('PASS', name, detail);
  } catch (err) {
    const msg = err?.name === 'TimeoutError' ? `no answer within ${TIMEOUT_MS / 1000} s` : err instanceof Error ? err.message : String(err);
    report('FAIL', name, msg);
  }
}

function looksLikeHtml(text) {
  return /^\s*</.test(text) && /<html|<!doctype/i.test(text.slice(0, 500));
}

let s3Key = null;
let collections = [];

console.log(`Checking ${site}${noRelay ? ' (no relay)' : `  relay: ${relayBase}`}\n`);

await check('The page opens', async () => {
  const { res, ms } = await get(site);
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  if (!/<script\b[^>]*type="module"/i.test(html)) throw new Error('the answer is not the built app (no module script); is the output directory dist?');
  if (/src="\/src\/main/.test(html)) throw new Error('this is the development index.html, not the build in dist/');
  return `HTTP 200, ${html.length} bytes, ${ms} ms`;
});

await check("Baked exposure list (presets/barnard.json)", async () => {
  const { res, ms } = await get(new URL('presets/barnard.json', site));
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (looksLikeHtml(text)) throw new Error('got an HTML page instead of JSON: public/presets was not deployed');
  const data = JSON.parse(text);
  const n = Array.isArray(data.exposures) ? data.exposures.length : 0;
  if (!n) throw new Error('the list has no exposures');
  s3Key = data.exposures.find((e) => typeof e.s3Key === 'string')?.s3Key ?? null;
  return `${n} exposures, baked ${String(data.generated).slice(0, 10)}, ${ms} ms`;
});

await check('Baked pixel bundle (presets/barnard.bundle.json and .bin)', async () => {
  const { res, ms } = await get(new URL('presets/barnard.bundle.json', site));
  if (res.status !== 200) throw new Error(`manifest HTTP ${res.status}`);
  const text = await res.text();
  if (looksLikeHtml(text)) throw new Error('got an HTML page instead of the manifest');
  const manifest = JSON.parse(text);
  if (manifest.format !== 'trueblink-pixel-bundle') throw new Error(`unexpected manifest format ${manifest.format}`);
  const bin = await get(new URL('presets/barnard.bundle.bin', site));
  if (bin.res.status !== 200) throw new Error(`binary HTTP ${bin.res.status}`);
  const bytes = new Uint8Array(await bin.res.arrayBuffer());
  if (bytes[0] === 0x3c) throw new Error('got an HTML page instead of the binary');
  // Either still gzip (1f 8b) or already decoded by the host (then it must be the full size).
  const gz = bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!gz && bytes.length !== manifest.binaryBytes) throw new Error(`binary has ${bytes.length} bytes, expected gzip or ${manifest.binaryBytes}`);
  return `${manifest.cutouts?.length ?? '?'} cutouts, ${(bytes.length / 1048576).toFixed(1)} MB binary, ${ms + bin.ms} ms`;
});

if (noRelay) {
  report('SKIP', 'Relay self-description', '--no-relay: only the five challenge targets will open');
  report('SKIP', 'Exposure search through the relay', '--no-relay');
} else {
  await check('Relay answers /api/sia?MAXREC=0 with the SPHEREx collections', async () => {
    const { res, ms } = await get(`${relayBase}/sia?MAXREC=0`, { headers: { Origin: 'https://smoke.example' } });
    const text = await res.text();
    if (looksLikeHtml(text)) throw new Error('got the app page instead of the relay: the Functions folder was not deployed (or set --relay)');
    if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${text.slice(0, 160).trim()}`);
    if (res.headers.get('access-control-allow-origin') !== '*') throw new Error('no Access-Control-Allow-Origin: * header; browsers on other origins will be blocked');
    collections = [...new Set([...text.matchAll(/value="(spherex_(?:dr|qr)\d+)"/g)].map((m) => m[1]))];
    if (!collections.length) throw new Error('the answer names no spherex_ collection');
    return `${collections.join(', ')}; ${ms} ms`;
  });

  await check('Exposure search through the relay (WISE 0855-0714)', async () => {
    const collection = collections.find((c) => c.startsWith('spherex_dr')) ?? collections[0] ?? 'spherex_dr1';
    const url = `${relayBase}/sia?COLLECTION=${collection}&POS=circle+133.7595+-7.2422+0.001&RESPONSEFORMAT=CSV`;
    const { res, ms } = await get(url);
    const text = await res.text();
    if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${text.slice(0, 160).trim()}`);
    const lines = text.trim().split('\n');
    if (!/access_url/.test(lines[0])) throw new Error('the answer is not an SIA CSV table');
    if (lines.length < 2) throw new Error('no exposures found');
    const cache = res.headers.get('cache-control');
    return `${lines.length - 1} rows from ${collection}, ${ms} ms, Cache-Control: ${cache}`;
  });
}

await check('SPHEREx S3 bucket answers a Range request (from this network)', async () => {
  const key = s3Key ?? 'dr1/level2/2025W33_2C/l2b-v27-2026-228/3/level2_2025W33_2C_0321_1D3_spx_l2b-v27-2026-228.fits';
  const url = `https://nasa-irsa-spherex.s3.amazonaws.com/${key.split('/').map(encodeURIComponent).join('/')}`;
  const { res, ms } = await get(url, { headers: { Range: 'bytes=0-2879', Origin: 'https://smoke.example' } });
  if (res.status !== 206) throw new Error(`HTTP ${res.status} (expected 206 Partial Content)`);
  const head = Buffer.from(await res.arrayBuffer()).toString('latin1', 0, 30);
  if (!head.startsWith('SIMPLE  =')) throw new Error('the bytes are not a FITS header');
  return `206, FITS header, CORS ${res.headers.get('access-control-allow-origin') ?? 'missing'}, ${ms} ms`;
});

const failed = results.filter((r) => r === 'FAIL').length;
console.log(failed ? `\n${failed} check(s) FAILED.` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
