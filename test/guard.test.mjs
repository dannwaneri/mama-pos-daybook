import { test } from "node:test";
import assert from "node:assert/strict";
import { guard, extractJson, KINDS } from "../src/guard.js";
import { classify, MAX_MODEL_CALLS } from "../src/classify.js";

// Synthetic alert (fake names) on the real Moniepoint layout.
const ALERT = `Hi NAME ,
We wish to inform you that a credit transaction occurred on your account with us.
Credit Amount
 5,150.00
Account Balance:
N 41,200.00
Sender's Name:
from Moniepoint Transfer Transit Account
Date & Time:
16 Oct, 2026 | 10:42:07 AM
Narration:
TRANSFER FROM CHIDI OKAFOR GTBank *****1234/TRF|REF000111`;
const NARR = "TRANSFER FROM CHIDI OKAFOR GTBank *****1234/TRF|REF000111";
const ok = (text) => guard(text, ALERT, NARR);

const GOOD = [
  ['{"kind":"customer_transfer","from":"CHIDI OKAFOR"}', "customer_transfer", "CHIDI OKAFOR"],
  ['{"kind":"customer_transfer","from":"chidi okafor"}', "customer_transfer", "chidi okafor"],   // case
  ['Here: {"kind":"other","from":null} done', "other", null],                                     // chatter
  ['{"kind":"customer_transfer","from":"null"}', "customer_transfer", null],                     // string null
  ['{"kind":"customer_transfer","from":""}', "customer_transfer", null],
  ['{"kind":"customer_transfer","from":"CHIDI OKAFOR GTBank"}', "customer_transfer", "CHIDI OKAFOR"],   // bank trimmed (real alerts, 18 Oct)
  ['{"kind":"customer_transfer","from":"*****1234"}', "customer_transfer", null],              // no letters -> not a name
  ['{"kind":"own_airtime","from":"1234"}', "own_airtime", null],                                  // phone-number-as-sender (run 5)
];
for (const [text, kind, from] of GOOD) {
  test(`accepts ${text}`, () => {
    const g = ok(text);
    assert.ok(g.ok, JSON.stringify(g.reasons));
    assert.deepEqual(g.value, { kind, from });
  });
}

const BAD = [
  ['{"kind":"customer_transfer","from":"CHIDI OKAFOR","amount":5000}', "invented_number:5000"],
  ['{"kind":"customer_transfer","from":"CHIDI OKAFOR"} for 5150', "invented_number:5150"],      // amount not printed as 5150
  ['{"kind":"payment","from":"CHIDI OKAFOR"}', "bad_kind"],
  ['{"kind":"customer_transfer","from":"EMEKA OBI"}', "from_not_in_narration"],
  ['{"kind":"customer_transfer","from":"CHIDI OKAFOR from Lagos"}', "from_not_in_narration"],
  ['{"kind":"customer_transfer","from":42}', "bad_from"],
  ["customer transfer from Chidi", "no_json"],
  ['{"kind":"customer_transfer", "from": }', "no_json"],
  ['{"kind":"reward","from":"Moniepoint"} ref 999', "from_not_in_narration"],
];
for (const [text, reason] of BAD) {
  test(`rejects ${text}`, () => {
    const g = ok(text);
    assert.equal(g.ok, false);
    assert.ok(g.reasons.some((r) => r.startsWith(reason)), `${reason} not in ${g.reasons}`);
    assert.equal(g.value, null);
  });
}

test("digits printed in the alert are allowed, others are not", () => {
  assert.ok(ok('{"kind":"customer_transfer","from":"CHIDI OKAFOR"} 1234').ok);
  assert.equal(ok('{"kind":"customer_transfer","from":"CHIDI OKAFOR"} 4321').ok, false);
});

test("extractJson handles none", () => assert.equal(extractJson("nothing here"), null));
test("five kinds", () => assert.equal(KINDS.length, 5));

const fakeModel = (replies) => {
  const calls = [];
  const fn = async (prompt) => { calls.push(prompt); const r = replies.shift(); if (r instanceof Error) throw r; return r; };
  fn.calls = calls;
  return fn;
};
const A = { narration: NARR, raw: ALERT };

test("bad then bad -> unclear after exactly 2 calls", async () => {
  const m = fakeModel(['{"kind":"x"}', '{"kind":"y"}', '{"kind":"customer_transfer","from":null}']);
  const r = await classify(A, m);
  assert.equal(r.kind, "unclear");
  assert.equal(m.calls.length, MAX_MODEL_CALLS);
  assert.match(m.calls[1], /rejected \(bad_kind/);
});

test("bad then good -> uses the good answer", async () => {
  const m = fakeModel(['{"kind":"customer_transfer","from":"EMEKA"}', '{"kind":"customer_transfer","from":"CHIDI OKAFOR"}']);
  const r = await classify(A, m);
  assert.deepEqual([r.kind, r.from, m.calls.length], ["customer_transfer", "CHIDI OKAFOR", 2]);
});

test("model unavailable -> unclear after 1 call", async () => {
  const m = fakeModel([new Error("no model")]);
  const r = await classify(A, m);
  assert.equal(r.kind, "unclear");
  assert.equal(m.calls.length, 1);
});

test("prompt never contains the amount or balance", async () => {
  const m = fakeModel(['{"kind":"customer_transfer","from":"CHIDI OKAFOR"}']);
  await classify(A, m);
  assert.ok(!/5,150|41,200/.test(m.calls[0]));
});

test("trimBank: drops the sender's bank from the end, keeps names", async () => {
  const { trimBank } = await import("../src/guard.js");
  assert.equal(trimBank("NAME OPay"), "NAME");
  assert.equal(trimBank("NAME Union Bank of Nigeria"), "NAME");
  assert.equal(trimBank("ADA OBI Kuda MFB"), "ADA OBI");
  assert.equal(trimBank("AMAKA EZE"), "AMAKA EZE");
  assert.equal(trimBank("ACCESSORIES HUB"), "ACCESSORIES HUB");   // only a whole word at the end
  assert.equal(trimBank("OPay"), null);                            // only a bank: no name
  assert.equal(trimBank("Wema ALAT"), null);                       // two bank names (synthetic run 5, syn-16)
});

test("readAlert: code decides the kind; Gemma only for a customer's name", async () => {
  const { readAlert } = await import("../src/classify.js");
  let calls = 0;
  const m = async () => { calls++; return '{"kind":"other","from":"CHIDI OKAFOR"}'; };   // model's kind is ignored
  const cust = { narration: "TRANSFER TO CHIDI OKAFOR OPay", raw: "TRANSFER TO CHIDI OKAFOR OPay" };
  assert.deepEqual((({ kind, from, name }) => ({ kind, from, name }))(await readAlert(cust, m)),
    { kind: "customer_transfer", from: "CHIDI OKAFOR", name: "read" });
  const air = { narration: "AIRTIME TO 0803 MTN", raw: "AIRTIME TO 0803 MTN" };
  const a = await readAlert(air, m);
  assert.equal(a.kind, "own_airtime"); assert.equal(a.name, "none"); assert.equal(calls, 1);   // no call for airtime
  const p = await readAlert(cust, null);
  assert.equal(p.kind, "customer_transfer"); assert.equal(p.name, "pending");                // no model: kind still set
  const lost = await readAlert(cust, async () => { throw new Error("Device was lost"); });
  assert.equal(lost.name, "pending");                                                           // lost GPU: retry later
});
