import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { parseMoniepoint, alertId, toKobo, parseWhen, ParseError } from "../src/parse.js";

const REAL = new URL("../private/real_alerts_redacted.json", import.meta.url);
const real = existsSync(REAL) ? JSON.parse(readFileSync(REAL, "utf8")) : null;

// Values as printed in the 5 real alerts (her balances and times): kept in private/, never committed.
const EXP = new URL("../private/real_expected.json", import.meta.url);
const EXPECTED = existsSync(EXP) ? JSON.parse(readFileSync(EXP, "utf8")) : null;

test("toKobo and parseWhen", () => {
  assert.equal(toKobo(" 10,000.00"), 1000000);
  assert.equal(toKobo("N 12,345.67"), 1234567);
  assert.throws(() => toKobo("10k"), ParseError);
  assert.equal(parseWhen("13 Aug, 2026 | 01:11:11 PM"), "2026-08-13T12:11:11.000Z");
  assert.equal(parseWhen("04 Sep, 2025 | 07:05:09 AM"), "2025-09-04T06:05:09.000Z");
  assert.equal(parseWhen("01 Jan, 2026 | 12:05:00 AM"), "2025-12-31T23:05:00.000Z");
});

test("all 5 real alerts parse with the printed values", { skip: !(real && EXPECTED) && "private/ not present" }, () => {
  const rows = real.flatMap((a) => parseMoniepoint(a));
  assert.equal(rows.length, 5);
  rows.forEach((r, i) => {
    assert.equal(r.amount_kobo, EXPECTED[i].amount, `amount ${i}`);
    assert.equal(r.balance_kobo, EXPECTED[i].balance, `balance ${i}`);
    assert.equal(r.at, EXPECTED[i].at, `time ${i}`);
    assert.ok(r.narration.length > 0, `narration ${i}`);
  });
  assert.equal(rows[3].sender_line, null);          // rewards alert has no Sender's Name line
  assert.equal(rows[3].narration, "Moniepoint Rewards Cashout");
  assert.match(rows[0].narration, /^TRANSFER TO NAME OPay/);
});

test("one paste with all alerts gives 5 rows", { skip: !real && "private/ not present" }, () => {
  assert.equal(parseMoniepoint(real.join("\n\n")).length, 5);
});

test("non-Moniepoint text is refused", () => {
  assert.throws(() => parseMoniepoint("Hello, I sent you 5k abeg check"), ParseError);
  assert.throws(() => parseMoniepoint("Nomba: You received NGN5,000 from NAME"), ParseError);
});

test("same alert twice gives the same id", { skip: !real && "private/ not present" }, () => {
  const [a] = parseMoniepoint(real[0]);
  const [b] = parseMoniepoint(real[0]);
  assert.equal(alertId(a), alertId(b));
  const [c] = parseMoniepoint(real[1]);
  assert.notEqual(alertId(a), alertId(c));
});

test("every synthetic alert parses, and its label 'from' is in its narration", () => {
  const syn = JSON.parse(readFileSync(new URL("../eval/synthetic.json", import.meta.url), "utf8"));
  assert.ok(syn.length >= 30);
  for (const s of syn) {
    const [row] = parseMoniepoint(s.text);
    assert.equal(row.narration, s.narration, s.id);
    if (s.label.from) assert.ok(row.narration.toLowerCase().includes(s.label.from.toLowerCase()), s.id);
  }
});
