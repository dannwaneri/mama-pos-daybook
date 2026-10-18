// Browser check: can a page on our origin HEAD the model file and fetch one 8 MB Range piece from Hugging Face?
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const port = 9335, profile = mkdtempSync(join(tmpdir(), "edge-cors-"));
const edge = spawn("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--disable-sync", "--no-first-run", "--disable-extensions", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let t; for (let i = 0; i < 30 && !t; i++) { await sleep(500); try { t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === "page"); } catch {} }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pend = new Map(); ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); pend.get(m.id)?.(m); pend.delete(m.id); });
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
await send("Page.navigate", { url: "https://app-preview.mama-pos-daybook.pages.dev/" }); await sleep(3000);
const r = await send("Runtime.evaluate", { awaitPromise: true, returnByValue: true, expression: `(async () => {
  const u = "https://huggingface.co/onnx-community/gemma-3-1b-it-ONNX/resolve/main/onnx/model_q4.onnx_data";
  const out = {};
  try { const h = await fetch(u, { method: "HEAD" }); out.head = { status: h.status, length: h.headers.get("content-length") }; } catch (e) { out.head = "ERR " + e.message; }
  try { const t0 = performance.now(); const g = await fetch(u, { headers: { Range: "bytes=0-8388607" } }); const b = await g.blob();
        out.range = { status: g.status, bytes: b.size, s: ((performance.now() - t0) / 1000).toFixed(1) }; } catch (e) { out.range = "ERR " + e.message; }
  return JSON.stringify(out); })()` });
console.log(r.result?.result?.value);
await send("Browser.close").catch(() => {}); ws.close(); edge.kill(); await sleep(1500); try { rmSync(profile, { recursive: true, force: true }); } catch {}
