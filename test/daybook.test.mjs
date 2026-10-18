import { test } from "node:test";
import assert from "node:assert/strict";
import { didItLand, endOfDay, whatsappText, chargeKobo, watDate } from "../src/daybook.js";

const S = { per_unit_ngn: 150, unit_ngn: 5000 };
const k = (n) => Math.round(n * 100);
// Synthetic rows (fake names). Times in UTC; WAT is +1.
const ROWS = [
  { at: "2026-10-16T09:10:00.000Z", amount_kobo: k(10000), kind: "customer_transfer", from: "CHIDI OKAFOR" },
  { at: "2026-10-16T12:28:00.000Z", amount_kobo: k(10000), kind: "customer_transfer", from: "EMEKA OBI" },
  { at: "2026-10-16T12:31:00.000Z", amount_kobo: k(5000), kind: "customer_transfer", from: null, narration: "Mama Ngozi for 5k" },
  { at: "2026-10-16T13:00:00.000Z", amount_kobo: k(100), kind: "own_airtime", from: null },
  { at: "2026-10-15T18:00:00.000Z", amount_kobo: k(7000), kind: "customer_transfer", from: "YESTERDAY PERSON" },
];
const TODAY = "2026-10-16";

test("charge table: ₦150 per ₦5,000 or part", () => {
  assert.equal(chargeKobo(k(5000), S), k(150));
  assert.equal(chargeKobo(k(5001), S), k(300));
  assert.equal(chargeKobo(k(10000), S), k(300));
  assert.equal(chargeKobo(k(100), S), k(150));
});

test("WAT date boundary", () => {
  assert.equal(watDate("2026-10-15T23:30:00.000Z"), "2026-10-16");   // 00:30 WAT next day
  assert.equal(watDate("2026-10-15T22:59:00.000Z"), "2026-10-15");
});

test("did it land: one match -> landed", () => {
  const r = didItLand(ROWS, k(5000), { date: TODAY });
  assert.equal(r.status, "landed");
  assert.equal(r.matches[0].narration, "Mama Ngozi for 5k");
});

test("did it land: no match -> not seen", () => assert.equal(didItLand(ROWS, k(7000), { date: TODAY }).status, "not_seen"));

test("did it land: yesterday's money does not count today", () =>
  assert.equal(didItLand(ROWS, k(7000), { date: TODAY }).matches.length, 0));

test("did it land: two of the same amount -> ambiguous, name narrows it", () => {
  assert.equal(didItLand(ROWS, k(10000), { date: TODAY }).status, "ambiguous");
  const r = didItLand(ROWS, k(10000), { date: TODAY, name: "emeka" });
  assert.equal(r.status, "landed");
  assert.equal(r.matches[0].from, "EMEKA OBI");
});

test("end of day: ₦25,000 in 3 transfers -> ₦750 estimated charges", () => {
  const rows = ROWS.filter((r) => r.kind === "customer_transfer" && watDate(r.at) === TODAY);
  const s = endOfDay(rows, TODAY, S);
  assert.equal(s.total_in_kobo, k(25000));
  assert.equal(s.transfers, 3);
  assert.equal(s.est_charges_kobo, k(750));
});

test("end of day: unclear, reversal and quick duplicates are listed to check", () => {
  const rows = [
    { at: "2026-10-16T10:00:00.000Z", amount_kobo: k(2000), kind: "customer_transfer" },
    { at: "2026-10-16T10:04:00.000Z", amount_kobo: k(2000), kind: "customer_transfer" },
    { at: "2026-10-16T11:00:00.000Z", amount_kobo: k(3000), kind: "unclear" },
    { at: "2026-10-16T12:00:00.000Z", amount_kobo: k(500), kind: "reversal" },
  ];
  const s = endOfDay(rows, TODAY, S);
  assert.equal(s.to_check.length, 3);
  assert.ok(s.to_check.some((c) => /same amount as 11:00, 4 min apart/.test(c.why)));
});

test("whatsapp text lists the rows to check and never hides an unclear row", () => {
  const rows = [
    { at: "2026-10-16T10:00:00.000Z", amount_kobo: k(5000), kind: "customer_transfer" },
    { at: "2026-10-16T11:00:00.000Z", amount_kobo: k(3000), kind: "unclear" },
  ];
  const t = whatsappText(endOfDay(rows, TODAY, S));
  assert.match(t, /Money in: ₦8,000 \(2 alerts, 1 customer transfers\)/);
  assert.match(t, /Charges \(estimate\): ₦150/);
  assert.match(t, /12:00 ₦3,000: Gemma could not read this one/);
});

test("rows not yet read by Gemma are never hidden from the summary", () => {
  const rows = [{ at: "2026-10-16T10:00:00.000Z", amount_kobo: k(5150), kind: "pending" }];
  const s = endOfDay(rows, TODAY, S);
  assert.equal(s.to_check.length, 1);
  assert.match(whatsappText(s), /not read yet/);
  assert.doesNotMatch(whatsappText(s), /Nothing to check/);
});

test("end of day: unread names are counted, not listed to check", () => {
  const rows = [
    { at: "2026-10-16T10:00:00.000Z", amount_kobo: 515000, kind: "customer_transfer", name: "pending", from: null },
    { at: "2026-10-16T11:00:00.000Z", amount_kobo: 300000, kind: "customer_transfer", name: "read", from: "ADA OBI" },
  ];
  const s = endOfDay(rows, "2026-10-16", { per_unit_ngn: 150, unit_ngn: 5000 });
  assert.equal(s.names_unread, 1);
  assert.equal(s.to_check.length, 0);
});
