"""Sanity checks on the stored data. Prints a report and writes site/data/sanity.json. Never blocks an upload - it flags things to look at."""
import json
from pathlib import Path
D = Path(__file__).resolve().parent.parent / "site" / "data"
def load(n): return json.loads((D / n).read_text(encoding="utf-8")) if (D / n).exists() else None
def idx(m): y, mo = map(int, m.split("-")[:2]); return y * 12 + mo
def run():
    issues = []
    def months(rows, label, jump=0.6):
        t = {}
        for r in rows: t[r["m"]] = t.get(r["m"], 0) + r["u"]
        ms = sorted(t)
        for a, b in zip(ms, ms[1:]):
            if idx(b) - idx(a) != 1: issues.append(f"{label}: months missing between {a} and {b}")
            elif t[a] and abs(t[b] / t[a] - 1) > jump: issues.append(f"{label}: {b} total {t[b]:,} is {t[b] / t[a] - 1:+.0%} vs {a} - check the PDF")
        return t
    R = load("registrations.json")
    if R:
        months(R, "registrations")
        unk = sorted({r["make"] for r in R if r.get("country") == "Unknown"})
        if unk: issues.append("registrations: makes still on country 'Unknown' in lookups.json: " + ", ".join(unk))
    T = load("transfers.json")
    if T: months(T, "transfers", 0.6)
    P = load("population.json")
    if P:
        ys = sorted({int(r["y"]) for r in P}); tot = {y: sum(r["u"] for r in P if int(r["y"]) == y) for y in ys}
        if any(b - a != 1 for a, b in zip(ys, ys[1:])): issues.append(f"population: years missing in {ys}")
        for a, b in zip(ys, ys[1:]):
            if abs(tot[b] / tot[a] - 1) > 0.05: issues.append(f"population: {b} total {tot[b]:,} moved {tot[b] / tot[a] - 1:+.1%} from {a}")
        if R:
            last = max(r["m"] for r in R); ny = ys[-1] + 1
            if last[:4] > str(ys[-1]) and str(ny) <= last[:4]: pass
            elif last[:4] > str(ys[-1] + 0): issues.append(f"population: registrations reach {last} but the latest population year is {ys[-1]}")
    C = load("coe.json")
    if C:
        by = {}
        for r in C: by.setdefault(r["c"], []).append(r)
        for c, l in by.items():
            l.sort(key=lambda r: r["d"])
            if len(l) > 1 and abs(l[-1]["p"] / l[-2]["p"] - 1) > 0.4: issues.append(f"COE Cat {c}: premium moved {l[-1]['p'] / l[-2]['p'] - 1:+.0%} at the latest exercise ({l[-1]['d']}) - check the CSV")
        ms = {}
        for d in sorted({r["d"] for r in C})[-48:]: ms[d[:7]] = ms.get(d[:7], 0) + 1
        for m, n in sorted(ms.items())[1:-1]:
            if n != 2: issues.append(f"COE: {m} has {n} bidding exercise(s), expected 2")
    M = load("popmodel.json")
    if M:
        mt = M["meta"]; best = mt["methods"][mt["chosen"]]["mae_pct"]
        if best > 2: issues.append(f"population model: backtest error is {best:.1f}% of population, so the estimate is less reliable than usual")
        for mk, h in M["history"].items():
            y = str(mt["pop_year"]); dv = h["dereg"].get(y, h["dereg"].get(int(y)))
            if dv is not None and dv < -50 and h["pop"].get(y, h["pop"].get(int(y)), 0) >= 1000: issues.append(f"population model: {mk} shows {dv:,} implied deregistrations in {y} (more cars than registrations explain) - check the PDFs")
        if mt.get("est_year") and mt["est_latest_month"] < max(r["m"] for r in R or [{"m": ""}]): issues.append("population model: estimate is older than the latest registrations - run an upload to refresh it")
    (D / "sanity.json").write_text(json.dumps({"issues": issues}), encoding="utf-8")
    print("SANITY CHECKS:", "all clear" if not issues else f"{len(issues)} thing(s) to look at")
    for i in issues: print("  -", i)
if __name__ == "__main__": run()
