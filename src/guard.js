// Checks one model answer about one alert's narration. The model may only label and copy:
// kind from a fixed list, `from` copied from the narration, and no number that is not in the alert.

export const KINDS = ["customer_transfer", "own_airtime", "reward", "reversal", "other"];

const norm = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();
// A bank name at the end of the sender is the sender's bank, not part of the name. Real alerts, 18 Oct: 1B returned
// "<name> OPay" and "<name> Union Bank of Nigeria" from "TRANSFER TO <name> <bank>…". Trim it in code (no model call).
// Names that are also common words or surnames (Heritage, Unity, Lotus, Carbon…) are left out on purpose.
const BANK_TAIL = new RegExp("(?:^|\\s+)(?:" + [
  "gtbank", "gtb", "guaranty trust(?: bank)?", "opay", "palmpay", "kuda(?: bank| mfb)?", "moniepoint(?: mfb)?",
  "access(?: bank)?", "uba", "united bank for africa", "zenith(?: bank)?", "first ?bank(?: of nigeria)?",
  "union bank(?: of nigeria)?", "fidelity(?: bank)?", "sterling(?: bank)?", "wema(?: bank)?", "alat", "ecobank",
  "stanbic(?: ibtc)?(?: bank)?", "fcmb", "polaris(?: bank)?", "keystone(?: bank)?", "providus(?: bank)?",
  "jaiz(?: bank)?", "globus(?: bank)?", "paga", "vfd(?: mfb)?",
].join("|") + ")(?:\\s+(?:plc|ltd|limited|mfb))?\\s*$", "i");
// Two passes, fixed: "Wema ALAT" (synthetic run 5) is two bank names. A sender that is only a bank is no name -> null.
export const trimBank = (name) => { const t = String(name).replace(BANK_TAIL, "").trim().replace(BANK_TAIL, "").trim(); return t || null; };
const digitRuns = (s) => String(s).match(/\d+/g) || [];

/** Pull the first {...} out of the model text and parse it. Returns null if there is none. */
export function extractJson(text) {
  const m = String(text).match(/\{[\s\S]*?\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

/**
 * @param {string} modelText  raw model output
 * @param {string} alertText  the whole alert as pasted
 * @param {string} narration  the narration line(s) only
 * @returns {{ok:boolean, value:{kind:string, from:string|null}|null, reasons:string[]}}
 */
export function guard(modelText, alertText, narration) {
  const reasons = [];
  const v = extractJson(modelText);
  if (!v || typeof v !== "object") return { ok: false, value: null, reasons: ["no_json"] };

  if (!KINDS.includes(v.kind)) reasons.push("bad_kind");

  let from = v.from;
  if (from === "" || from === undefined || (typeof from === "string" && /^null$/i.test(from.trim()))) from = null;
  // A sender name has letters. Run 5 (bench/RESULTS.md): 1B returned the phone number from
  // "AIRTIME TO 0803…" as the sender. That is not a name, so drop it (no extra model call).
  if (typeof from === "string" && !/\p{L}/u.test(from)) from = null;
  if (from !== null) {
    if (typeof from !== "string") reasons.push("bad_from");
    else if (!norm(narration).includes(norm(from))) reasons.push("from_not_in_narration");
    else from = trimBank(from);
  }

  // Any digit run in the answer must appear in the alert itself.
  const alertDigits = new Set(digitRuns(alertText));
  const bad = digitRuns(modelText).filter((d) => !alertDigits.has(d));
  if (bad.length) reasons.push("invented_number:" + bad.join(","));

  return { ok: reasons.length === 0, value: reasons.length ? null : { kind: v.kind, from }, reasons };
}
