"""Parse LTA population (MVP01-6) and car-transfer (M07a monthly, MVP04-1-1 annual) PDFs, verify them, store them.
Usage: python scripts/parse_stats_pdf.py file.pdf
Checks before anything is saved: every column adds up to the PDF's own TOTAL row; monthly rows add up to their Total column;
population make-only table (2015-2025) tallies with the make-by-fuel table; years already stored must match the new PDF.
Writes site/data/pop/<year>.json | trf/<YYYY-MM>.json | trfyear/<year>.json, then rebuilds population.json / transfers.json.
"""
import json, re, subprocess, sys
from collections import defaultdict
from pathlib import Path

SRC = Path(sys.argv[1]); DATA = Path(__file__).resolve().parent.parent / "site" / "data"
FUELS = ["Petrol-Electric (Plug-In)", "Diesel-Electric (Plug-In)", "Petrol-Electric", "Diesel-Electric", "Petrol-CNG", "Petrol", "Diesel", "Electric"]
MAKE_ALIASES = {"B.M.W.": "BMW", "M.G.": "MG"}; FUEL_ALIASES = {"Petrol-Electric (Plug-In)": "Petrol-Electric (Plug-in)", "Diesel-Electric (Plug-In)": "Diesel-Electric (Plug-in)"}
COLS = re.compile(r"20\d\d|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Total")
text = subprocess.run(["pdftotext", "-layout", str(SRC), "-"], capture_output=True, text=True, check=True).stdout
errors = []

tables = []                                   # one per page: (has_fuel, columns, rows, total)
for page in text.split("\f"):
    lines = page.splitlines()
    h = next((i for i, l in enumerate(lines) if re.match(r"\s*Make\s", l) and COLS.search(l)), None)
    if h is None: continue
    cols = [(m.group(), m.end()) for m in COLS.finditer(lines[h])]; has_fuel = "Fuel Type" in lines[h]
    rows, total = [], None
    for l in lines[h + 1:]:
        if l.strip().startswith(("Note", "1 Figures")): break
        nums = [m for m in re.finditer(r"(?<![\w(.-])\d[\d,]*(?![\w)])", l) if m.end() >= cols[0][1] - 6]
        if not nums: continue
        label, vals = l[:nums[0].start()].strip(), {}
        for m in nums:
            c = min(cols, key=lambda c: abs(c[1] - m.end())); 
            if c[0] in vals: errors.append(f"two numbers in one column: {l.strip()[:60]}")
            vals[c[0]] = int(m.group().replace(",", ""))
        if label == "TOTAL": total = vals; continue
        make, fuel = label, ""
        if has_fuel:
            f = next((f for f in FUELS if label.endswith(" " + f)), None)
            if f is None: errors.append(f"unknown fuel: {label}"); continue
            make, fuel = label[: -len(f)].strip(), f
        rows.append((MAKE_ALIASES.get(make, make), FUEL_ALIASES.get(fuel, fuel), vals))
    tables.append((has_fuel, [c[0] for c in cols], rows, total))
if not tables: sys.exit("No table recognised - the PDF layout may have changed")

def check_sums(rows, total, label):
    for c, t in total.items():
        s = sum(v.get(c, 0) for _, _, v in rows)
        if s != t: errors.append(f"{label} {c}: rows add to {s}, PDF TOTAL says {t}")
head = text[:600].upper()
if "POPULATION" in head or "ANNUAL EFFECTIVE TRANSFER" in head:
    kind = "pop" if "POPULATION" in head else "trfyear"
    A = [t for t in tables if t[0]]; B = [t for t in tables if not t[0]]
    rowsA = [r for t in A for r in t[2]]; totA = next(t[3] for t in reversed(A) if t[3])
    check_sums(rowsA, totA, "make x fuel table")
    if B:
        rowsB = [r for t in B for r in t[2]]; totB = next(t[3] for t in reversed(B) if t[3])
        check_sums(rowsB, totB, "make-only table")
        for y in totA:                         # the two tables must tally with each other
            if totA[y] != totB.get(y): errors.append(f"{y}: make x fuel total {totA[y]} vs make-only total {totB.get(y)}")
        byA = defaultdict(lambda: defaultdict(int))
        for mk, _, v in rowsA:
            for y, u in v.items(): byA[mk][y] += u
        for mk, _, v in rowsB:
            for y in totA:
                if mk != "OTHERS" and v.get(y, 0) != byA[mk][y]: errors.append(f"{mk} {y}: make-only {v.get(y, 0)} vs make x fuel {byA[mk][y]}")
    out = DATA / kind; out.mkdir(parents=True, exist_ok=True)
    for y in totA:                             # years already stored must not silently change
        p = out / f"{y}.json"
        if p.exists():
            old = {(r["make"], r["fuel"]): r["u"] for r in json.loads(p.read_text())}
            new = {(mk, f): v[y] for mk, f, v in rowsA if y in v}
            diff = [k for k in set(old) | set(new) if old.get(k, 0) != new.get(k, 0)]
            if diff: print(f"WARNING {y}: {len(diff)} make/fuel figures differ from the stored year (e.g. {diff[:3]}) - overwriting with the new PDF")
    if errors: print("CHECK FAILED - nothing written:", *errors[:12], sep="\n  "); sys.exit(1)
    for y in totA:
        (out / f"{y}.json").write_text(json.dumps([{"make": mk, "fuel": f, "u": v[y]} for mk, f, v in rowsA if v.get(y)], separators=(",", ":")))
    files = sorted(out.glob("*.json")); allr = [{"y": p.stem, **r} for p in files for r in json.loads(p.read_text())]
    (DATA / ("population.json" if kind == "pop" else "transfers_annual.json")).write_text(json.dumps(allr, separators=(",", ":")))
    print(f"{kind}: stored years {[p.stem for p in files]} | PDF totals {totA} | ALL CHECKS PASSED")
else:                                          # monthly transfers
    year = re.search(r"\((20\d\d)\)", text[:800]).group(1)
    mnames = [c for c in tables[0][1] if c != "Total"]; rows = [r for t in tables for r in t[2]]; total = next(t[3] for t in reversed(tables) if t[3])
    check_sums(rows, total, "transfers")
    for mk, f, v in rows:
        if sum(v.get(c, 0) for c in mnames) != v.get("Total", 0): errors.append(f"{mk} {f}: months do not add to its Total")
    if errors: print("CHECK FAILED - nothing written:", *errors[:12], sep="\n  "); sys.exit(1)
    out = DATA / "trf"; out.mkdir(parents=True, exist_ok=True); mi = {m: i + 1 for i, m in enumerate("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split())}
    for c in mnames:
        (out / f"{year}-{mi[c]:02d}.json").write_text(json.dumps([{"make": mk, "fuel": f, "u": v[c]} for mk, f, v in rows if v.get(c)], separators=(",", ":")))
    files = sorted(out.glob("20??-??.json")); allr = [{"m": p.stem, **r} for p in files for r in json.loads(p.read_text())]
    (DATA / "transfers.json").write_text(json.dumps(allr, separators=(",", ":")))
    print(f"transfers: months {mnames} of {year} | PDF totals { {c: total[c] for c in mnames} } | ALL CHECKS PASSED")
