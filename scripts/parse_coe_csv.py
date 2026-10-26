"""Import the COE bidding results CSV (premiums, quotas, bids) into site/data/coe.json.
Usage: python scripts/parse_coe_csv.py file.csv
Safe to repeat: the CSV is merged by (announcement date, category). New exercises are added, changed figures are updated and reported.
Rejects the file (nothing written) if a column is missing, a number cannot be read, a row is duplicated, or the figures are impossible.
"""
import csv, json, re, sys
from datetime import datetime
from pathlib import Path

def parse_num(r, key, line):
    value = r[key].strip()
    try:
        return int(re.sub(r"[$,\s]", "", value))
    except ValueError:
        raise ValueError(f"{key}={value!r}")

SRC = Path(sys.argv[1]); OUT = Path(__file__).resolve().parent.parent / "site" / "data" / "coe.json"
WANT = ["Bidding Exercise", "Announcement Date", "Year", "Category", "Quota", "Quota Premium", "Total Bids Received", "Number of Successful Bids"]
num = lambda v: int(re.sub(r"[$,\s]", "", v))
rows = list(csv.DictReader(open(SRC, encoding="utf-8-sig", newline="")))
if not rows or any(c not in rows[0] for c in WANT): sys.exit("CHECK FAILED - expected columns: " + ", ".join(WANT))
new, errors, warns = {}, [], []
for i, r in enumerate(rows, 2):
    try:
        d = datetime.strptime(r["Announcement Date"].strip(), "%d/%m/%Y").date().isoformat()
        c = re.match(r"Cat ([A-E])\b", r["Category"].strip()).group(1)
        q = parse_num(r, "Quota", i)
        p = parse_num(r, "Quota Premium", i)
        b = parse_num(r, "Total Bids Received", i)
        s = parse_num(r, "Number of Successful Bids")        ex = r["Bidding Exercise"].strip(); m = re.match(r"(\w+) (\d{4}) (First|Second)", ex)
        month = datetime.strptime(f"{m.group(1)} {m.group(2)}", "%B %Y").strftime("%Y-%m")
    except Exception as e:
        errors.append(f"line {i}: cannot read this row ({type(e).__name__}): {list(r.values())[:4]}"); continue
    if not (0 < p <= 400000): errors.append(f"line {i}: premium {p:,} is not plausible ({ex}, Cat {c})")
    if q <= 0 or b < 0: errors.append(f"line {i}: bad quota/bids ({ex}, Cat {c})")
    if s > b: errors.append(f"line {i}: successful bids {s:,} exceed bids received {b:,} ({ex}, Cat {c})")
    if s > q: warns.append(f"{ex} Cat {c}: successful bids {s:,} are above the quota {q:,}")
    if d[:7] != month: warns.append(f"{ex}: announced {d}, a different month from its name")
    if (d, c) in new: errors.append(f"line {i}: duplicate row for {d} Cat {c}")
    new[(d, c)] = {"d": d, "m": month, "n": 1 if m.group(3) == "First" else 2, "c": c, "q": q, "p": p, "b": b, "s": s, "ex": ex}
per = {}
for d, c in new: per.setdefault(d, set()).add(c)
short = sorted(d for d, cs in per.items() if len(cs) < 5)
if short: warns.append(f"{len(short)} exercise(s) do not have all five categories, e.g. {short[:3]}")
if errors:
    print("CHECK FAILED - nothing written:", *errors[:12], sep="\n  "); sys.exit(1)
old = {(r["d"], r["c"]): r for r in json.loads(OUT.read_text())} if OUT.exists() else {}
added = sorted({d for d, c in new if (d, c) not in old}); changed = [k for k in new if k in old and old[k] != new[k]]
old.update(new)
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(sorted(old.values(), key=lambda r: (r["d"], r["c"])), separators=(",", ":")))
latest = max(r["d"] for r in old.values())
print(f"COE: {len(new)} rows read, {len(added)} new exercise(s) added, {len(changed)} existing row(s) changed | stored {len(old)} rows, latest exercise {latest}")
for w in warns[:6]: print("  note:", w)
if changed: print("  WARNING: figures changed for", sorted(changed)[:4])
print("ALL CHECKS PASSED")
