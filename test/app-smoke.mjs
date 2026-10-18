// Smoke test of the deployed app WITHOUT the model: paste 3 synthetic alerts (one twice), then
// check rows, "did it land?" and the WhatsApp text. Usage: node test/app-smoke.mjs <url>
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2];
const port = 9334;
const profile = mkdtempSync(join(tmpdir(), "edge-smoke-"));
const edge = spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--disable-sync", "--no-first-run",
   "--disable-extensions", "--window-size=400,900", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 30 && !target; i++) { await sleep(500); try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pend = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); pend.get(m.id)?.(m); pend.delete(m.id); });
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

const syn = JSON.parse(readFileSync(new URL("../eval/synthetic.json", import.meta.url), "utf8"));
// Use today's WAT date so the rows count as "today".
const now = new Date(Date.now() + 3600e3);
const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][now.getUTCMonth()];
const day = String(now.getUTCDate()).padStart(2, "0");
const fix = (t) => t.replace(/16 Oct, 2026/g, `${day} ${mon}, ${now.getUTCFullYear()}`);
const paste = [syn[0], syn[2], syn[0], syn[16]].map((s) => fix(s.text)).join("\n\n");

await send("Page.navigate", { url });
await sleep(4000);
const out = await ev(`(async () => {
  const $ = (id) => document.getElementById(id);
  $("paste").value = ${JSON.stringify(paste)};
  $("add").click(); await new Promise(r => setTimeout(r, 1500));
  const status = $("addStatus").textContent, rows = document.querySelectorAll("#rows .row").length;
  $("landAmt").value = "5150"; $("check").click(); await new Promise(r => setTimeout(r, 500));
  const land = $("landResult").querySelector(".verdict")?.textContent;
  $("landAmt").value = "7000"; $("check").click(); await new Promise(r => setTimeout(r, 500));
  const land2 = $("landResult").querySelector(".verdict")?.textContent;
  $("paste").value = "hello I sent it"; $("add").click(); await new Promise(r => setTimeout(r, 500));
  const bad = $("addStatus").textContent;
  return JSON.stringify({ status, rows, land, land2, bad, wa: $("wa").textContent, overflow: document.documentElement.scrollWidth > innerWidth });
})()`);
console.log(out);
await send("Browser.close").catch(() => {}); ws.close(); edge.kill(); await sleep(1500);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
