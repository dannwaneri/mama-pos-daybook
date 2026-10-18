// Local-only server for the real-alert run. Binds 127.0.0.1, so private/ never leaves this laptop.
// Never deploy private/. Usage: node test/serve-local.mjs   (then open http://127.0.0.1:8787/eval.html#few-1b-real)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
const root = new URL("..", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const map = [["/eval.html", "bench/eval.html"], ["/vendor/", "bench/vendor/"], ["/src/", "src/"], ["/eval/", "eval/"], ["/private/", "private/"]];
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".wasm": "application/wasm" };
createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const hit = map.find(([pre]) => p === pre || (pre.endsWith("/") && p.startsWith(pre)));
  if (!hit || p.includes("..")) { res.writeHead(404); return res.end(); }
  try {
    const body = await readFile(join(root, hit[1] + p.slice(hit[0].length)));
    res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(8787, "127.0.0.1", () => console.log("serving on http://127.0.0.1:8787"));
