// End-to-end on the deployed app with a FRESH profile: tap "Load Gemma" (resumable download), then paste one
// synthetic alert and wait for Gemma's reading. Prints the download log and the row. Usage: node test/app-model.mjs <url>
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const url = process.argv[2], port = 9336, profile = mkdtempSync(join(tmpdir(), "edge-model-"));
const edge = spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--disable-sync", "--no-first-run",
   "--disable-extensions", "--enable-unsafe-webgpu", "--window-size=400,900", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let t; for (let i = 0; i < 30 && !t; i++) { await sleep(500); try { t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === "page"); } catch {} }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pend = new Map(); ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); pend.get(m.id)?.(m); pend.delete(m.id); });
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send("Page.navigate", { url }); await sleep(4000);
await ev(`document.getElementById("loadModel").click()`);
const t0 = Date.now(); let last = "";
while (Date.now() - t0 < 50 * 60 * 1000) {
  await sleep(10000);
  const s = await ev(`document.getElementById("modelState").textContent + " | " + document.getElementById("dlStatus").textContent + " | " + document.getElementById("addStatus").textContent`);
  if (s !== last) { console.log(`${Math.round((Date.now() - t0) / 1000)} s  ${s}`); last = s; }
  if (/ready|not loaded/.test(s)) break;
}
const syn = JSON.parse(readFileSync(new URL("../eval/synthetic.json", import.meta.url), "utf8"));
const now = new Date(Date.now() + 3600e3);
const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][now.getUTCMonth()];
const text = syn[1].text.replace(/16 Oct, 2026/g, `${String(now.getUTCDate()).padStart(2, "0")} ${mon}, ${now.getUTCFullYear()}`);
await ev(`(() => { const p = document.getElementById("paste"); p.value = ${JSON.stringify(text)}; document.getElementById("add").click(); })()`);
for (let i = 0; i < 12; i++) { await sleep(5000); const r = await ev(`document.querySelector("#rows .row")?.textContent || ""`); if (r && !/pending|…/.test(r)) { console.log("ROW:", r); break; } }
console.log("STALLS:", await ev(`localStorage.getItem("pos-daybook-stalls")`));
await send("Browser.close").catch(() => {}); ws.close(); edge.kill(); await sleep(1500); try { rmSync(profile, { recursive: true, force: true }); } catch {}
