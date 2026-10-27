"""Parse the LTA annual 'New registration of cars by make' PDF (MVP02-2) and store it, verified, as history.
Usage: python scripts/parse_newreg_pdf.py file.pdf
The PDF holds four tables with different detail: 2023-25 (importer type, fuel, body), 2022 (fuel, body),
2015-21 (fuel as Petrol / Diesel / Others, body with MPV and STW merged) and a make-only 2015-25 table.
In the 2015-21 table "Others" means Electric, Hybrid or Plug-in hybrid. Missing detail is stored as-is (fuel "Others", body "MPV/STW",
importer ""), never guessed.
Checks before saving: every row's body types add to its Total; every column adds to the table's own TOTAL row; every make-year in the
detail tables equals the make-only table; the detail year totals equal the make-only totals.
Writes site/data/newreg/<year>.json, newreg_make.json and rebuilds newreg_annual.json.
"""
import json, re, subprocess, sys
from collections import defaultdict
from pathlib import Path

SRC = Path(sys.argv[1]); DATA = Path(__file__).resolve().parent.parent / "site" / "data"
FUELS = ["Petrol-Electric (Plug-In)", "Diesel-Electric (Plug-In)", "Petrol-Electric", "Diesel-Electric", "Petrol-CNG", "Petrol", "Diesel", "Electric", "Others"]
MAKE_ALIASES = {"B.M.W.": "BMW", "M.G.": "MG"}; FUEL_ALIASES = {"Petrol-Electric (Plug-In)": "Petrol-Electric (Plug-in)", "Diesel-Electric (Plug-In)": "Diesel-Electric (Plug-in)"}
BODY7 = ["HB", "SDN", "MPV", "STW", "SUV", "CPE", "Total"]; BODY6 = ["HB", "SDN", "MPV/STW", "SUV", "CPE", "Total"]
NUM = re.compile(r"^\d[\d,]*$"); WORD = re.compile(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>')
errors = []
html = subprocess.run(["pdftotext", "-bbox", str(SRC), "-"], capture_output=True, text=True, check=True).stdout
pages = [[(float(a), float(b), float(c), float(d), t.replace("&amp;", "&")) for a, b, c, d, t in WORD.findall(pg)] for pg in re.split(r"<page ", html)[1:]]
make = lambda s: MAKE_ALIASES.get(s.strip().upper(), s.strip().upper())

def section_of(words):
    f = next((w for w in words if w[4].startswith("MVP02-2-New")), None)
    if not f: return None
    m = re.search(r"\((\d{4}(?:-\d{4})?)\)", " ".join(w[4] for w in sorted(words, key=lambda w: w[0]) if abs(w[1] - f[1]) < 3))
    return m.group(1) if m else None
secs = defaultdict(list)
for pw in pages:
    s = section_of(pw)
    if s: secs[s].append(pw)
if not secs: sys.exit("CHECK FAILED - no MVP02-2 tables found. The PDF layout may have changed.")
is_mk = {k: not any(w[4] == "HB" for w in secs[k][0]) for k in secs}    # make-only tables have no body-type columns

def lines(words):
    out = []
    for w in sorted(words, key=lambda w: (w[1], w[0])):
        if out and abs(out[-1][0] - w[1]) <= 2: out[-1][1].append(w)
        else: out.append([w[1], [w]])
    return [sorted(ws, key=lambda w: w[0]) for _, ws in out]

def total_row(pw):
    t = next((w for w in pw if w[4] == "TOTAL" and w[0] < 60 and w[1] > 100), None)
    if not t: sys.exit("CHECK FAILED - no TOTAL row found")
    row = sorted([w for w in pw if abs(w[1] - t[1]) < 2 and w[0] > 60 and NUM.match(w[4])], key=lambda w: w[0])
    return [w[2] for w in row], [int(w[4].replace(",", "")) for w in row]

def read_rows(pws, anchors, label_fn):
    """-> list of (label_tokens, {anchor_index: value}). Only lines below each page's header are read; a row that wraps
    onto a second line (same page) is merged."""
    rows = []
    for pw in pws:
        hdr = max((w[1] for w in pw if w[4] in ("HB", "Make", "Make/", "Conv", "Period", "(Year)") and w[1] < 110), default=0)
        prev = None
        for ln in lines(pw):
            if ln[0][1] <= hdr + 2: continue
            lab = [w[4] for w in ln if not NUM.match(w[4])]
            vals = [w for w in ln if NUM.match(w[4]) and w[2] > anchors[0] - 8]
            if lab and lab[0].startswith(("Note", "MVP02")): break
            if not vals or (lab and lab[0] == "TOTAL"): continue
            cells = {}
            for w in vals:
                i = min(range(len(anchors)), key=lambda i: abs(anchors[i] - w[2]))
                if abs(anchors[i] - w[2]) > 8: errors.append(f"number not under a column: {' '.join(x[4] for x in ln)[:70]}")
                cells[i] = int(w[4].replace(",", ""))
            if not lab and prev is not None:          # continuation of the previous row
                if set(prev[1]) & set(cells): errors.append(f"wrapped row overlaps: {' '.join(prev[0])}")
                prev[1].update(cells)
            elif lab:
                prev = (lab, cells); rows.append(prev)
    return rows

detail = []                                          # (year, make, importer, fuel, body, u)
for key in [k for k in secs if not is_mk[k]]:
    pws = secs[key]; anchors, totvals = total_row(pws[-1])
    yrs = sorted([(w[0], w[4]) for w in pws[0] if re.fullmatch(r"20\d\d", w[4]) and 40 < w[1] < 70])
    ncol = len(anchors) // len(yrs); cols = {7: BODY7, 6: BODY6}.get(ncol)
    if not cols or ncol * len(yrs) != len(anchors): sys.exit(f"CHECK FAILED - table {key}: {len(anchors)} columns for {len(yrs)} years")
    colsum = defaultdict(int)
    for lab, cells in read_rows(pws, anchors, None):
        imp = next((t for t in lab if t in ("AMD", "PI")), "")
        if imp: k = lab.index(imp); mk, fl = " ".join(lab[:k]), " ".join(lab[k + 1:])
        else:
            fl = next((f for f in FUELS if " ".join(lab).endswith(" " + f)), None)
            if not fl: errors.append(f"unknown fuel: {' '.join(lab)}"); continue
            mk = " ".join(lab)[: -len(fl)]
        fl = FUEL_ALIASES.get(fl, fl)
        for b, (_, y) in enumerate(yrs):
            vals = {cols[c]: cells.get(b * ncol + c, 0) for c in range(ncol)}
            for c in range(ncol): colsum[b * ncol + c] += vals[cols[c]]
            if sum(v for k2, v in vals.items() if k2 != "Total") != vals["Total"]: errors.append(f"{y} {mk} {imp} {fl}: body types do not add to the row total")
            for k2, v in vals.items():
                if k2 != "Total" and v: detail.append((int(y), make(mk), imp, fl, k2, v))
    for i, t in enumerate(totvals):
        if colsum[i] != t: errors.append(f"table {key} column {i + 1} (year {yrs[i // ncol][1]}, {cols[i % ncol]}): rows add to {colsum[i]}, PDF TOTAL says {t}")

mk_only = {}
for key in [k for k in secs if is_mk[k]]:
    pws = secs[key]; anchors, totvals = total_row(pws[-1])
    yrs = sorted([(w[0], int(w[4])) for w in pws[0] if re.fullmatch(r"20\d\d", w[4]) and 40 < w[1] < 80])
    if len(yrs) != len(anchors): sys.exit("CHECK FAILED - make-only table columns do not match its years")
    colsum = defaultdict(int)
    for lab, cells in read_rows(pws, anchors, None):
        for i, v in cells.items(): mk_only[(yrs[i][1], make(" ".join(lab)))] = v; colsum[i] += v
    for i, t in enumerate(totvals):
        if colsum[i] != t: errors.append(f"make-only {yrs[i][1]}: rows add to {colsum[i]}, PDF TOTAL says {t}")
agg = defaultdict(int)
for y, mk, _, _, _, u in detail: agg[(y, mk)] += u
shared = {y for y, _, _, _, _, _ in detail} & {y for y, _ in mk_only}        # tally detail against make-only wherever both exist
for k in {k for k in set(agg) | set(mk_only) if k[0] in shared}:
    if agg[k] != mk_only.get(k, 0): errors.append(f"{k[1]} {k[0]}: detail tables add to {agg[k]}, make-only table says {mk_only.get(k, 0)}")
for k, u in agg.items(): mk_only.setdefault(k, u)                              # detail-only years still feed the make-level history
if errors: print("CHECK FAILED - nothing written:", *errors[:15], sep="\n  "); sys.exit(1)

out = DATA / "newreg"; out.mkdir(parents=True, exist_ok=True)
byy = defaultdict(list)
for y, mk, imp, fl, body, u in detail: byy[y].append({"make": mk, "importer": imp, "fuel": fl, "body": body, "u": u})
for y, rs in sorted(byy.items()):
    p = out / f"{y}.json"
    if p.exists():
        old = {(r["make"], r["importer"], r["fuel"], r["body"]): r["u"] for r in json.loads(p.read_text())}
        diff = [k for k in set(old) | {(r["make"], r["importer"], r["fuel"], r["body"]) for r in rs} if old.get(k, 0) != next((r["u"] for r in rs if (r["make"], r["importer"], r["fuel"], r["body"]) == k), 0)]
        if diff: print(f"WARNING {y}: {len(diff)} figures differ from the stored year - overwriting with the new PDF")
    p.write_text(json.dumps(rs, separators=(",", ":")))
mp = DATA / "newreg_make.json"
cur = {(r["y"], r["make"]): r["u"] for r in json.loads(mp.read_text())} if mp.exists() else {}
cur.update(mk_only); mp.write_text(json.dumps([{"y": y, "make": m, "u": u} for (y, m), u in sorted(cur.items())], separators=(",", ":")))
files = sorted(out.glob("20??.json")); (DATA / "newreg_annual.json").write_text(json.dumps([{"y": int(p.stem), **r} for p in files for r in json.loads(p.read_text())], separators=(",", ":")))
tot = defaultdict(int)
for (y, _), u in mk_only.items(): tot[y] += u
print(f"new registrations: years {[int(p.stem) for p in files]} | {len(detail)} detail rows | totals by year {dict(sorted(tot.items()))} | ALL CHECKS PASSED")
