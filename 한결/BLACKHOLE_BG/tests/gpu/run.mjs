// Runs the GPU self-test page in Chromium (needs playwright-core and a Chromium build):
//   NODE_PATH=<dir with playwright-core> node tests/gpu/run.mjs [test] [args JSON]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const srv = http.createServer((q, s) => {
  const f = path.join(root, decodeURIComponent(q.url.split("?")[0]));
  fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { "content-type": f.endsWith(".html") ? "text/html" : "text/javascript" }); s.end(d); });
}).listen(0);
const port = srv.address().port;
const exe = process.env.CHROME || `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1255/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const b = await chromium.launch({ executablePath: exe, headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const p = await b.newPage();
p.on("console", (m) => console.error("[page]", m.text()));
p.on("pageerror", (e) => {console.error("[pageerror]", e.message);process.exitCode=1;});
await p.goto(`http://localhost:${port}/${process.env.TEST_PAGE || "tests/gpu/nr-selftest.html"}?manual`);
// 페이지 스크립트(bbh-nr-id.js, bbh-nr.js, window.tests 정의)가 완전히 로드될 때까지 대기
await p.waitForFunction(() => typeof window.tests === "object");
const [name, args] = [process.argv[2] || "staticRHS", JSON.parse(process.argv[3] || "[32]")];
try {
  const r = await p.evaluate(([n, a]) => window.tests[n](...a), [name, args]);
  console.log(JSON.stringify(r, null, 1));
  if (r?.pass === false || (name === "binary" && (r.merged === null || r.nan)) ||
      (name === "single" && (r.shadowT.length !== 4 || r.shadowT.some(x=>Math.abs(x-3*Math.sqrt(3))>0.05*3*Math.sqrt(3))))) process.exitCode = 1;
} catch (e) { console.error("ERROR", e.message); process.exitCode = 1; }
await b.close(); srv.close();
