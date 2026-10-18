"""Build eval/synthetic.json: ~30 credit alerts on the exact Moniepoint email layout seen in
Mama POS's real alerts, with hand labels. SYNTHETIC: every name is invented, every reference is fake.

The fixed fields (amount, balance, sender line, date) copy the real layout exactly. The narrations are
written in the styles different senders' banks use, so the eval tests the part the model must do.
Re-run: python eval/make_synthetic.py
"""
import json
from pathlib import Path

TEMPLATE = """Moniepoint <no-reply@moniepoint.com> {hdr}
To: <EMAIL>
Hi NAME ,
We wish to inform you that a credit transaction occurred on your account with
us.
Credit Amount
 {amount}
Transaction Details
Account Balance:
N {balance}
Account Number:
XXXX
{sender}Date & Time:
{when}
Narration:
{narration}"""

TRANSFER_LINE = "Sender's Name:\nfrom Moniepoint Transfer Transit Account\n"
VAS_LINE = "Sender's Name:\nfrom Moniepoint VAS Transit Account\n"

# (amount, narration, sender_line, kind, from) — from = exact substring of narration, or None.
CASES = [
    (5150.00, "TRANSFER FROM CHIDI OKAFOR GTBank *****1234/TRF|REF000111", TRANSFER_LINE, "customer_transfer", "CHIDI OKAFOR"),
    (10300.00, "NIP:ADAEZE NWOSU-for cash", TRANSFER_LINE, "customer_transfer", "ADAEZE NWOSU"),
    (2150.00, "Mama Ngozi for 2k withdrawal", TRANSFER_LINE, "customer_transfer", "Mama Ngozi"),
    (20600.00, "TRF FRM EMEKA OBI TO POS VIA OPAY REF:XYZ0001", TRANSFER_LINE, "customer_transfer", "EMEKA OBI"),
    (3150.00, "Kuda/TUNDE BAKARE/cash pls", TRANSFER_LINE, "customer_transfer", "TUNDE BAKARE"),
    (15450.00, "FIRST BANK MOB TRF FROM NKECHI EZE", TRANSFER_LINE, "customer_transfer", "NKECHI EZE"),
    (5150.00, "from Ifeoma", TRANSFER_LINE, "customer_transfer", "Ifeoma"),
    (7650.00, "Access-BLESSING UDO-POS", TRANSFER_LINE, "customer_transfer", "BLESSING UDO"),
    (1150.00, "PalmPay transfer SAMUEL AKPAN", TRANSFER_LINE, "customer_transfer", "SAMUEL AKPAN"),
    (50900.00, "UBA/OKON ETIM/school fees cash", TRANSFER_LINE, "customer_transfer", "OKON ETIM"),
    (4150.00, "Zenith Mobile:GRACE AMADI:cash", TRANSFER_LINE, "customer_transfer", "GRACE AMADI"),
    (10300.00, "MOMO/IBRAHIM SANI", TRANSFER_LINE, "customer_transfer", "IBRAHIM SANI"),
    (6150.00, "brother Kelechi", TRANSFER_LINE, "customer_transfer", "Kelechi"),
    (25750.00, "TRANSFER FROM FATIMA BELLO Opay *****9876/TRF|REF000333", TRANSFER_LINE, "customer_transfer", "FATIMA BELLO"),
    (2150.00, "Withdrawal abeg", TRANSFER_LINE, "customer_transfer", None),
    (8150.00, "Wema ALAT: VICTOR OGU to POS", TRANSFER_LINE, "customer_transfer", "VICTOR OGU"),
    (3440.25, "Moniepoint Rewards Cashout", None, "reward", None),
    (512.00, "Moniepoint Cashback Reward", None, "reward", None),
    (1200.00, "Referral bonus - Moniepoint", None, "reward", None),
    (5150.00, "REVERSAL: TRF FAILED REF000444", TRANSFER_LINE, "reversal", None),
    (10300.00, "RVSL/Failed transfer to EMEKA OBI", TRANSFER_LINE, "reversal", None),
    (2000.00, "Reversal of failed withdrawal REF000555", TRANSFER_LINE, "reversal", None),
    (100.00, "AIRTIME TO 08030000000 MTN/ATP|REF000222", VAS_LINE, "own_airtime", None),
    (500.00, "AIRTIME TO 09050000000 GLO/ATP|REF000666", VAS_LINE, "own_airtime", None),
    (1000.00, "DATA TO 08120000000 AIRTEL/ATP|REF000777", VAS_LINE, "own_airtime", None),
    (30000.00, "Own account top-up from GTBank", TRANSFER_LINE, "other", None),
    (45000.00, "Settlement from Nomba", TRANSFER_LINE, "other", None),
    (12000.00, "loan repayment from Chuka", TRANSFER_LINE, "other", "Chuka"),
    (750.00, "Interest payment", None, "other", None),
    (9999.00, "test", TRANSFER_LINE, "other", None),
]


def fmt(n):
    return f"{n:,.2f}"


def main():
    out, balance = [], 12000.00
    for i, (amount, narration, sender, kind, frm) in enumerate(CASES):
        balance += amount
        hh, mm = 8 + (i * 17) // 60, (i * 17) % 60
        h12, ap = (hh % 12 or 12), ("AM" if hh < 12 else "PM")
        when = f"16 Oct, 2026 | {h12:02d}:{mm:02d}:{(i * 7) % 60:02d} {ap}"
        hdr = f"Fri, Oct 16, 2026 at {h12}:{mm:02d} {ap}"
        text = TEMPLATE.format(hdr=hdr, amount=fmt(amount), balance=fmt(balance),
                               sender=sender or "", when=when, narration=narration)
        assert frm is None or frm.lower() in narration.lower(), (i, frm)
        out.append({"id": f"syn-{i + 1:02d}", "text": text, "narration": narration,
                    "label": {"kind": kind, "from": frm}})
    p = Path(__file__).with_name("synthetic.json")
    p.write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    kinds = {}
    for o in out:
        kinds[o["label"]["kind"]] = kinds.get(o["label"]["kind"], 0) + 1
    print(len(out), "synthetic alerts", kinds)


if __name__ == "__main__":
    main()
