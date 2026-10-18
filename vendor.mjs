// Fetches the transformers.js build the app self-hosts (jsDelivr hung on her phone, so the app serves its own copy).
// Not committed: GitHub push protection flags a string inside this public minified file as an API key (false positive;
// the file is byte-for-byte the official build). Pinned by version and SHA-256. Usage: node vendor.mjs
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
const URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js";
const SHA256 = "1475fd440e9932ab206682ee42cb18f6097403e9ee77ea62084c592d0f83597d";
const OUT = "bench/vendor/transformers.min.js";
const sha = (b) => createHash("sha256").update(b).digest("hex");
if (existsSync(OUT) && sha(readFileSync(OUT)) === SHA256) { console.log("ok, already present:", OUT); process.exit(0); }
const buf = Buffer.from(await (await fetch(URL)).arrayBuffer());
if (sha(buf) !== SHA256) { console.error("SHA-256 does not match the pinned build. Not saved."); process.exit(1); }
mkdirSync("bench/vendor", { recursive: true }); writeFileSync(OUT, buf); console.log("saved", OUT);
