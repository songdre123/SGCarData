"""Parse the LTA monthly 'Cost (S$) For Cars Registered in <Mon YYYY>' PDF (M032) and store it as one file per month.
Usage: python scripts/parse_cost_pdf.py path/to/M032.pdf
Needs poppler's `pdftotext` on the PATH (preinstalled on most Linux; `apt install poppler-utils`).
Writes site/data/costs/YYYY-MM.json, then rebuilds site/data/cost_history.json and cost_changes.json
Re-running the same month simply overwrites that month's file (safe to repeat).
"""
import json, re, subprocess, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import cost_history

SRC = Path(sys.argv[1])
OUT = Path(__file__).resolve().parent.parent / "site" / "data" / "costs"
OUT.mkdir(parents=True, exist_ok=True)

MONTHS = {m: i + 1 for i, m in enumerate("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split())}
MAKE_ALIASES = {"B.M.W.": "BMW", "M.G.": "MG"}      # keep identical to the registration scripts
FUEL = {"P": "Petrol", "H": "Petrol-Electric", "R": "Petrol-Electric (Plug-in)", "E": "Electric",
        "B": "Petrol-CNG", "C": "CNG", "Y": "Diesel-Electric", "Q": "Diesel-Electric (Plug-in)"}
MONEY = re.compile(r"^(-?[\d,]+|-)$")

def money(tok):
    return None if tok == "-" else int(tok.replace(",", ""))

full = subprocess.run(["pdftotext", "-layout", str(SRC), "-"], capture_output=True, text=True, check=True).stdout
m = re.search(r"Registered in ([A-Z][a-z]{2}) (\d{4})", full)
if not m:
    sys.exit("Could not find the month in the PDF title")
month = f"{m.group(2)}-{MONTHS[m.group(1)]:02d}"

candidates = sum(1 for l in full.splitlines() if re.match(r"^\s*\d{1,4}\s{2,}[A-Z]", l))   # lines that look like model rows
rows, problems = [], []
for raw in full.splitlines():
    parts = re.split(r"\s{2,}", raw.strip())          # SN | Make | Model | the rest, single-spaced numbers
    if len(parts) < 4 or not parts[0].isdigit():
        continue
    sn, make, model = int(parts[0]), parts[1], parts[2]
    rest = " ".join(parts[3:]).split()
    if len(rest) < 17 or not all(MONEY.match(t) for t in rest[-13:]):
        continue
    omv, gst, arf, ves, eeai, regn, coe, basic_ex, basic_with, price_ex, price_with, diff_ex, diff_with = [money(t) for t in rest[-13:]]
    head = rest[:-13]                                  # COEcat [cc] kW fuel co2 band
    coe_cat, band, co2, fuel_code = head[0], head[-1], int(head[-2]), head[-3]
    nums = [int(t.replace(",", "")) for t in head[1:-3]]
    cc, kw = (None, nums[0]) if len(nums) == 1 else (nums[0], nums[1])   # electric cars have no engine capacity
    row = {"m": month, "sn": sn, "make": MAKE_ALIASES.get(make, make), "model": model, "coe_cat": coe_cat,
           "cc": cc, "kw": kw, "fuel": FUEL.get(fuel_code, fuel_code), "co2": co2, "ves_band": band,
           "omv": omv, "gst_excise": gst, "arf": arf, "ves": ves, "eeai": eeai, "regn_fee": regn, "coe": coe,
           "basic_ex_coe": basic_ex, "basic_with_coe": basic_with,
           "price_ex_coe": price_ex, "price_with_coe": price_with, "diff_ex_coe": diff_ex, "diff_with_coe": diff_with}
    # arithmetic checks using the PDF's own columns
    if omv + gst + arf + ves + eeai + regn != basic_ex: problems.append((sn, "basic_ex_coe"))
    if basic_ex + coe != basic_with: problems.append((sn, "basic_with_coe"))
    if price_with is not None and price_with - basic_with != diff_with: problems.append((sn, "diff_with_coe"))
    if price_ex is not None and price_ex - basic_ex != diff_ex: problems.append((sn, "diff_ex_coe"))
    rows.append(row)

sns = [r["sn"] for r in rows]
expected = max(sns) if sns else 0
missing = sorted(set(range(1, expected + 1)) - set(sns))
print(f"month {month}: parsed {len(rows)} models (highest SN {expected}); missing SNs: {missing or 'none'}")
print("arithmetic problems:", problems or "none")
print("models with a quoted dealer price:", sum(1 for r in rows if r["price_with_coe"] is not None))
print(f"lines that look like model rows: {candidates}")
if not rows or missing or problems or len(rows) != expected or len(rows) != candidates:
    print("CHECK FAILED - file NOT written"); sys.exit(1)

(OUT / f"{month}.json").write_text(json.dumps(rows, separators=(",", ":")), encoding="utf-8")
print("written:", OUT / f"{month}.json")
cost_history.rebuild()
print("ALL CHECKS PASSED")
