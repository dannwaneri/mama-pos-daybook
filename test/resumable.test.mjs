import { test } from "node:test";
import assert from "node:assert/strict";
import { makeResumableFetch } from "../src/resumable.js";

const URL1 = "https://example.test/model/onnx/model_q4.onnx_data";
const DATA = new Uint8Array(100).map((_, i) => i);   // a 100-byte "model"

function memStore() {
  const m = new Map();
  return { m, get: async (k) => m.get(k), put: async (k, b) => { m.set(k, b); } };
}

/** Fake server: serves DATA with Range; `stallOn(start, call)` makes a piece go silent after a few bytes. */
function fakeServer({ stallOn = () => false } = {}) {
  const calls = [];
  const impl = async (url, opts = {}) => {
    const h = new Headers(opts.headers || {});
    calls.push({ method: opts.method || "GET", range: h.get("Range") });
    if (opts.method === "HEAD") return new Response(null, { status: 200, headers: { "content-length": String(DATA.length) } });
    const m = /bytes=(\d+)-(\d+)/.exec(h.get("Range") || "");
    if (!m) return new Response(DATA, { status: 200 });
    const [s, e] = [Number(m[1]), Number(m[2])];
    const slice = DATA.slice(s, e + 1);
    const n = calls.filter((c) => c.range === h.get("Range")).length;
    if (stallOn(s, n)) {
      // Send 3 bytes, then go silent until aborted (like a dropped 4G connection).
      const body = new ReadableStream({
        start(ctrl) {
          ctrl.enqueue(slice.slice(0, 3));
          opts.signal?.addEventListener("abort", () => ctrl.error(opts.signal.reason));
        },
      });
      return new Response(body, { status: 206 });
    }
    return new Response(slice, { status: 206 });
  };
  return { impl, calls };
}

const base = (extra) => ({ chunkBytes: 32, stallMs: 50, triesPerChunk: 3, minBytes: 10, ...extra });

test("downloads in pieces and returns the whole file", async () => {
  const srv = fakeServer();
  const f = makeResumableFetch(base({ fetchImpl: srv.impl, store: memStore() }));
  const res = await f(URL1);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), DATA);
  assert.equal(srv.calls.filter((c) => c.range).length, 4);   // 100 bytes / 32 = 4 pieces
});

test("a silent piece is aborted, logged, and retried; the file is still correct", async () => {
  const srv = fakeServer({ stallOn: (start, n) => start === 32 && n === 1 });   // 2nd piece stalls once
  const stalls = [];
  const f = makeResumableFetch(base({ fetchImpl: srv.impl, store: memStore(), onStall: (s) => stalls.push(s) }));
  const res = await f(URL1);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), DATA);
  assert.equal(stalls.length, 1);
  assert.equal(stalls[0].chunk, 1);
  assert.match(stalls[0].error, /stalled/);
  assert.equal(stalls[0].bytes_in_piece, 3);
});

test("after the bounded tries it stops with a clear message, and a second call resumes from saved pieces", async () => {
  let failing = true;
  const srv = fakeServer({ stallOn: (start) => start === 64 && failing });
  const store = memStore();
  const f = makeResumableFetch(base({ fetchImpl: srv.impl, store }));
  await assert.rejects(f(URL1), /piece 3 of 4 after 3 tries.*continue/);
  assert.equal(store.m.size, 2);                       // pieces 1 and 2 kept
  failing = false;
  const before = srv.calls.length;
  const res = await f(URL1);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), DATA);
  const newRanges = srv.calls.slice(before).map((c) => c.range).filter(Boolean);
  assert.deepEqual(newRanges, ["bytes=64-95", "bytes=96-99"]);   // only the missing pieces
});

test("the library's own Range probes and small files use plain fetch", async () => {
  const srv = fakeServer();
  const f = makeResumableFetch(base({ fetchImpl: srv.impl, store: memStore(), minBytes: 1000 }));
  await f(URL1, { headers: { Range: "bytes=0-0" } });
  assert.equal(srv.calls.length, 1);                   // passed straight through, no HEAD
  await f(URL1);                                        // 100 bytes < minBytes
  assert.equal(srv.calls.at(-1).range, null);           // one plain GET after the HEAD
});
