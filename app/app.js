// POS Day-book: paste alerts -> rows + kind (code) -> customer's name (local Gemma, guarded) -> did it land / end of day (code).
// Everything stays on the phone (IndexedDB). The only network use is the first load and the one-time model download.
import { parseMoniepoint, alertId, ParseError } from "./src/parse.js";
import { readAlert, modelFailed } from "./src/classify.js";
import { didItLand, endOfDay, whatsappText, naira, watDate } from "./src/daybook.js";

// Gemma 3 1B q4: 270M failed every prompt; 1B got 23/30 kinds, 19/30 names on the synthetic set (bench/RESULTS.md, run 5).
// q4 runs only on WebGPU (on the CPU engine: "no implementation for GatherBlockQuantized", run 7); int8 runs on the CPU.
const MODEL = { id: "onnx-community/gemma-3-1b-it-ONNX", dtype: { webgpu: "q4", wasm: "int8" },
  // q4 ships as .onnx + .onnx_data; int8 is one .onnx file. Without this the library looks for model_int8.onnx_data,
  // gets a 404, throws where the caller cannot catch it, and the load never ends (run 8).
  external: { webgpu: true, wasm: false } };
const LOAD_LIMIT_MS = 5 * 60 * 1000;   // after the download: building the model must not spin forever
const withLimit = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} took longer than ${ms / 60000} min.`)), ms))]);
const SETTINGS = { per_unit_ngn: 150, unit_ngn: 5000 };
const $ = (id) => document.getElementById(id);
const today = () => watDate(new Date().toISOString());
let viewDay = today();   // the day all three tabs show; pasting alerts from another day moves to that day
const dayLabel = (d) => d === today() ? "Today" : new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const time = (iso) => new Date(Date.parse(iso) + 3600e3).toISOString().slice(11, 16);

// ---------- storage (IndexedDB; falls back to memory if blocked) ----------
let db = null; const mem = new Map();
try {
  db = await new Promise((res, rej) => {
    const r = indexedDB.open("pos-daybook", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("alerts", { keyPath: "id" });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
} catch { db = null; }
const tx = (mode) => db.transaction("alerts", mode).objectStore("alerts");
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const getAll = async () => db ? req(tx("readonly").getAll()) : [...mem.values()];
const has = async (id) => db ? !!(await req(tx("readonly").get(id))) : mem.has(id);
const put = async (row) => db ? req(tx("readwrite").put(row)) : mem.set(row.id, row);
const clearRows = async () => db ? req(tx("readwrite").clear()) : mem.clear();

// ---------- model (optional; rows work without it) ----------
let model = null;
let usedDevice = "";
let gpuLost = false;   // after a lost GPU every call fails (run 10); a reload is the only clean way back
const lastReadS = [];
async function loadModel() {
  if (gpuLost) { location.reload(); return; }   // the model is cached, so this is quick
  $("loadModel").disabled = true;
  $("modelState").textContent = "Gemma: loading…";
  let wake = null;
  try {
    const { pipeline, env } = await import("./vendor/transformers.min.js");
    const { makeResumableFetch, cacheApiStore } = await import("./src/resumable.js");
    // Big files download in 8 MB pieces that survive stalls and reloads (see src/resumable.js).
    env.fetch = makeResumableFetch({
      store: cacheApiStore(),
      onProgress: ({ done, total }) => {
        const mb = (b) => Math.round(b / 1048576);
        $("dlStatus").textContent = `Download: ${Math.floor(done / total * 100)}% (${mb(done)} of ${mb(total)} MB)` +
          (stalls.length ? ` · ${stalls.length} stall${stalls.length > 1 ? "s" : ""}, retried` : "");
      },
      onStall: (s) => { stalls.push(s); saveStalls(); $("copyLog").hidden = false; },
    });
    try { wake = await navigator.wakeLock?.request("screen"); } catch {}   // keep the screen on while downloading
    const t0 = performance.now();
    // navigator.gpu can exist while the phone still refuses a GPU adapter (her Tecno, 18 Oct:
    // "Failed to get GPU adapter"). Ask for a real adapter; if none, or if WebGPU fails, use the CPU once.
    let device = "wasm";
    if (!location.search.includes("cpu")) {
      try { if (await navigator.gpu?.requestAdapter()) device = "webgpu"; } catch {}
    }
    // The CPU version (int8) scored 1/30 kinds at 36 s/alert on the laptop (run 9): not worth a 1 GB download.
    // Without a GPU, stop here. Rows, "Did it land?" and end of day still work. (?cpu forces it, for tests.)
    if (device === "wasm" && !location.search.includes("cpu")) {
      try { await wake?.release(); } catch {}
      $("modelState").textContent = "Gemma: needs a GPU";
      $("addStatus").textContent = "This device has no usable GPU, so Gemma cannot read names here. Use a laptop for that. Rows, Did it land? and End of day still work.";
      return;
    }
    let gen;
    try {
      gen = await withLimit(pipeline("text-generation", MODEL.id, { dtype: MODEL.dtype[device], device, use_external_data_format: MODEL.external[device] }), LOAD_LIMIT_MS + 60 * 60 * 1000, "Loading Gemma");
    } catch (e) {
      if (device !== "webgpu") throw e;
      device = "wasm";
      $("dlStatus").textContent = "GPU not usable on this phone, loading on the CPU…";
      gen = await withLimit(pipeline("text-generation", MODEL.id, { dtype: MODEL.dtype[device], device, use_external_data_format: MODEL.external[device] }), LOAD_LIMIT_MS + 60 * 60 * 1000, "Loading Gemma");
    }
    usedDevice = `${device}${device === "wasm" ? (crossOriginIsolated ? ", multi-thread" : ", 1 thread") : ""}`;
    try { await wake?.release(); } catch {}
    $("dlStatus").textContent = stalls.length ? `Downloaded with ${stalls.length} stall(s), all retried.` : "";
    model = async (prompt) => {
      const out = await gen([{ role: "user", content: prompt }], { max_new_tokens: 48, do_sample: false });
      return out[0].generated_text.at(-1).content;
    };
    $("modelState").textContent = `Gemma: ready (${Math.round((performance.now() - t0) / 1000)} s, ${usedDevice})`;
    await classifyPending();
  } catch (e) {
    try { await wake?.release(); } catch {}
    $("modelState").textContent = "Gemma: not loaded";
    $("addStatus").textContent = "Gemma could not load: " + e.message + " Rows are still saved.";
    $("loadModel").disabled = false;
  }
}

// ---------- download stall log (to measure why downloads stop) ----------
const STALL_KEY = "pos-daybook-stalls";
let stalls = [];
try { stalls = JSON.parse(localStorage.getItem(STALL_KEY) || "[]"); } catch { stalls = []; }
function saveStalls() { try { localStorage.setItem(STALL_KEY, JSON.stringify(stalls)); } catch {} }
async function copyLog() {
  const text = JSON.stringify({ ua: navigator.userAgent, stalls }, null, 1);
  try { await navigator.clipboard.writeText(text); $("dlStatus").textContent = "Download log copied."; }
  catch { $("dlStatus").textContent = text; }
}

// Rows saved before 18 Oct have kind "pending"; newer ones have a code kind and name "pending".
const waitingName = (r) => r.kind === "pending" || r.name === "pending";

async function classifyPending() {
  if (!model) return;
  const pending = (await getAll()).filter(waitingName);
  let done = 0, notRead = 0;
  for (const [i, r] of pending.entries()) {
    $("addStatus").textContent = `Gemma reading name ${i + 1} of ${pending.length}…`;
    const tc = performance.now();
    const c = await readAlert({ narration: r.narration, raw: r.raw }, model);
    if (modelFailed(c.attempts)) {
      // One failed call (e.g. "Device was lost") means the model is gone: stop, do not mark rows unclear.
      model = null; gpuLost = true;
      $("modelState").textContent = "Gemma: stopped";
      $("addStatus").textContent = "Gemma stopped (the GPU was lost). Tap the button to reload and load it again. Rows are saved.";
      $("loadModel").textContent = "Reload and load Gemma"; $("loadModel").disabled = false;
      break;
    }
    lastReadS.push(+((performance.now() - tc) / 1000).toFixed(1));
    await put({ ...r, kind: c.kind, from: c.from, name: c.name, attempts: c.attempts });
    done++; if (c.name !== "read") notRead++;
    await render();
  }
  // Count only names Gemma really read; a refused one is "not read" (18 Oct: "3 names read" hid a miss).
  const read = done - notRead;
  if (done && !gpuLost) $("addStatus").textContent = `Done. ${read} name${read === 1 ? "" : "s"} read` +
    (notRead ? `, ${notRead} not read` : "") + ` (${lastReadS.slice(-done).join(" s, ")} s on ${usedDevice}).`;
}

// ---------- paste ----------
async function addAlerts() {
  const text = $("paste").value.trim();
  if (!text) { $("addStatus").textContent = "Paste an alert first."; return; }
  let parsed;
  try { parsed = parseMoniepoint(text); }
  catch (e) { $("addStatus").textContent = e instanceof ParseError ? e.message : "Could not read that: " + e.message; return; }
  let added = 0, dupes = 0; const days = new Set();
  for (const a of parsed) {
    const id = alertId(a);
    days.add(watDate(a.at));   // also for already-saved ones: pasting them again should still show their day
    if (await has(id)) { dupes++; continue; }
    const r = await readAlert({ narration: a.narration, raw: a.raw }, null);   // code kind now; name later, if needed
    await put({ id, ...a, kind: r.kind, from: null, name: r.name, attempts: [], added_at: new Date().toISOString() });
    added++;
  }
  // Older alerts (e.g. pasted from last week): show their day, not an empty today.
  const moved = days.size && !days.has(viewDay) ? [...days].sort().at(-1) : null;
  if (moved) setDay(moved);
  $("paste").value = "";
  $("addStatus").textContent = `${added} added${dupes ? `, ${dupes} already saved` : ""}.` +
    (moved ? ` Showing ${dayLabel(moved)}${days.size > 1 ? ` (they are from ${days.size} days: change the Day above)` : ""}.` : "") + (model ? "" : " Kinds are set. Load Gemma (on a laptop) to read customers' names.");
  await render();
  await classifyPending();
}

// ---------- render ----------
const KIND_LABEL = { customer_transfer: "customer", own_airtime: "airtime", reward: "reward", reversal: "reversal", other: "other", unclear: "check", pending: "pending" };
function rowHtml(r) {
  // A name Gemma read, "…" while waiting, else the raw narration in grey, so it never looks like a read name
  // (18 Oct: a narration that is only "NAME NAME" looked the same either way).
  const who = r.from ? escapeHtml(r.from) : waitingName(r) ? "…"
    : r.name === "unclear" ? `<span class="muted">${escapeHtml(r.narration)} (name not read)</span>` : `<span class="muted">${escapeHtml(r.narration)}</span>`;
  const kind = KIND_LABEL[r.kind] ? r.kind : "other";
  return `<div class="row"><span class="t">${time(r.at)}</span>` +
    `<span class="who">${who} <span class="chip ${kind}">${KIND_LABEL[kind]}</span></span>` +
    `<span class="amt">${naira(r.amount_kobo)}</span></div>`;
}
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function render() {
  const rows = (await getAll()).filter((r) => watDate(r.at) === viewDay).sort((a, b) => b.at.localeCompare(a.at));
  $("todayTitle").textContent = `${dayLabel(viewDay)} · ${rows.length} alert${rows.length === 1 ? "" : "s"}`;
  $("rows").innerHTML = rows.length ? rows.map(rowHtml).join("") : `<p class="muted">No alerts for ${viewDay === today() ? "today" : dayLabel(viewDay)}. Paste one above.</p>`;
  const s = endOfDay(rows, viewDay, SETTINGS);
  $("dIn").textContent = naira(s.total_in_kobo); $("dCh").textContent = naira(s.est_charges_kobo);
  $("dRows").textContent = s.rows; $("dTr").textContent = s.transfers; $("per").textContent = SETTINGS.per_unit_ngn;
  $("dayTitle").textContent = `End of day · ${dayLabel(viewDay)}`;
  $("toCheck").innerHTML = s.to_check.length
    ? s.to_check.map((c) => `<div class="row"><span class="t">${time(c.row.at)}</span><span class="who">${escapeHtml(c.why)}</span><span class="amt">${naira(c.row.amount_kobo)}</span></div>`).join("")
    : '<p class="muted">Nothing to check.</p>';
  if (s.names_unread) $("toCheck").innerHTML += `<p class="muted">${s.names_unread} customer name${s.names_unread > 1 ? "s" : ""} not read yet. Totals are right without them.</p>`;
  $("wa").textContent = whatsappText(s);
}

// ---------- day picker ----------
function setDay(d) {
  viewDay = d; $("viewDay").value = d; $("toToday").hidden = d === today();
  $("landResult").hidden = true;
}

// ---------- did it land ----------
async function check() {
  const n = Number(String($("landAmt").value).replace(/[₦,\s]/g, ""));
  const box = $("landResult"); box.hidden = false;
  if (!Number.isFinite(n) || n <= 0) { box.innerHTML = '<p class="verdict not_seen">Type an amount</p>'; return; }
  const rows = await getAll();
  const r = didItLand(rows, Math.round(n * 100), { date: viewDay, name: $("landName").value || undefined });
  const title = { landed: "Landed ✓", not_seen: "Not seen yet", ambiguous: `${r.matches.length} payments of this amount` }[r.status];
  box.innerHTML = `<p class="verdict ${r.status}">${title}</p>` +
    (r.matches.length ? r.matches.map(rowHtml).join("") : `<p class="muted">No ${naira(Math.round(n * 100))} credit in the alerts for ${viewDay === today() ? "today" : dayLabel(viewDay)}. Paste the latest alerts, then check again.</p>`) +
    (r.status === "ambiguous" ? '<p class="muted">Add the name to narrow it down.</p>' : "");
}

// ---------- WhatsApp copy, tabs ----------
$("copyWa").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("wa").textContent); $("waStatus").textContent = "Copied. Paste it in WhatsApp."; }
  catch { $("waStatus").textContent = "Copy blocked: long-press the text above and copy."; }
});
document.querySelectorAll("nav button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("nav button").forEach((x) => x.removeAttribute("aria-current"));
  b.setAttribute("aria-current", "page");
  for (const t of ["paste", "land", "day"]) $("tab-" + t).hidden = t !== b.dataset.tab;
}));
$("add").addEventListener("click", addAlerts);
$("viewDay").addEventListener("change", async () => { if ($("viewDay").value) { setDay($("viewDay").value); await render(); } });
$("toToday").addEventListener("click", async () => { setDay(today()); await render(); });
setDay(today());
$("check").addEventListener("click", check);
$("loadModel").addEventListener("click", loadModel);
$("copyLog").addEventListener("click", copyLog);
if (stalls.length) $("copyLog").hidden = false;
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
// Hidden, for demos and tests: ?reset-rows shows a button that deletes the saved rows on this device (two taps).
// The downloaded model is kept (it lives in the browser cache, not in IndexedDB).
if (location.search.includes("reset-rows")) {
  const b = document.createElement("button");
  b.className = "ghost"; b.type = "button"; b.textContent = "Delete all saved rows on this device";
  let armed = false;
  b.addEventListener("click", async () => {
    if (!armed) { armed = true; b.textContent = "Tap again to delete all rows (the model stays)"; return; }
    await clearRows(); b.textContent = "All rows deleted."; b.disabled = true; await render();
  });
  $("tab-paste").querySelector(".card").append(b);
}
await render();

