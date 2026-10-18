"""Shared storage helpers: one JSON file per month in site/data/regn/, rebuilt into the single file the website loads."""
import json
from collections import defaultdict
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "site" / "data"
REGN = DATA / "regn"
LOOKUPS = Path(__file__).resolve().parent.parent / "lookups.json"   # make -> country/tier, make|importer -> distributor (edit by hand)

def save_months(rows, overwrite=True):
    """Write rows grouped by month. overwrite=False keeps any month file that already exists."""
    REGN.mkdir(parents=True, exist_ok=True)
    by_month = defaultdict(list)
    for r in rows:
        by_month[r["m"]].append({k: r[k] for k in ("m", "make", "importer", "fuel", "body", "u")})
    written = []
    for m, rs in sorted(by_month.items()):
        p = REGN / f"{m}.json"
        if p.exists() and not overwrite:
            continue
        p.write_text(json.dumps(rs, separators=(",", ":")), encoding="utf-8")
        written.append(m)
    return written

def rebuild():
    """Combine every month file, add country/tier/distributor from lookups.json, write registrations.json + meta.json."""
    lk = json.loads(LOOKUPS.read_text(encoding="utf-8")) if LOOKUPS.exists() else {"make": {}, "distributor": {}}
    rows, unknown = [], set()
    files = sorted(REGN.glob("20??-??.json"))
    for p in files:
        for r in json.loads(p.read_text(encoding="utf-8")):
            info = lk["make"].get(r["make"])
            if info is None:
                unknown.add(r["make"])
                info = {"country": "Unknown", "tier": ""}
            r["country"], r["tier"] = info["country"], info["tier"]
            r["distributor"] = lk["distributor"].get(f'{r["make"]}|{r["importer"]}', "")
            rows.append(r)
    (DATA / "registrations.json").write_text(json.dumps(rows, separators=(",", ":")), encoding="utf-8")
    months = [p.stem for p in files]
    (DATA / "meta.json").write_text(json.dumps({"latest": months[-1], "months": months, "rows": len(rows)}), encoding="utf-8")
    print(f"rebuilt registrations.json: {len(rows)} rows, {len(months)} months ({months[0]} to {months[-1]})")
    if unknown:
        print("NEW MAKES NOT IN lookups.json (add country/tier):", sorted(unknown))
