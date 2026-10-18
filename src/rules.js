// Kind of money, by keywords. On her 5 real alerts this got 5/5 kinds, Gemma 1B 4/5 (bench/RESULTS.md, run 10),
// so code decides the kind and Gemma is used only for the sender's name (see readAlert in classify.js).
export function ruleKind(narration) {
  const n = String(narration).toLowerCase();
  if (/reward|cashback|referral|bonus/.test(n)) return "reward";
  if (/revers|rvsl|failed/.test(n)) return "reversal";
  if (/^(airtime|data) to/.test(n)) return "own_airtime";
  if (/settlement|top-up|interest|loan|^test$/.test(n)) return "other";
  return "customer_transfer";
}

// Sender name by rule: "TRANSFER FROM <NAME> <Bank>" only. Found 0 of 3 names on her real alerts (they say
// "TRANSFER TO <customer>"); kept for the baseline, not used by the app.
export function ruleFrom(narration) {
  const m = String(narration).match(/TRANSFER FROM ([A-Z][A-Z ]+?) (?:GTBank|Opay|OPay|Kuda|Access|UBA|Zenith)/);
  return m ? m[1] : null;
}
