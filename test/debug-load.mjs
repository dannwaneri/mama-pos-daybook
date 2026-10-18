// Re-run "Load Gemma" in the already-open test browser (port 9336) with console capture.
const port = Number(process.argv[3] || 9336), url = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === "page" && x.url.includes("app-preview"));
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pend = new Map(); const logs = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data);
  if (m.method === "Runtime.consoleAPICalled") logs.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300));
  if (m.method === "Runtime.exceptionThrown") logs.push("[exception] " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
  if (m.method === "Log.entryAdded") logs.push(`[log ${m.params.entry.level}] ` + m.params.entry.text.slice(0, 300));
  pend.get(m.id)?.(m); pend.delete(m.id); });
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const ev = async (x) => (await send("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send("Runtime.enable"); await send("Log.enable");
await send("Page.navigate", { url: url + (url.includes("?") ? "&" : "?") + "run=" + Date.now() }); await sleep(5000);
await ev(`document.getElementById("loadModel").click()`);
for (let i = 0; i < 18; i++) {
  await sleep(10000);
  const s = await ev(`document.getElementById("modelState").textContent + " | " + document.getElementById("dlStatus").textContent + " | " + document.getElementById("addStatus").textContent`);
  console.log(`${(i + 1) * 10} s  ${s}`);
  if (/ready|not loaded/.test(s)) break;
}
console.log("RESOURCES:", await ev(`JSON.stringify(performance.getEntriesByType("resource").map(r => r.name.split("/").slice(-1)[0] + ":" + Math.round(r.duration)).slice(-12))`));
console.log("CONSOLE:\n" + logs.slice(-25).join("\n"));
ws.close();
