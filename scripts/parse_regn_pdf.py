"""Parse LTA 'New Registration of Cars by Make' PDF (M03) into rows and validate against the PDF's own Total row.
Usage: python scripts/parse_regn_pdf.py path/to/M03.pdf
Writes one file per month found in the PDF to site/data/regn/, then rebuilds site/data/registrations.json
"""
import json, re, sys
from collections import defaultdict
from pathlib import Path
import pdfplumber

SRC = Path(sys.argv[1])
sys.path.insert(0, str(Path(__file__).resolve().parent))
import store

BODY = ["HB", "SDN", "MPV", "STW", "SUV", "CPE"]
HEAD = {"HB", "SDN", "MPV", "STW", "SUV", "Conv", "Total"}
MAKE_ALIASES = {"B.M.W.": "BMW", "M.G.": "MG"}   # keep identical to build_data.py
FUEL_ALIASES = {"Petrol-Electric (Plug-In)": "Petrol-Electric (Plug-in)"}
NUM = re.compile(r"^\d[\d,]*$")
MONTH = re.compile(r"^\d{4}-\d{2}$")

def group_lines(words, tol=2.0):
    lines = []
    for w in sorted(words, key=lambda w: (w["top"], w["x0"])):
        if lines and abs(lines[-1][0] - w["top"]) <= tol:
            lines[-1][1].append(w)
        else:
            lines.append([w["top"], [w]])
    return [sorted(ws, key=lambda w: w["x0"]) for _, ws in lines]

rows, control = [], {}
with pdfplumber.open(SRC) as pdf:
    for page in pdf.pages:
        words = page.extract_words()
        months = sorted((w for w in words if MONTH.match(w["text"])), key=lambda w: w["x0"])
        heads = sorted((w for w in words if w["text"] in HEAD and w["top"] > 90 and w["top"] < 97), key=lambda w: w["x0"])
        if not months or len(heads) < 7:
            continue
        # column right-edges: 7 header words per month block (HB..Conv,Total)
        col_x1 = [h["x1"] for h in heads]
        n_blocks = len(col_x1) // 7
        month_names = [m["text"] for m in months][:n_blocks]
        first_block_left = heads[0]["x0"]
        data_top = max(h["top"] for h in heads) + 5
        for line in group_lines([w for w in words if w["top"] > data_top]):
            texts = [w["text"] for w in line]
            if texts[0].startswith("Note"):
                break
            vals = [w for w in line if NUM.match(w["text"]) and w["x1"] > first_block_left - 25]
            labels = [w["text"] for w in line if not NUM.match(w["text"]) or w["x1"] <= first_block_left - 25]
            cells = defaultdict(int)  # (block, col) -> units ; col 0-5 body, 6 total
            ytd = None
            for v in vals:
                n = int(v["text"].replace(",", ""))
                if v["x1"] < first_block_left + 5 - 0 and v["x1"] < col_x1[0] - 5:
                    ytd = n; continue
                idx = min(range(len(col_x1)), key=lambda i: abs(col_x1[i] + 2.3 - v["x1"]))
                cells[(idx // 7, idx % 7)] = n
            if labels[:3] == ["Total", "Total", "Total"]:
                for b, m in enumerate(month_names):
                    control[m] = cells[(b, 6)]
                control["YTD"] = ytd
                continue
            if len(labels) < 3 or labels[0] in ("Note:", "LTA", "Web/M03-Cars", "(M03)"):
                continue
            # label = MAKE... IMPORTER FUEL...
            try:
                k = next(i for i, t in enumerate(labels) if t in ("AMD", "PI"))
            except StopIteration:
                continue
            make = MAKE_ALIASES.get(" ".join(labels[:k]), " ".join(labels[:k]))
            importer = labels[k]
            fuel = FUEL_ALIASES.get(" ".join(labels[k + 1:]), " ".join(labels[k + 1:]))
            for b, m in enumerate(month_names):
                body_sum = sum(cells[(b, c)] for c in range(6))
                if body_sum != cells[(b, 6)]:
                    print("ROW TOTAL MISMATCH", m, make, importer, fuel, body_sum, cells[(b, 6)])
                for c, body in enumerate(BODY):
                    if cells[(b, c)]:
                        rows.append({"m": m, "make": make, "importer": importer, "fuel": fuel, "body": body, "u": cells[(b, c)]})

# validate against the PDF's own Total row
by_month = defaultdict(int)
for r in rows:
    by_month[r["m"]] += r["u"]
ok = True
for m in sorted(k for k in control if k != "YTD"):
    flag = "OK " if by_month[m] == control[m] else "MISMATCH"
    ok &= by_month[m] == control[m]
    print(f"{flag} {m}: parsed {by_month[m]} vs PDF total {control[m]}")
print("YTD parsed", sum(by_month.values()), "vs PDF", control.get("YTD"))
if not ok:
    print("CHECK FAILED - nothing written"); sys.exit(1)
print("months written (overwriting any earlier version):", store.save_months(rows, overwrite=True))
store.rebuild()
print("ALL CHECKS PASSED")
