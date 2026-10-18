"""Build the 'moving record' of car costs from the monthly files in site/data/costs/.
Writes site/data/cost_history.json (one entry per model, with its month-by-month series, plus COE premium by month)
and site/data/cost_changes.json (what changed between the two most recent months).
Models are matched across months by make + model + fuel + cc + kW + COE category (duplicates within a month are
numbered in PDF order). If a distributor renames a model, add a line to cost_aliases.json:  {"old key": "new key"}
"""
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COSTS = ROOT / "site" / "data" / "costs"
OUT = ROOT / "site" / "data"
ALIASES = ROOT / "cost_aliases.json"
FIELDS = ["omv", "arf", "basic_ex_coe", "basic_with_coe", "price_ex_coe", "price_with_coe", "coe"]

def rebuild():
    aliases = json.loads(ALIASES.read_text(encoding="utf-8")) if ALIASES.exists() else {}
    files = sorted(COSTS.glob("20??-??.json"))
    if not files:
        return
    months, models, coe, keys_by_month = [], {}, defaultdict(dict), {}
    for p in files:
        m = p.stem; months.append(m); seen = defaultdict(int); keys = set()
        for r in sorted(json.loads(p.read_text(encoding="utf-8")), key=lambda r: r["sn"]):
            base = "|".join([r["make"], r["model"], r["fuel"], str(r["cc"] or ""), str(r["kw"]), r["coe_cat"]])
            seen[base] += 1
            key = base if seen[base] == 1 else f"{base}#{seen[base]}"
            key = aliases.get(key, key)
            mod = models.setdefault(key, {"id": key, "make": r["make"], "model": r["model"], "fuel": r["fuel"],
                                          "cc": r["cc"], "kw": r["kw"], "cat": r["coe_cat"], "s": {}})
            mod["model"] = r["model"]                       # latest name wins
            mod["s"][m] = [r[f] for f in FIELDS]
            coe[r["coe_cat"]][m] = r["coe"]
            keys.add(key)
        keys_by_month[m] = keys
    out = sorted(models.values(), key=lambda x: (x["make"], x["model"]))
    for mod in out:
        ms = sorted(mod["s"]); mod["first"], mod["last"] = ms[0], ms[-1]
    (OUT / "cost_history.json").write_text(json.dumps({"fields": FIELDS, "months": months, "coe": coe, "models": out},
                                                      separators=(",", ":")), encoding="utf-8")
    # what changed between the latest two months
    latest = months[-1]; prev = months[-2] if len(months) > 1 else None
    changes = {"month": latest, "prev": prev, "new": [], "removed": [], "price_moves": [], "cost_moves": [], "coe": {}}
    if prev:
        idx = {f: i for i, f in enumerate(FIELDS)}
        changes["new"] = sorted(keys_by_month[latest] - keys_by_month[prev])
        changes["removed"] = sorted(keys_by_month[prev] - keys_by_month[latest])
        for mod in out:
            a, b = mod["s"].get(prev), mod["s"].get(latest)
            if not (a and b):
                continue
            for field, bucket in (("price_with_coe", "price_moves"), ("basic_ex_coe", "cost_moves")):
                x, y = a[idx[field]], b[idx[field]]
                if x is not None and y is not None and x != y:
                    changes[bucket].append({"id": mod["id"], "from": x, "to": y, "pct": round((y - x) / x * 100, 2)})
        changes["coe"] = {c: {"from": coe[c].get(prev), "to": coe[c].get(latest)} for c in coe}
        for b in ("price_moves", "cost_moves"):
            changes[b].sort(key=lambda d: -abs(d["pct"]))
    (OUT / "cost_changes.json").write_text(json.dumps(changes, separators=(",", ":")), encoding="utf-8")
    print(f"cost history: {len(out)} models, {len(months)} month(s) ({months[0]} to {latest})",
          f"| vs {prev}: {len(changes['new'])} new, {len(changes['removed'])} removed, {len(changes['price_moves'])} price moves" if prev else "")


if __name__ == "__main__":
    rebuild()
