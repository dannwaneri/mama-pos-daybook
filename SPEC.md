# Mama POS day-book — Spec

Hacktoberfest Open-Source AI Challenge, Week 2: Side Hustle.
Deadline: Sun 18 Oct 11:59 PM PDT = **Mon 19 Oct 07:59 WAT**. Spec written Fri 16 Oct.

**First user:** a POS operator in Port Harcourt, called "Mama POS" in public (her choice). Interview, 15 Oct:
uses Moniepoint and Nomba; 10–20 transactions a day; profit in a notebook, "takes long";
money not balancing is "a pain, she stopped checking"; customers saying "I sent it" when it did not
arrive "usually happens"; charges ₦150 per ₦5,000; pays for no tool now; said yes to ₦500 a month.

**Her phone:** TECNO Camon 17 Pro (CG8h), Helio G90T, 8 GB RAM, Android 11 (HiOS 7.6), Chrome 144. `navigator.gpu` is present, but on 18 Oct `requestAdapter()` gave no adapter ("Failed to get GPU adapter"), so WebGPU does not work on it. The CPU path needs the int8 model (q4 has no CPU kernel), and int8 scored 1/30 kinds at 36 s/alert even on the laptop (bench/RESULTS.md, run 9). **So Gemma does not run on her phone.** See the 18 Oct decision under Architecture.

**Data we have:** 5 real Moniepoint credit-alert emails, redacted, in `private/real_alerts_redacted.json`
(git-ignored, never committed, never quoted unredacted). No Nomba alert, no customer receipt.

---

## SECTION 1: SPEC

**One-line purpose**
Mama POS pastes her bank alerts into her phone and, without typing a number, sees each customer's
money as a row, can answer "did it land?" in seconds, and gets the day's total and the rows she
should check.

**Users and use cases**
- As a POS operator, I want to paste a credit alert and see who paid, how much and what kind of money it is, so that I stop writing it in a notebook.
- As a POS operator, I want to type the amount a customer says they sent and see at once if it landed, so that I can settle "I sent it" arguments at the counter.
- As a POS operator, I want an end-of-day summary with the rows that need my check, so that balancing the day is quick enough that I do it again.
- As the owner she reports to, I want the summary on WhatsApp, so that I see the day without visiting.

**Requirements**
1. The user can add one or many alerts in one paste. Each alert becomes one row.
2. From each alert the tool takes the **amount, balance, date-time and alert type** exactly as printed.
3. From the free-text **narration** (written by the sender's bank or the sender, different every time) the tool decides the **kind of money** — `customer_transfer`, `own_airtime`, `reward`, `reversal`, `other` — and **who it is from**, as written in the narration.
4. The tool never shows a money figure that is not printed in the alert. [ASSUMPTION: all money on screen comes from parsed fields or from code arithmetic on them]
5. "Did it land?": the user enters an amount (optional: a name, a time window). The tool answers **Landed** (with the matching row) or **Not seen**, from today's rows only.
6. End of day: total money in, number of customer transfers, an **estimated** charge total from her charge table, and a list of rows to check (kind `unclear`, `reversal`, duplicates of the same amount within 10 minutes). [ASSUMPTION: "estimated" because alerts show money in, not the cash she paid out]
7. Her charge table is editable (default ₦150 per ₦5,000 or part of it). [ASSUMPTION: charge = ₦150 × ceil(amount / 5,000)]
8. The summary can be copied as plain text for WhatsApp.
9. Everything works with no internet after the first load. No alert leaves the phone.
10. The same alert pasted twice is stored once.

**Edge cases**
- **Narration the model cannot classify, or model output fails the check twice:** row kind = `unclear`, shown in "rows to check". Never guessed.
- **Model returns a number not printed in the alert:** output rejected, one retry with the reason, then `unclear`.
- **Model returns a name that is not in the narration:** rejected the same way.
- **Pasted text is not a Moniepoint alert** (e.g. a Nomba alert or a chat message): "This doesn't look like a Moniepoint alert" — not stored. [ASSUMPTION: Nomba is out of v1]
- **Two customers send the same amount:** "Did it land?" lists both and asks for a name or time.
- **Alert from an earlier day pasted today:** stored on its own date, not in today's totals.
- **Model not available on the phone:** rows still store amount, time and narration; kind = `unclear` until the model is available.

**Acceptance criteria**
```
Given the 5 real redacted alerts
When they are pasted in one go
Then 5 rows appear with amount, balance and time equal to the printed values

Given a pasted alert
When it is processed
Then every number in the model's output appears verbatim in that alert, or the row is "unclear"

Given an alert whose narration is "Moniepoint Rewards Cashout"
When it is processed
Then the row kind is "reward"

Given today's rows include a ₦10,000.00 credit at 11:05
When she asks "Did it land?" for 10000
Then the answer is "Landed" and shows that row

Given no row of ₦7,000 today
When she asks "Did it land?" for 7000
Then the answer is "Not seen"

Given the same alert is pasted twice
When it is processed
Then one row is stored

Given rows totalling ₦25,000 in 3 customer transfers of ₦10,000, ₦10,000 and ₦5,000
When she opens End of day
Then total in = ₦25,000 and estimated charges = ₦750 (₦300 + ₦300 + ₦150)

Given the phone is offline
When she pastes an alert
Then the row is stored and processed with no network request
```

---

## SECTION 2: PLAN

**Stack and architecture**
- **Phone-first web app (PWA)**, plain HTML + JS, no framework. Installable, offline after first load. Hosted as static files on Cloudflare Pages. [ASSUMPTION: Cloudflare Pages, as for other projects]
- **Storage:** IndexedDB on the phone.
- **Model:** a small **Gemma** run in the browser with transformers.js (ONNX, WebGPU when present, else WASM). [ASSUMPTION: Gemma 3 270M or 1B instruct, the smallest that passes the Task 1 timing gate]
  **Fallback** if no Gemma runs fast enough on a cheap phone: the same app talks to Ollama + Gemma on a laptop on the same Wi-Fi, and the post says so plainly. [ASSUMPTION: gate = ≤ 15 s per alert on her phone class]
  **Decision 18 Oct (fallback taken):** Gemma 1B q4 runs in the browser on a **laptop with WebGPU** (the same app, no Ollama). Her phone runs the app without Gemma: rows, Did it land? and End of day are code and work offline; on a device with no GPU adapter the Load button says so and downloads nothing. The post states this limit and the run 9 numbers. No claim about other phones: none tested.
- **Split of work (load-bearing rule):**
  - **Code** reads the fixed fields of the Moniepoint email (amount, balance, sender's-name line, date-time) with one parser — the layout is fixed.
  - **Gemma** reads only the free-text **narration** and returns `{kind, from}`. The narration is written by the *sender's* bank or by the sender, so its shape changes per bank; that is the job rules cannot do.
  - **Guard** (code): `kind` ∈ enum; `from` is a substring of the narration (case-insensitive) or empty; no digit sequence in the output that is not in the alert. One retry with the reason, then `unclear`. Max 2 model calls per alert, no loops.
  - **Code** does every sum, the charge estimate, "did it land?" matching and the WhatsApp text.

**Data model (IndexedDB)**
- `alerts`: `{id (sha256 of normalised text), raw (string), date (ISO), amount_kobo (int), balance_kobo (int), sender_line (string|null), narration (string), kind (enum|"unclear"), from (string|null), model_attempts ([{output, ok, reasons}]), added_at}`
- `settings`: `{charge_per_unit_ngn: 150, unit_ngn: 5000, owner_label: string}`
- Money is stored in kobo (integers). No floats.

**Function contracts (JS modules)**
- `parseMoniepoint(text) → Alert[] | ParseError` — splits a paste into alerts; reads the fixed fields; throws on unknown layout.
- `classify(narration, model) → {kind, from, attempts}` — at most 2 model calls.
- `guard(output, alertText, narration) → {ok, reasons[]}`.
- `didItLand(rows, amountKobo, {name?, from?, to?}) → {status: "landed"|"not_seen"|"ambiguous", matches[]}`.
- `endOfDay(rows, settings, date) → {total_in_kobo, transfers, est_charges_kobo, to_check[]}`.
- `whatsappText(summary) → string`.

**Patterns to follow**
- Same as Light don go: code owns every number; the model only does the one job code can't; a guard with one retry, then a fixed fallback; every model attempt logged.

**Testing strategy**
- Unit (Node, no browser): parser on the 5 real alerts (amount/balance/time exact); guard (≥ 15 cases: invented number, name not in narration, bad kind, good output); `didItLand` (landed, not seen, ambiguous); `endOfDay` charge maths in kobo; dedupe.
- **Model eval** (`eval/run.mjs`, Node + transformers.js): real set (5, redacted) and synthetic set (~30, labelled) reported **separately**: kind accuracy, `from` accuracy, guard rejections, invented-number count (must be 0 after the guard).
- **Rules-only baseline** in the same eval: a keyword classifier on the same narrations, so the post can show what the model adds (or doesn't).
- Manual: Mama POS uses it on one real day's alerts; note what she says.

**Security and privacy**
- No server, no account, no analytics. The only network use is the first page load and the one-time model download.
- `private/` is git-ignored. Synthetic alerts use invented names that are clearly fake.
- [ASSUMPTION: the post shows only synthetic alerts and redacted real ones]

---

## SECTION 3: TASKS

## Task 1: Model timing gate (phone browser)
**What to build:** `bench/phone.html` — loads a Gemma instruct model with transformers.js, classifies 3 sample narrations with the real prompt, shows load time and seconds per narration. Try the smallest Gemma first; record model id, phone, backend (WebGPU/WASM), times.
**Files:** `bench/phone.html`, `bench/RESULTS.md`
**Acceptance:** 1) Runs on Daniel's phone and on the laptop browser. 2) RESULTS.md records model id, download size, load s, s/narration. 3) A go/fallback decision is written in RESULTS.md against the 15 s gate.
**Dependencies:** none

## Task 2: Moniepoint parser + dedupe
**What to build:** `src/parse.js` with `parseMoniepoint` and `alertId`, kobo integers, date parsing ("13 Aug, 2026 | 01:11:11 PM", WAT).
**Files:** `src/parse.js`, `test/parse.test.mjs`
**Acceptance:** 1) All 5 real alerts parse with exact amount/balance/time. 2) A Nomba-like or chat text throws `ParseError`. 3) Same alert twice → same id.
**Dependencies:** none

## Task 3: Synthetic alert set
**What to build:** `eval/synthetic.json` — ~30 alerts on the exact Moniepoint layout; narrations varied across bank styles (OPay, Union Bank, GTBank, Access, Kuda, free text, airtime, rewards, reversals), each with a hand label `{kind, from}`. Fake names only.
**Files:** `eval/synthetic.json`, `eval/README.md`
**Acceptance:** 1) Every synthetic alert passes `parseMoniepoint`. 2) Every label `from` is a substring of its narration or null. 3) README says it is synthetic and how it was made.
**Dependencies:** Task 2

## Task 4: Guard + classify (model-agnostic)
**What to build:** `src/guard.js`, `src/classify.js` with a pluggable model function; prompt in `src/prompt.js`; max 2 calls; `unclear` fallback.
**Files:** `src/guard.js`, `src/classify.js`, `src/prompt.js`, `test/guard.test.mjs`, `test/classify.test.mjs`
**Acceptance:** 1) ≥ 15 guard cases pass. 2) Fake model bad/bad → `unclear`, exactly 2 calls. 3) Mutation check: removing the digit check makes a test fail.
**Dependencies:** none

## Task 5: Eval harness + baseline
**What to build:** `eval/run.mjs` — runs classify with the chosen Gemma (from Task 1) and a keyword baseline over real (from `private/`) and synthetic sets; prints a table per set.
**Files:** `eval/run.mjs`, `eval/results/*.json`
**Acceptance:** 1) Real and synthetic results are separate. 2) Reports kind acc, from acc, guard rejections, invented numbers after guard (= 0). 3) Runs offline after the model is cached.
**Dependencies:** Tasks 1–4

## Task 6: Did it land? + End of day
**What to build:** `src/daybook.js` with `didItLand`, `endOfDay`, `whatsappText`.
**Files:** `src/daybook.js`, `test/daybook.test.mjs`
**Acceptance:** 1) The acceptance criteria for landed / not seen / ambiguous pass. 2) ₦25,000 example → ₦750 estimated charges. 3) WhatsApp text has no row with kind `unclear` hidden — they are listed under "check these".
**Dependencies:** Task 2

## Task 7: PWA screens
**What to build:** `app/index.html` — three screens: **Paste alerts** (rows appear with kind chips), **Did it land?**, **End of day** (copy for WhatsApp). IndexedDB storage, service worker for offline, model load with progress.
**Files:** `app/index.html`, `app/app.js`, `app/sw.js`, `app/manifest.json`
**Acceptance:** 1) Works offline after first load (airplane-mode test). 2) Pasting the 5 real alerts shows 5 rows. 3) Usable at 360 px width.
**Dependencies:** Tasks 2, 4, 6 (and Task 1's model)

## Task 8: Field day + post material [HUMAN]
**What to build:** Mama POS uses it on one real day. Daniel records: what she pasted, what she said, any wrong row, whether she would pay.
**Files:** `FIELD.md` (no personal data), screenshots with synthetic or redacted rows only
**Acceptance:** 1) At least one real use. 2) Her words written down as said. 3) No name, account number or phone number anywhere in the repo.
**Dependencies:** Task 7

**Review checkpoint:** before building anything else, run Task 1 on a real phone — if no Gemma classifies a narration in ≤ 15 s there, decide the laptop fallback first, because the post's "offline on her phone" claim depends on it.

---

## Assumptions to review

1. Gemma 3 270M or 1B runs in a phone browser via transformers.js within 15 s per alert — Impact: HIGH
   Correct this if: Task 1 fails; then the laptop + Ollama fallback becomes the main path.
2. Nomba is out of v1 (no real sample) — Impact: HIGH
   Correct this if: you can get even one Nomba alert before Saturday.
3. Charge = ₦150 × ceil(amount / ₦5,000), and charges are an *estimate* — Impact: MEDIUM
   Correct this if: her real charge steps differ (ask her: ₦5,001–₦10,000 = ₦300?).
4. Model reads only the narration; code reads the fixed fields — Impact: MEDIUM
   Correct this if: the model's job looks too small to judges; the eval's rules-only baseline will show it.
5. Hosting on Cloudflare Pages — Impact: LOW
6. Post shows only synthetic or redacted alerts — Impact: LOW (privacy, keep it)
