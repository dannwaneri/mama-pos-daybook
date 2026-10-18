// Builds deploy-prod/: the app at the root, the test pages under /bench/. Never copies private/.
// Usage: node build.mjs   then   npx wrangler pages deploy deploy-prod --project-name mama-pos-daybook --branch main
import { cpSync, rmSync, mkdirSync, existsSync } from "node:fs";
const out = "deploy-prod";
if (!existsSync("bench/vendor/transformers.min.js")) { console.error("Run node vendor.mjs first."); process.exit(1); }
rmSync(out, { recursive: true, force: true }); mkdirSync(out);
for (const f of ["index.html", "app.js", "manifest.json", "sw.js", "_headers"]) cpSync(`app/${f}`, `${out}/${f}`);
cpSync("src", `${out}/src`, { recursive: true });
cpSync("bench/vendor", `${out}/vendor`, { recursive: true });
for (const f of ["eval.html", "phone.html"]) cpSync(`bench/${f}`, `${out}/bench/${f}`);
cpSync("src", `${out}/bench/src`, { recursive: true });
cpSync("bench/vendor", `${out}/bench/vendor`, { recursive: true });
cpSync("eval/synthetic.json", `${out}/bench/eval/synthetic.json`);
console.log("built", out);
