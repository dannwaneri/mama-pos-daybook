// One alert -> {kind, from}. At most two model calls (one retry with the reason), then "unclear".
import { guard } from "./guard.js";
import { buildPrompt } from "./prompt.js";
import { ruleKind } from "./rules.js";

export const MAX_MODEL_CALLS = 2;

/**
 * @param {{narration:string, raw:string}} alert
 * @param {(prompt:string)=>Promise<string>} model  returns raw model text; may throw if unavailable
 * @param {{style?: "few"|"zero"}} opts  prompt style (see prompt.js)
 */
export async function classify(alert, model, { style = "few" } = {}) {
  const attempts = [];
  let reasons = [];
  for (let i = 0; i < MAX_MODEL_CALLS; i++) {
    let text;
    try {
      text = await model(buildPrompt(alert.narration, reasons, style));
    } catch (e) {
      attempts.push({ output: null, ok: false, reasons: ["model_unavailable: " + e.message] });
      break;
    }
    const g = guard(text, alert.raw, alert.narration);
    attempts.push({ output: text, ok: g.ok, reasons: g.reasons });
    if (g.ok) return { kind: g.value.kind, from: g.value.from, attempts };
    reasons = g.reasons;
  }
  return { kind: "unclear", from: null, attempts };
}


/** True if the model call failed (no answer at all), e.g. a lost GPU: stop calling it, ask for a reload. */
export const modelFailed = (attempts) => attempts.some((a) => a.reasons.some((r) => r.startsWith("model_unavailable")));

/**
 * What the app uses. Code decides the kind; Gemma is asked only for a customer transfer's sender name.
 * name: "none" (kind has no sender), "pending" (no model yet), "read" (Gemma, guarded), "unclear" (guard refused twice).
 * @param {{narration:string, raw:string}} alert
 * @param {((prompt:string)=>Promise<string>)|null} model
 */
export async function readAlert(alert, model, opts = {}) {
  const kind = ruleKind(alert.narration);
  if (kind !== "customer_transfer") return { kind, from: null, name: "none", attempts: [] };
  if (!model) return { kind, from: null, name: "pending", attempts: [] };
  const c = await classify(alert, model, opts);
  if (c.kind === "unclear") return { kind, from: null, name: modelFailed(c.attempts) ? "pending" : "unclear", attempts: c.attempts };
  return { kind, from: c.from, name: "read", attempts: c.attempts };
}
