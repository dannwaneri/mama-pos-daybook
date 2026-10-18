// The prompt the model sees. It gets the narration only, never the amount or balance.
// Two styles, compared in eval/: "zero" (describe the format) and "few" (show worked examples).
// Run 3 (bench/RESULTS.md): Gemma 270M echoed the zero-shot instructions back, so "few" is the default.

const RETRY = (reasons) => reasons.length
  ? `\nYour last answer was rejected (${reasons.join(", ")}). Copy the name exactly from the narration, use one of the five kinds, and write no number.`
  : "";

function zeroShot(narration, reasons) {
  return `You read the narration of a Nigerian bank credit alert. The narration is written by the sender's bank or by the sender.
Reply with JSON only: {"kind": one of "customer_transfer", "own_airtime", "reward", "reversal", "other", "from": the sender's name copied exactly from the narration, or null}.
Do not write any number.${RETRY(reasons)}
Narration: ${narration}
JSON:`;
}

// Examples are NOT in eval/synthetic.json (no leakage). Names are invented.
const EXAMPLES = [
  ["TRANSFER FROM AMAKA EZE Opay *****5555/TRF|REF999", '{"kind":"customer_transfer","from":"AMAKA EZE"}'],
  ["for cash from brother Obinna", '{"kind":"customer_transfer","from":"Obinna"}'],
  ["Moniepoint Cashback", '{"kind":"reward","from":null}'],
  ["REVERSAL OF FAILED TRANSFER", '{"kind":"reversal","from":null}'],
  ["AIRTIME TO MTN line", '{"kind":"own_airtime","from":null}'],
  ["Settlement from partner", '{"kind":"other","from":null}'],
];

function fewShot(narration, reasons) {
  const shots = EXAMPLES.map(([n, j]) => `Narration: ${n}\nJSON: ${j}`).join("\n\n");
  return `Label each bank alert narration. kind is one of customer_transfer, own_airtime, reward, reversal, other. from is the sender's name copied exactly from the narration, or null.${RETRY(reasons)}

${shots}

Narration: ${narration}
JSON:`;
}

export function buildPrompt(narration, retryReasons = [], style = "few") {
  return style === "zero" ? zeroShot(narration, retryReasons) : fewShot(narration, retryReasons);
}
