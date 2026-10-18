# Task 1 — model timing gate

Gate: one narration classified in ≤ 15 s on Mama POS's phone (TECNO Camon 17 Pro, Helio G90T, 8 GB, Android 11, Chrome 144, WebGPU present).

## Run 1 — her phone, 16 Oct

- 270M q4 on WebGPU: no timings (results copied before load finished).
- Second attempt: page stuck at "Loading the library…" for 30 min. **Cause: a syntax error I introduced in the page** (a literal line break inside a JS string), not her network. Fixed; syntax is now checked before every deploy.
- Third attempt: small files downloaded; the 270 MB model file crawled at 1–3 KB/s on her 4G. Not finished.

## Run 2 — laptop, 16 Oct 10:16–10:31 WAT

Edge 155 headless, WebGPU (Intel Iris Xe), `onnx-community/gemma-3-270m-it-ONNX`, **q4f16**, transformers.js 4.3.0.

| | |
|---|---|
| Download 273 MB | 250 s (~1.1 MB/s) |
| Load to ready | 265.2 s |
| Narration 1 | 16.4 s (first call, includes warm-up) |
| Narration 2 | 7.5 s |
| Narration 3 | 8.1 s |

**Speed: inside the gate after warm-up. Output: unusable.** All three different narrations got the same text — no JSON,
"We're looking for a new ATM. We're looking for a new ATM…". Identical junk for every input points to a broken run
(suspect: q4f16 half-precision on this GPU), not only a weak model. Not yet tested: q4 (full-precision activations), WASM, 1B.

Decision: not a pass. Next measurement changes one thing only.

## Run 3 — laptop, 16 Oct — test A: 270M **q4** (full-precision activations), WebGPU

First attempt stalled at 32% of the 323 MB file (browser connection hung; the line itself still ran ~0.4 MB/s). Restarted.

| | |
|---|---|
| Load to ready | 205.4 s (mostly download) |
| Narration 1 | 13.0 s (first call, warm-up) |
| Narration 2 | 5.1 s |
| Narration 3 | 4.6 s |

**Speed: passes the gate on the laptop. Output: still unusable** — #1 and #2 echoed the prompt's own instruction text
(`"kind": one of "customer_transfer",…`), #3 the same "new ATM" junk as run 2. So q4f16 was not the only cause: the
270M model does not follow this zero-shot JSON prompt.

Next single change (model cached, no download): few-shot prompt with a simpler answer format, scored on all 30 synthetic narrations.

## Run 4 — laptop, 16–17 Oct — few-shot prompt, 270M q4, 30 synthetic narrations

(Labelled "1B" when started, but a restored browser tab kept the earlier 270M page; runner fixed to force a fresh load.)
kind correct 0/30 · from correct 15/30 (only where the label is null) · unclear 29/30 · median 4.3 s.
The model copied the few-shot example's name ("AMAKA EZE") into almost every answer and dropped the JSON braces.
**270M is ruled out for this task with both prompts.**

## Run 5 — laptop, 17 Oct — **Gemma 3 1B q4**, few-shot, 30 synthetic narrations, WebGPU

| | Gemma 3 1B | Keyword rules (`eval/baseline.mjs`) |
|---|---|---|
| kind correct | **23/30** | 30/30 — not a fair number: the same person wrote the rules and the set |
| sender name exact | **19/30** (+4 with a bank prefix such as `NIP:` / `Kuda/`) | 16/30 |
| unclear after 2 tries | 2 | — |
| invented numbers that got through | **0** | — |
| median per alert | **3.6 s** | — |
| load (first time, 859 MB download) | 428 s | — |

Gemma reads names rules cannot: "from Ifeoma", "brother Kelechi", "Mama Ngozi for 2k withdrawal", "TRF FRM EMEKA OBI TO POS VIA OPAY".
Errors: phone number given as sender on airtime alerts (fixed in code: a name must contain a letter), bank names as sender
("Wema ALAT", "GTBank"), some transfers called "other".
**Decision: 1B is the app's model.** Phone speed for 1B not yet measured (needs the 859 MB download on her phone, Wi-Fi).

## Run 6 — laptop, 18 Oct — the app, fresh browser, Gemma 3 1B through the resumable downloader

Tap "Load Gemma" → 819 MiB in 8 MB pieces in 303 s (~2.7 MB/s), **0 stalls**, ready at 319 s.
Pasted one synthetic alert → row "NIP:ADAEZE NWOSU · customer · ₦10,300" (kind and amount right; name keeps the bank prefix).
Not yet measured: the same on her phone (the stall log will record any drops).

## Her phone, 18 Oct 01:40 WAT — the app (1B q4) with the resumable downloader

Download: **100% (819 of 819 MB), no stalls logged.** Load failed: Chrome exposes `navigator.gpu` but the phone refuses
an adapter ("Failed to get GPU adapter"). Fix: ask for a real adapter, else / on failure use the CPU (WASM).

## Run 7 — laptop, 18 Oct — app forced to the CPU (?cpu), 1B q4

- **First real stall caught and recovered:** piece 34 of 103 went silent after 1.15 MB (visible, online), then 3 × "Failed to
  fetch" over ~2 min (connection down), then the 5th try succeeded and the download finished. Before the downloader, this
  is where a download hung forever.
- Load failed: q4 cannot run on the CPU engine ("no implementation for GatherBlockQuantized"). q4 is WebGPU-only.
  Fix: version by device — WebGPU → q4 (859 MB), CPU → int8 (1,001 MB). Page now sends COOP/COEP so the CPU engine
  can use all cores.

## Run 9 — Gemma 3 1B **int8 on the CPU** (WASM, multi-thread), laptop, 18 Oct 03:00 WAT

What her Tecno gets (no usable WebGPU, and q4 has no CPU kernel). Same 30 synthetic alerts, few-shot, max_new_tokens 48.

| | kind | sender | unclear | retried | median s/alert | load |
|---|---|---|---|---|---|---|
| q4, WebGPU (run 5) | 23/30 | 19/30 | — | — | — | — |
| **int8, CPU (this run)** | **1/30** | **14/30** | 20 | 27 | 36.3 | 451 s (after a 955 MB download), ~3.9 GB RAM |

Cause: int8 ignores "answer with JSON only". It writes prose ("Here's the breakdown…") and labels the few-shot
examples, not the real narration. 46 of 48 guard rejections were `no_json`. The guard held: no wrong answer was
accepted, they became "unclear". Sender 14/30 is mostly null == null on alerts with no sender, not real reads.

Conclusion: the CPU path is not usable on this prompt. Even with a fixed prompt, 36 s/alert on a laptop CPU means
well over a minute per alert on her phone. Log: bench/eval-few-1b-cpu.log.

## Run 10 — Gemma 3 1B q4, WebGPU, laptop, on her **5 real alerts** (18 Oct), labels from Mama POS

Served from 127.0.0.1 only (test/serve-local.mjs); alerts and logs stay in private/ (git-ignored). Redacted text: names are "NAME".
First attempt: the GPU was lost on alert 1 ("Device was lost before MapAsync completed"); every call failed, the guard made all 5
"unclear". Rerun with the model cached: no loss. The app does not yet recover from a lost GPU without a reload.

| | kind | sender | customer names found | s/alert |
|---|---|---|---|---|
| keyword rules (eval/baseline.mjs) | **5/5** | 2/5 | **0/3** | — |
| Gemma 1B + guard + bank trim | 4/5 | **4/5** | **2/3** | 18–22 (51 with a retry) |

- Her bank writes "TRANSFER TO <customer> <bank>" on a credit. The rules only know "TRANSFER FROM", so they found no names.
  Gemma copied "<customer> <bank>"; the bank trim in src/guard.js (written **after** seeing these alerts) cuts the bank.
- Gemma's miss: an alert whose narration is only the customer's name, redacted to "NAME NAME" → "other", no sender.
  It may read a real name better; not tested, so it counts as a miss.
- 5 alerts is a small set, and the trim was fitted to it: report it as a field check, not a benchmark.

## Run 11 — the split (what the app now does): code decides the kind, Gemma 1B q4 (WebGPU) reads only a customer's name

`readAlert` in src/classify.js. Kind = src/rules.js. Gemma is called only when the kind is customer_transfer.

| set | kind | sender | Gemma calls | median s/alert (with a call) |
|---|---|---|---|---|
| her 5 real alerts (her labels) | 5/5 | 4/5 | 3 of 5 alerts | 20.5 |
| 30 synthetic | 30/30* | **23/30** (was 19/30 in run 5) | 26 of 30 | 17.8 |

\* Not a fair kind score: the same person wrote the rules and the synthetic set. On the real alerts the rules got 5/5 with
no tuning to them. Sender went up 19 → 23 because a wrong *kind* from Gemma no longer makes the guard throw the name away.

Real miss: the alert whose narration is only the customer's name (redacted "NAME NAME") — no name returned.
Synthetic misses (7): bank/channel prefixes kept ("NIP:", "Kuda/", "Access-", "MOMO/") ×4, no name ×2, and
"loan repayment from Chuka" (kind other, so no name is asked for — by design). Not fixed: the synthetic set is the
only clean test left, and a fix written against it would make it a training set.
The runner lost its link after syn-14; the page finished all 30, and the result was read from it (see the log).
