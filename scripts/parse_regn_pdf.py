"""Parse LTA 'New Registration of Cars by Make' PDF (M03) into rows and validate it three ways before saving anything:
  1. every row: HB+SDN+MPV+STW+SUV+CPE equals the row's own Total, per month
  2. every row: the left-hand Total (period total) equals the sum of its months
  3. every section: parsed month totals equal the PDF's own bottom 'Total' row
Handles: rows continuing over several pages, 2 to 6 months across, and a file that contains both halves of the year.
Usage: python scripts/parse_regn_pdf.py path/to/M03.pdf
Writes one file per month to site/data/regn/ (overwriting), then rebuilds site/data/registrations.json
"""
import re, sys
from collections import defaultdict
from pathlib import Path
import pdfplumber
sys.path.insert(0, str(Path(__file__).resolve().parent))
import store

SRC = Path(sys.argv[1])
BODY = ["HB", "SDN", "MPV", "STW", "SUV", "CPE"]
HEAD = {"HB", "SDN", "MPV", "STW", "SUV", "Conv", "Total"}
MAKE_ALIASES = {"B.M.W.": "BMW", "M.G.": "MG"}   # keep identical to build_data.py
FUEL_ALIASES = {"Petrol-Electric (Plug-In)": "Petrol-Electric (Plug-in)"}
NUM = re.compile(r"^\d[\d,]*$")
MONTH = re.compile(r"^\d{4}-\d{2}$")
errors, all_rows = [], []
sections_checked = 0

def group_lines(words, tol=2.0):
    lines = []
    for w in sorted(words, key=lambda w: (w["top"], w["x0"])):
        if lines and abs(lines[-1][0] - w["top"]) <= tol:
            lines[-1][1].append(w)
        else:
            lines.append([w["top"], [w]])
    return [sorted(ws, key=lambda w: w["x0"]) for _, ws in lines]

sec_rows, sec_months = [], []          # rows of the section currently being read

def close_section(control, ytd_ctrl, months):
    """Validate the finished section against its Total row."""
    global sec_rows, sections_checked
    got = defaultdict(int)
    for r in sec_rows:
        got[r["m"]] += r["u"]
    for m in months:
        ok = got[m] == control[m]
        print(f'{"OK " if ok else "MISMATCH"} {m}: parsed {got[m]} vs PDF total {control[m]}')
        if not ok: errors.append(f"month total {m}")
    if sum(got.values()) != ytd_ctrl:
        errors.append("section YTD"); print("MISMATCH section period total", sum(got.values()), "vs", ytd_ctrl)
    all_rows.extend(sec_rows); sec_rows = []; sections_checked += 1

with pdfplumber.open(SRC) as pdf:
    for page in pdf.pages:
        words = page.extract_words()
        months = sorted((w for w in words if MONTH.match(w["text"])), key=lambda w: w["x0"])
        heads = sorted((w for w in words if w["text"] in HEAD and 90 < w["top"] < 97), key=lambda w: w["x0"])
        if not months or len(heads) < 7:
            continue
        col_x1 = [h["x1"] for h in heads]
        n_blocks = len(col_x1) // 7
        month_names = [m["text"] for m in months][:n_blocks]
        if sec_months and sec_months != month_names:      # a new section starts on this page
            if sec_rows: errors.append("section ended without a Total row"); sec_rows = []
        sec_months = month_names
        first_left = heads[0]["x0"]
        data_top = max(h["top"] for h in heads) + 5
        for line in group_lines([w for w in words if w["top"] > data_top]):
            if line[0]["text"].startswith("Note"):
                break
            vals = [w for w in line if NUM.match(w["text"]) and w["x1"] > first_left - 25]
            labels = [w["text"] for w in line if not NUM.match(w["text"]) or w["x1"] <= first_left - 25]
            cells, ytd = defaultdict(int), None
            for v in vals:
                n = int(v["text"].replace(",", ""))
                if v["x1"] < col_x1[0] - 5:
                    ytd = n; continue
                idx = min(range(len(col_x1)), key=lambda i: abs(col_x1[i] + 2.3 - v["x1"]))
                cells[(idx // 7, idx % 7)] = n
            if labels[:3] == ["Total", "Total", "Total"]:
                close_section({m: cells[(b, 6)] for b, m in enumerate(month_names)}, ytd, month_names)
                continue
            k = next((i for i, t in enumerate(labels) if t in ("AMD", "PI")), None)
            if k is None or k == 0:
                continue
            make = MAKE_ALIASES.get(" ".join(labels[:k]), " ".join(labels[:k]))
            fuel = FUEL_ALIASES.get(" ".join(labels[k + 1:]), " ".join(labels[k + 1:]))
            row_total = 0
            for b, m in enumerate(month_names):
                body_sum = sum(cells[(b, c)] for c in range(6))
                row_total += cells[(b, 6)]
                if body_sum != cells[(b, 6)]:
                    errors.append(f"row {make} {labels[k]} {fuel} {m}"); print("ROW TOTAL MISMATCH", m, make, labels[k], fuel)
                for c, body in enumerate(BODY):
                    if cells[(b, c)]:
                        sec_rows.append({"m": m, "make": make, "importer": labels[k], "fuel": fuel, "body": body, "u": cells[(b, c)]})
            if ytd != row_total:
                errors.append(f"row period total {make} {labels[k]} {fuel}"); print("ROW PERIOD TOTAL MISMATCH", make, labels[k], fuel, ytd, row_total)

if sec_rows:
    errors.append("rows found after the last Total row (a page may be missing)")
if sections_checked == 0 or not all_rows:
    errors.append("nothing recognised - the PDF layout may have changed")
if errors:
    print("CHECK FAILED - nothing written:", errors[:10]); sys.exit(1)
print("months written (overwriting any earlier version):", store.save_months(all_rows, overwrite=True))
store.rebuild()
print(f"ALL CHECKS PASSED ({sections_checked} section(s), {len(all_rows)} rows)")
