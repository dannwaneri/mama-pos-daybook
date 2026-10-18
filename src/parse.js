// Moniepoint credit-alert email -> structured rows. Code reads every fixed field; the model only
// ever sees `narration`. Money is integer kobo. Times are WAT (UTC+1).

export class ParseError extends Error {}

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const FIELD_LABELS = ["Account Balance:", "Account Number:", "Sender's Name:", "Date & Time:", "Narration:", "Transaction Details"];

/** "10,000.00" -> 1000000 (kobo). Throws on anything that is not a plain amount. */
export function toKobo(s) {
  const m = String(s).trim().replace(/^N\s*/, "").match(/^(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})$/);
  if (!m) throw new ParseError(`not an amount: ${s}`);
  return Number(m[1].replace(/,/g, "")) * 100 + Number(m[2]);
}

/** "13 Aug, 2026 | 01:11:11 PM" (WAT) -> ISO string in UTC. */
export function parseWhen(s) {
  const m = String(s).trim().match(/^(\d{1,2}) ([A-Z][a-z]{2}), (\d{4}) \| (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)$/);
  if (!m || !(m[2] in MONTHS)) throw new ParseError(`not a date: ${s}`);
  let h = Number(m[4]) % 12;
  if (m[7] === "PM") h += 12;
  const utc = Date.UTC(Number(m[3]), MONTHS[m[2]], Number(m[1]), h - 1, Number(m[5]), Number(m[6]));
  return new Date(utc).toISOString();
}

/** Value printed after `label`, on the same line or the next non-empty line. */
function after(lines, label) {
  const i = lines.findIndex((l) => l.trim().startsWith(label));
  if (i < 0) return null;
  const rest = lines[i].trim().slice(label.length).trim();
  if (rest) return rest;
  const next = lines.slice(i + 1).find((l) => l.trim());
  return next ? next.trim() : null;
}

/** Narration runs from the line after "Narration:" to the end of the alert (it can wrap). */
function narrationOf(lines) {
  const i = lines.findIndex((l) => l.trim().startsWith("Narration:"));
  if (i < 0) return null;
  const first = lines[i].trim().slice("Narration:".length).trim();
  const out = first ? [first] : [];
  for (const l of lines.slice(i + 1)) {
    const t = l.trim();
    if (!t) continue;
    if (/^(If you experience|Follow us|Moniepoint <)/.test(t)) break;
    out.push(t);
  }
  return out.join(" ").replace(/\s+/g, " ").trim() || null;
}

function parseOne(block) {
  const lines = block.split(/\r?\n/);
  if (!/credit transaction occurred/i.test(block) || !lines.some((l) => l.trim() === "Credit Amount")) {
    throw new ParseError("This doesn't look like a Moniepoint credit alert.");
  }
  const amount = after(lines, "Credit Amount");
  const balance = after(lines, "Account Balance:");
  const when = after(lines, "Date & Time:");
  if (!amount || !balance || !when) throw new ParseError("Alert is missing amount, balance or date.");
  const senderLine = after(lines, "Sender's Name:");
  return {
    amount_kobo: toKobo(amount),
    balance_kobo: toKobo(balance),
    at: parseWhen(when),
    sender_line: senderLine && !FIELD_LABELS.some((f) => senderLine.startsWith(f)) ? senderLine : null,
    narration: narrationOf(lines) ?? "",
    raw: block.trim(),
  };
}

/** A paste can hold many alerts. Split on each alert's greeting, parse each. */
export function parseMoniepoint(text) {
  const blocks = String(text).split(/(?=^\s*Hi [^\n,]*,\s*$)/m).filter((b) => /Credit Amount/.test(b));
  if (blocks.length === 0) throw new ParseError("This doesn't look like a Moniepoint credit alert.");
  return blocks.map(parseOne);
}

/** Stable id: same alert pasted twice -> same id (amount + balance + time are unique per alert). */
export function alertId(a) {
  return `mp:${a.at}:${a.amount_kobo}:${a.balance_kobo}`;
}
