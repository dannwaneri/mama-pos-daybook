// Resumable download for big model files, used as transformers.js `env.fetch`.
//
// Why: on 16-17 Oct the model download stalled silently twice (phone at 74% of 273 MB, laptop at 32% of 323 MB):
// bytes stopped, no error, and the library waited forever. This fetch downloads big files in pieces, saves each
// piece as it lands, aborts a piece that goes silent, retries it a bounded number of times, and on the next tap
// resumes from the last saved piece. Every stall is logged so the cause can be measured, not guessed.

const MB = 1024 * 1024;

/** Read a response body, aborting if no bytes arrive for `stallMs`. Returns a Blob. */
async function readWithStallCheck(res, controller, stallMs, onBytes) {
  const reader = res.body.getReader();
  const parts = [];
  let timer;
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(new Error("stalled")), stallMs); };
  arm();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      onBytes?.(value.byteLength);
      arm();
    }
  } finally {
    clearTimeout(timer);
  }
  return new Blob(parts);
}

/**
 * @param {object} o
 * @param {Function} [o.fetchImpl]      real fetch (injected in tests)
 * @param {object}   o.store            {get(key)->Blob|undefined, put(key, Blob), del(key)} piece store
 * @param {number}   [o.chunkBytes]     piece size
 * @param {number}   [o.stallMs]        abort a piece after this long with no bytes
 * @param {number}   [o.triesPerChunk]  bounded retries per piece, then stop (saved pieces stay)
 * @param {number}   [o.minBytes]       smaller files use plain fetch
 * @param {Function} [o.onProgress]     ({file, done, total})
 * @param {Function} [o.onStall]        ({file, chunk, attempt, error, at, visible, online})
 * @param {Function} [o.now]            clock (tests)
 */
export function makeResumableFetch(o) {
  const fetchImpl = o.fetchImpl || fetch;
  const chunkBytes = o.chunkBytes ?? 8 * MB;
  const stallMs = o.stallMs ?? 15000;
  const tries = o.triesPerChunk ?? 6;
  const minBytes = o.minBytes ?? 30 * MB;
  const now = o.now || (() => new Date().toISOString());

  return async function resumableFetch(url, opts = {}) {
    const headers = new Headers(opts.headers || {});
    // The library's own range probes and anything that isn't a plain GET go straight through.
    if (headers.has("Range") || (opts.method && opts.method !== "GET")) return fetchImpl(url, opts);

    const head = await fetchImpl(url, { method: "HEAD" });
    const total = Number(head.headers.get("content-length") || 0);
    if (!head.ok || !total || total < minBytes) return fetchImpl(url, opts);

    const file = String(url).split("/").pop();
    const n = Math.ceil(total / chunkBytes);
    let done = 0;
    for (let i = 0; i < n; i++) if (await o.store.get(`${url}::${i}`)) done += Math.min(chunkBytes, total - i * chunkBytes);
    o.onProgress?.({ file, done, total, resumed_from: done });

    for (let i = 0; i < n; i++) {
      const key = `${url}::${i}`;
      if (await o.store.get(key)) continue;
      const start = i * chunkBytes, end = Math.min(total, start + chunkBytes) - 1;
      let piece = null;
      for (let attempt = 1; attempt <= tries && !piece; attempt++) {
        const controller = new AbortController();
        let got = 0;
        try {
          const res = await fetchImpl(url, { headers: { Range: `bytes=${start}-${end}` }, signal: controller.signal });
          if (res.status !== 206 && !(res.status === 200 && n === 1)) throw new Error(`HTTP ${res.status}`);
          const blob = await readWithStallCheck(res, controller, stallMs, (b) => { got += b; o.onProgress?.({ file, done: done + got, total }); });
          if (blob.size !== end - start + 1) throw new Error(`short piece ${blob.size}/${end - start + 1}`);
          piece = blob;
        } catch (e) {
          o.onStall?.({
            file, chunk: i, of: n, attempt, error: String(e?.message || e), bytes_in_piece: got, at: now(),
            visible: typeof document !== "undefined" ? document.visibilityState : "n/a",
            online: typeof navigator !== "undefined" ? navigator.onLine : "n/a",
          });
        }
      }
      if (!piece) throw new Error(`Download stopped at piece ${i + 1} of ${n} after ${tries} tries. Tap Load again to continue from here.`);
      await o.store.put(key, piece);
      done += piece.size;
      o.onProgress?.({ file, done, total });
    }

    const parts = [];
    for (let i = 0; i < n; i++) parts.push(await o.store.get(`${url}::${i}`));
    return new Response(new Blob(parts), { status: 200, headers: { "content-length": String(total), "content-type": "application/octet-stream" } });
  };
}

/** Piece store on the Cache API (browser). Survives reloads, so a stopped download resumes. */
export function cacheApiStore(name = "pos-daybook-pieces") {
  const open = () => caches.open(name);
  return {
    async get(key) { const r = await (await open()).match(key); return r ? r.blob() : undefined; },
    async put(key, blob) { await (await open()).put(key, new Response(blob)); },
    async clear() { await caches.delete(name); },
  };
}
