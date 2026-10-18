# Eval sets

Two sets, always reported **separately**.

| Set | Size | Where | What it is |
|---|---|---|---|
| Real | 5 | `private/real_alerts_redacted.json` (git-ignored) | Mama POS's own Moniepoint credit-alert emails, names / account numbers / references removed. |
| Synthetic | 30 | `synthetic.json` (built by `make_synthetic.py`) | **Invented.** Same email layout as the real ones; narrations written in different senders'-bank styles. Every name is fake. |

## Labels

- **Synthetic:** labelled by design (the generator writes the label next to the narration).
- **Real:** two of the five cannot be labelled from the text alone and need Mama POS to say what they were:
  - a credit whose narration reads "TRANSFER TO NAME OPay…" (it names who the transfer went *to*);
  - a ₦100 credit whose narration reads "AIRTIME TO … MTN" from the VAS account (refund? commission?).
  Until she confirms, their labels are `null` and they are scored only on "did the guard hold" (no invented number, name copied from the narration), not on kind accuracy.

## Kinds

`customer_transfer` (a customer sent money, usually for cash), `own_airtime` (airtime/data on her account), `reward` (Moniepoint rewards, cashback, referral), `reversal` (a failed transfer coming back), `other`.
