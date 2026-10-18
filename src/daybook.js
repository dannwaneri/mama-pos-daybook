// Pure code: matching, sums and the WhatsApp text. No model here. Money is integer kobo; times are WAT.

const WAT_MS = 60 * 60 * 1000;
export const watDate = (iso) => new Date(Date.parse(iso) + WAT_MS).toISOString().slice(0, 10);
const watTime = (iso) => new Date(Date.parse(iso) + WAT_MS).toISOString().slice(11, 16);
export const naira = (kobo) => "₦" + (kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: kobo % 100 ? 2 : 0, maximumFractionDigits: 2 });

/** Her charge table: ₦150 for each ₦5,000 or part of it (confirmed 16 Oct). */
export function chargeKobo(amountKobo, s = { per_unit_ngn: 150, unit_ngn: 5000 }) {
  return Math.ceil(amountKobo / (s.unit_ngn * 100)) * s.per_unit_ngn * 100;
}

/**
 * "Did it land?" — today's rows only.
 * @param rows   [{amount_kobo, at, from, kind}]
 * @param amountKobo  the amount the customer says they sent
 * @param opts   {date: "YYYY-MM-DD" (WAT), name?: string}
 */
export function didItLand(rows, amountKobo, { date, name } = {}) {
  let m = rows.filter((r) => r.amount_kobo === amountKobo && (!date || watDate(r.at) === date));
  if (name) {
    const n = name.toLowerCase().trim();
    const byName = m.filter((r) => (r.from || "").toLowerCase().includes(n) || (r.narration || "").toLowerCase().includes(n));
    if (byName.length) m = byName;
  }
  const status = m.length === 0 ? "not_seen" : m.length === 1 ? "landed" : "ambiguous";
  return { status, matches: m };
}

/** End of day for one WAT date. Charges are an estimate from her table (alerts show money in, not cash out). */
export function endOfDay(rows, date, settings) {
  const day = rows.filter((r) => watDate(r.at) === date).sort((a, b) => a.at.localeCompare(b.at));
  const transfers = day.filter((r) => r.kind === "customer_transfer");
  const toCheck = [];
  for (const r of day) {
    if (r.kind === "unclear") toCheck.push({ row: r, why: "Gemma could not read this one" });
    else if (r.kind === "pending") toCheck.push({ row: r, why: "not read yet (load Gemma)" });
    else if (r.kind === "reversal") toCheck.push({ row: r, why: "reversal" });
  }
  // Same amount twice within 10 minutes: a double payment, or a customer sending twice.
  for (let i = 1; i < transfers.length; i++) {
    const a = transfers[i - 1], b = transfers[i];
    if (a.amount_kobo === b.amount_kobo && Date.parse(b.at) - Date.parse(a.at) <= 10 * 60 * 1000) {
      toCheck.push({ row: b, why: `same amount as ${watTime(a.at)}, ${Math.round((Date.parse(b.at) - Date.parse(a.at)) / 60000)} min apart` });
    }
  }
  return {
    date,
    total_in_kobo: day.reduce((s, r) => s + r.amount_kobo, 0),
    transfers: transfers.length,
    // Names Gemma has not read (no laptop yet, or the guard refused). Not a money problem, so not in to_check.
    names_unread: transfers.filter((r) => r.name === "pending" || r.name === "unclear").length,
    est_charges_kobo: transfers.reduce((s, r) => s + chargeKobo(r.amount_kobo, settings), 0),
    rows: day.length,
    to_check: toCheck,
  };
}

export function whatsappText(sum) {
  const lines = [
    `POS day-book · ${sum.date}`,
    `Money in: ${naira(sum.total_in_kobo)} (${sum.rows} alerts, ${sum.transfers} customer transfers)`,
    `Charges (estimate): ${naira(sum.est_charges_kobo)}`,
  ];
  if (sum.to_check.length) {
    lines.push(`Check these (${sum.to_check.length}):`);
    for (const c of sum.to_check) lines.push(`- ${watTime(c.row.at)} ${naira(c.row.amount_kobo)}: ${c.why}`);
  } else {
    lines.push("Nothing to check.");
  }
  return lines.join("\n");
}
