# Mama POS day-book

A day-book for a **POS operator** in Port Harcourt, Nigeria. A POS operator runs a small stand with a card terminal:
customers send her money by bank transfer, and she gives them cash, for a charge (₦150 for each ₦5,000). Her bank
(Moniepoint) sends an email for each payment that comes in. Today she writes these in a notebook. She stopped
balancing the day because it "takes long", and customers often say "I sent it" when it has not arrived.

She pastes the alert emails into the app. It gives her:

- **Rows**: time, amount, kind of money, and the customer's name, with no typing.
- **Did it land?**: type the amount a customer says they sent; the app answers *Landed*, *Not seen yet*, or *2 payments of this amount*.
- **End of day**: money in, estimated charges, rows to check (reversals, the same amount twice in 10 minutes), and a text to paste into WhatsApp.

"Mama POS" is the name she chose for this project. Her real name is not in this repo.

**App:** https://mama-pos-daybook.pages.dev — all data stays in the browser (IndexedDB). Nothing is sent to a server.

## Where the open model does the work

Code does everything that code can do. The open model (**Gemma 3 1B**, run in the browser with
[transformers.js](https://github.com/huggingface/transformers.js), on the device's GPU) does one job: it reads the
customer's name from the free-text line the sender's bank writes.

| step | done by | why |
|---|---|---|
| amount, time, balance, reference | code (`src/parse.js`) | fixed fields in the email |
| kind of money (customer, airtime, reward, reversal, other) | code (`src/rules.js`) | keywords were 5/5 on her real alerts; Gemma was 4/5 |
| **customer's name** | **Gemma** + guard (`src/classify.js`, `src/guard.js`) | each bank writes it differently; on her alerts it says "TRANSFER **TO** *customer*" on money that came *in*. Keyword rules found 0 of 3 names. |
| did it land, end of day, charges | code (`src/daybook.js`) | arithmetic |

The model can only label and copy. The guard refuses any answer that is not JSON, any name that is not copied from the
alert, and any number that is not in the alert. It allows one retry, then the name stays "not read". The money totals
never depend on the model.

## Measured results (`bench/RESULTS.md`)

| test | kind | name | time per name |
|---|---|---|---|
| her 5 real alerts (her labels, redacted) | 5/5 | 4/5 | about 4 s (laptop GPU, normal browser) |
| 30 synthetic alerts (`eval/synthetic.json`, invented) | 30/30 \* | 23/30 | 18 s (headless test browser) |

\* Not a fair score: the same person wrote the keyword rules and the synthetic set.

## Limits (measured, not guessed)

- **Gemma does not run on her phone.** Her phone (Tecno Camon 17 Pro, Android 11) reports WebGPU but gives no GPU
  adapter. The CPU version of the model scored 1/30 kinds at 36 s per alert even on a laptop (run 9). So Gemma runs on
  a laptop. Her phone runs the rest of the app: rows, kinds, Did it land? and End of day all work without the model.
- 5 real alerts is a small set, and the bank-name trim in the guard was written after seeing them.
- Reads **Moniepoint credit alerts only**. She also uses Nomba; other banks are not done.
- Charges are an estimate: the alerts show money in, not the cash she paid out.

## Run it

```
npm test                         # 44 tests run; 3 more need the private real alerts and skip without them
node eval/baseline.mjs           # keyword rules on the synthetic set
```

Rerun the synthetic test in your browser (needs WebGPU): https://mama-pos-daybook.pages.dev/bench/eval#few-1b-split

The app is static files in `app/` and `src/`; `node vendor.mjs` fetches the pinned transformers.js build (SHA-256 checked), then `node build.mjs` builds the deploy folder. Serve them from any static host. Model files download once (859 MB)
from Hugging Face and are cached by the browser. A large download resumes after a dropped connection (`src/resumable.js`).

`private/` (her redacted alerts and labels) is git-ignored and never committed.

## License

MIT, see `LICENSE`.
