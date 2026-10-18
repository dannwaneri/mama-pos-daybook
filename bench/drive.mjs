// Laptop runner for bench/phone.html: opens it in Edge with #auto and prints window.__results.
// Usage: node bench/drive.mjs [url]   (Node 22+, uses the built-in WebSocket)
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2] || "https://mama-pos-daybook.pages.dev/phone#auto";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const port = 9333;
// An old browser left on this port would silently take the run (18 Oct: a 16 Oct browser did). Refuse instead.
try { await fetch(`http://127.0.0.1:${port}/json/version`); console.error(`Port ${port} is already in use by another browser. Close it first.`); process.exit(1); } catch {}
// Reuse one profile (keeps the model cache); EDGE_PROFILE overrides.
const profile = process.env.EDGE_PROFILE || mkdtempSync(join(tmpdir(), "edge-bench-"));
const edge = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  "--enable-unsafe-webgpu", "--disable-sync", "--no-first-run", "--disable-extensions", "--window-size=500,900", "about:blank"], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 30 && !target; i++) {
  await sleep(500);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch {}
}
if (!target) { console.error("Edge did not start"); edge.kill(); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const evalJs = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true })).result?.result?.value;

// A restored tab may already show this page; changing only the #hash would not reload it.
// A unique ?run= forces a fresh document every time.
const u = new URL(url); u.searchParams.set("run", String(Date.now()));
await send("Page.navigate", { url: u.toString() });
const t0 = Date.now(); let lastStatus = "";
while (Date.now() - t0 < 60 * 60 * 1000) {
  await sleep(5000);
  const st = await evalJs(`JSON.stringify({log: (document.getElementById('log')||{}).textContent?.split(String.fromCharCode(10)).slice(-2), r: window.__results, e: window.__eval})`);
  if (!st) continue;
  const { log, r, e } = JSON.parse(st);
  const line = (log || []).join(" | ");
  if (line !== lastStatus) { console.log(`${Math.round((Date.now() - t0) / 1000)} s  ${line}`); lastStatus = line; }
  if (r && (r.error || (r.runs && r.runs.length === 3))) { console.log(JSON.stringify(r, null, 1)); break; }
  if (e && e.done) { console.log(JSON.stringify(e, null, 1)); break; }
}
await send("Browser.close").catch(() => {}); ws.close(); edge.kill();
