// Rules-only baseline on the same synthetic narrations: what plain keywords get without any model.
// The post compares Gemma against this, so the model's real contribution is measured, not claimed.
import { readFileSync } from "node:fs";

import { ruleKind, ruleFrom } from "../src/rules.js";

export function keywordClassify(narration) {
  return { kind: ruleKind(narration), from: ruleFrom(narration) };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
  const syn = JSON.parse(readFileSync(new URL("./synthetic.json", import.meta.url), "utf8"));
  let k = 0, f = 0;
  for (const s of syn) {
    const r = keywordClassify(s.narration);
    k += r.kind === s.label.kind;
    f += (r.from || "").toLowerCase() === (s.label.from || "").toLowerCase();
  }
  console.log(JSON.stringify({ n: syn.length, kind_acc: k, from_acc: f }));
}
