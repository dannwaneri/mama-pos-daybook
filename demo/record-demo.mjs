// Records the demo on the live app with headless Edge (WebGPU on) via the DevTools screencast.
// Phase 1 (not recorded): open the app, load Gemma (downloads 859 MB once into a saved profile).
// Phase 2 (recorded): reload, load Gemma from cache, paste the 5 redacted alerts, walk the tabs.
// Writes demo/out/frames/*.jpg + demo/out/frames.json (frame times) + demo/out/marks.json (step times).
// Usage: node demo/record-demo.mjs <alerts.txt>
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";

const APP = "https://mama-pos-daybook.pages.dev/";
const PROFILE = process.env.DEMO_PROFILE || new URL("./out/profile", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const OUT = "demo/out", port = 9338;
const alerts = readFileSync(process.argv[2], "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try { await fetch(`http://127.0.0.1:${port}/json/version`); console.error(`Port ${port} busy.`); process.exit(1); } catch {}
rmSync(`${OUT}/frames`, { recursive: true, force: true }); mkdirSync(`${OUT}/frames`, { recursive: true });
const edge = spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", ["--headless=new", `--remote-debugging-port=${port}`,
  `--user-data-dir=${PROFILE}`, "--enable-unsafe-webgpu", "--disable-sync", "--no-first-run", "--disable-extensions",
  "--window-size=1100,820", "about:blank"], { stdio: "ignore" });
let t; for (let i = 0; i < 80 && !t; i++) { await sleep(500); try { t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === "page"); } catch {} }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pend = new Map(); const frames = [];
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id) { pend.get(m.id)?.(m); pend.delete(m.id); return; }
  if (m.method === "Page.screencastFrame") {
    const f = `${OUT}/frames/${String(frames.length).padStart(5, "0")}.jpg`;
    writeFileSync(f, Buffer.from(m.params.data, "base64"));
    frames.push({ f, t: m.params.metadata.timestamp });
    send("Page.screencastFrameAck", { sessionId: m.params.sessionId });
  }
});
const ev = async (x) => (await send("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
const waitFor = async (expr, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return; await sleep(500); } throw new Error("timed out: " + what); };
await send("Page.enable"); await send("Runtime.enable");
// Page at 1100x760 CSS px, drawn at 1.5x for sharp text.
await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 760, deviceScaleFactor: 1.5, mobile: false });

// ---- phase 1: not recorded ----
await send("Page.navigate", { url: APP + "?reset-rows&r=" + Date.now() }); await sleep(5000);
const btn = `[...document.querySelectorAll("#tab-paste button")].find(b => b.textContent.includes("rows"))`;
await ev(`${btn}.click()`); await sleep(200); await ev(`${btn}.click()`); await sleep(500);
await send("Page.navigate", { url: APP + "?r=" + Date.now() }); await sleep(5000);
await ev(`loadModel.click()`);
console.log("phase 1: loading Gemma (first time downloads 859 MB)…");
await waitFor(`/ready|needs a GPU|not loaded/.test(modelState.textContent) && !loadModel.disabled || /ready/.test(modelState.textContent)`, 40 * 60e3, "Gemma load");
const st = await ev(`modelState.textContent`); console.log("phase 1:", st);
if (!/ready.*webgpu/.test(st)) { console.error("Gemma not ready on WebGPU, stop."); process.exit(1); }

// ---- phase 2: recorded ----
await send("Page.navigate", { url: APP + "?r=" + Date.now() }); await sleep(4000);
const marks = {}; const t0 = Date.now() / 1000; const mark = (k) => { marks[k] = Date.now() / 1000 - t0; console.log("mark", k, marks[k].toFixed(1)); };
await send("Page.startScreencast", { format: "jpeg", quality: 88, everyNthFrame: 1 });
mark("start"); await sleep(2500);
mark("load"); await ev(`loadModel.click()`);
await waitFor(`/ready/.test(modelState.textContent)`, 120e3, "ready from cache"); await sleep(2500);
mark("paste"); await ev(`(() => { paste.focus(); paste.value = ${JSON.stringify(alerts)}; })()`); await sleep(1800);
await ev(`add.click()`); await sleep(2500);
mark("reading"); await ev(`document.getElementById("todayTitle").scrollIntoView({ block: "start", behavior: "smooth" })`);
await waitFor(`/^Done\\./.test(addStatus.textContent) || /stopped/.test(addStatus.textContent)`, 300e3, "names");
mark("names_done"); const status = await ev(`addStatus.textContent`); console.log("status:", status);
await ev(`window.scrollTo({ top: 0, behavior: "smooth" })`); await sleep(2500);
await sleep(2000);
mark("jul"); await ev(`(() => { viewDay.value = "2025-07-07"; viewDay.dispatchEvent(new Event("change")); })()`); await sleep(4000);
await ev(`(() => { viewDay.value = "2026-08-13"; viewDay.dispatchEvent(new Event("change")); })()`); await sleep(1500);
mark("land"); await ev(`document.querySelector('nav button[data-tab="land"]').click()`); await sleep(1500);
for (const ch of "10000") { await ev(`(() => { landAmt.value += "${ch}"; })()`); await sleep(220); }
await sleep(600); await ev(`check.click()`); await sleep(5000);
mark("day"); await ev(`document.querySelector('nav button[data-tab="day"]').click()`); await sleep(4000);
await ev(`wa.scrollIntoView({ block: "center", behavior: "smooth" })`); await sleep(4500);
mark("end"); await sleep(1500);
await send("Page.stopScreencast"); await sleep(800);

writeFileSync(`${OUT}/frames.json`, JSON.stringify(frames.map((f) => ({ f: f.f, t: f.t - t0 }))));
writeFileSync(`${OUT}/marks.json`, JSON.stringify({ ...marks, status }, null, 1));
console.log("frames:", frames.length);
await send("Browser.close").catch(() => {}); ws.close(); edge.kill();
