"""Build site/data/popmodel.json: population history by make, implied deregistrations, and an estimate of today's population.
Deregistrations are never published, so they are derived:  implied net deregistrations = last year's population + new registrations - this year's population.
(This also absorbs anything else that changes the count, such as used imports, so it is a net figure.)
The current-year estimate then works in two steps, and the method is chosen by backtesting on past years rather than assumed:
  1. MARKET TOTAL: four simple methods are each tested on 2019 onwards, using only data from before the year being predicted. The one with the
     lowest average error is used for the total number of deregistrations so far this year.
  2. SPLIT BY MAKE AND FUEL: each make/fuel's share is its opening population times its own recent deregistration rate, scaled to the market total.
Detail by fuel exists only from 2022, and body type is not needed; earlier years work at make level.
"""
import json, statistics as stt
from collections import defaultdict
from pathlib import Path

D = Path(__file__).resolve().parent.parent / "site" / "data"
def load(n):
    p = D / n
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None
METHODS = {"last_rate": "last year's deregistration rate", "avg_rate3": "3-year average deregistration rate",
           "flat_growth": "population growth in line with the last 3 years", "ratio3": "deregistrations as a share of new registrations (3-year average)"}

def fuel_group(f):
    return "Others" if f == "Others" else "Petrol" if f.startswith("Petrol") and "Electric" not in f else "Diesel" if f == "Diesel" else "Others"

def rebuild():
    pm, nm, pf, nd, R = (load(n) for n in ("pop_make.json", "newreg_make.json", "population.json", "newreg_annual.json", "registrations.json"))
    if not (pm and nm):
        print("POPULATION MODEL: needs the population PDF and the annual new registrations PDF - skipped"); return
    POP = {(r["y"], r["make"]): r["u"] for r in pm}; NEW = {(r["y"], r["make"]): r["u"] for r in nm}
    ys = sorted({y for y, _ in POP}); Y = ys[-1]
    P = {y: sum(u for (yy, _), u in POP.items() if yy == y) for y in ys}; N = {y: sum(u for (yy, _), u in NEW.items() if yy == y) for y in ys if any(yy == y for yy, _ in NEW)}
    DER = {y: P[y - 1] + N[y] - P[y] for y in ys[1:] if y in N}
    prior = lambda y: [yy for yy in sorted(DER) if yy < y][-3:]

    def dereg(method, y, O, n, f):                  # deregistrations expected in a fraction f of year y (n = new registrations in that part)
        h = prior(y)
        if method == "last_rate": return DER[h[-1]] / P[h[-1] - 1] * O * f
        if method == "avg_rate3": return stt.mean(DER[k] / P[k - 1] for k in h) * O * f
        if method == "flat_growth": return n - stt.mean(P[k] / P[k - 1] - 1 for k in h) * O * f
        return stt.mean(DER[k] / N[k] for k in h) * n
    back = {m: [] for m in METHODS}
    for y in sorted(DER):
        if len(prior(y)) < 3: continue
        for m in METHODS:
            pred = P[y - 1] + N[y] - dereg(m, y, P[y - 1], N[y], 1); back[m].append((y, (pred - P[y]) / P[y] * 100))
    mae = {m: stt.mean(abs(e) for _, e in v) for m, v in back.items() if v}
    best = min(mae, key=mae.get)
    naive = stt.mean(abs((P[y - 1] + N[y] - P[y]) / P[y] * 100) for y, _ in back[best])

    def rates(upto, minprev=50):                   # make-level rates from years before `upto`
        out = defaultdict(list); tot = []
        for y in prior(upto):
            for (yy, mk), prev in POP.items():
                if yy == y - 1 and prev >= minprev:
                    r = (prev + NEW.get((y, mk), 0) - POP.get((y, mk), 0)) / prev; out[mk].append(max(0, r))
            tot.append(DER[y] / P[y - 1])
        avg = stt.mean(tot) if tot else 0.05
        return {mk: stt.mean(v) for mk, v in out.items()}, avg
    def split(Yb, Ddr):                            # allocate a market-level deregistration total across makes
        mr, avg = rates(Yb); w = {mk: POP[(Yb - 1, mk)] * mr.get(mk, avg) for (yy, mk) in POP if yy == Yb - 1 and POP[(yy, mk)] > 0}
        s = sum(w.values()); return {mk: v / s * Ddr for mk, v in w.items()} if s else {}
    wape, wape0, mape = [], [], []
    for y, _ in back[best]:
        dm = split(y, dereg(best, y, P[y - 1], N[y], 1)); mks = {mk for (yy, mk) in POP if yy in (y - 1, y)} | {mk for (yy, mk) in NEW if yy == y}
        pred = {mk: max(0, POP.get((y - 1, mk), 0) + NEW.get((y, mk), 0) - dm.get(mk, 0)) for mk in mks}; act = {mk: POP.get((y, mk), 0) for mk in mks}
        base = {mk: POP.get((y - 1, mk), 0) + NEW.get((y, mk), 0) for mk in mks}; sa = sum(act.values())
        wape.append(sum(abs(pred[m] - act[m]) for m in mks) / sa * 100); wape0.append(sum(abs(base[m] - act[m]) for m in mks) / sa * 100)
        mape.append(stt.median(abs(pred[m] - act[m]) / act[m] * 100 for m in mks if act[m] >= 1000))

    # ---- history by make
    last3 = {mk for (y, mk), u in NEW.items() if y >= Y - 2} | {mk for (y, mk), u in POP.items() if y == Y and u > 0}
    hist = {}
    for mk in sorted({mk for (_, mk) in POP} | {mk for (_, mk) in NEW}):
        pops = {y: POP[(y, mk)] for y in ys if (y, mk) in POP}; news = {y: NEW[(y, mk)] for y in ys if (y, mk) in NEW}
        der = {y: POP[(y - 1, mk)] + NEW.get((y, mk), 0) - POP.get((y, mk), 0) for y in ys[1:] if (y - 1, mk) in POP}
        if pops or news: hist[mk] = {"pop": pops, "new": news, "dereg": der}
    # ---- estimate for the year after the latest population year, split by make and fuel
    est, meta = [], {"pop_year": Y, "methods": {m: {"label": METHODS[m], "mae_pct": round(mae[m], 2), "by_year": {y: round(e, 2) for y, e in back[m]}} for m in mae},
                     "chosen": best, "backtest": {"model_wape_pct": round(stt.mean(wape), 2), "no_deregistration_wape_pct": round(stt.mean(wape0), 2), "median_make_error_pct": round(stt.median(mape), 2),
                                                  "years": [y for y, _ in back[best]]}, "total_dereg_by_year": DER, "pop_by_year": P, "new_by_year": N}
    ym = sorted({r["m"] for r in (R or []) if r["m"].startswith(str(Y + 1))})
    if pf and R and ym:
        FP = defaultdict(int); FN = defaultdict(int)
        for r in pf: FP[(int(r["y"]), r["make"], r["fuel"])] += r["u"]
        for r in (nd or []): FN[(r["y"], r["make"], r["fuel"])] += r["u"]
        fy = sorted({k[0] for k in FP}); fr = defaultdict(list); gp = defaultdict(lambda: [0, 0])
        for y in fy[1:]:
            for (yy, mk, fl), prev in list(FP.items()):
                if yy == y - 1 and prev >= 30:
                    dd = prev + FN.get((y, mk, fl), 0) - FP.get((y, mk, fl), 0); fr[(mk, fl)].append(max(0, dd / prev)); gp[fl][0] += max(0, dd); gp[fl][1] += prev
        base = {k: v for k, v in FP.items() if k[0] == Y and v > 0}; ytd = defaultdict(int)
        for r in R:
            if r["m"] in ym: ytd[(r["make"], r["fuel"])] += r["u"]
        f = len(ym) / 12; n_ytd = sum(ytd.values()); O = sum(base.values()); Dtot = max(0, dereg(best, Y + 1, O, n_ytd, f)) if len(prior(Y + 1)) == 3 else 0
        allr = sum(DER[k] / P[k - 1] for k in prior(Y + 1)) / 3
        rate = lambda mk, fl: stt.mean(fr[(mk, fl)]) if fr.get((mk, fl)) else (gp[fl][0] / gp[fl][1] if gp.get(fl) and gp[fl][1] else allr)
        w = {k: v * rate(k[1], k[2]) for k, v in base.items()}; s = sum(w.values()) or 1
        band = mae[best] / 100
        for mk, fl in sorted({(k[1], k[2]) for k in base} | set(ytd)):
            b, n = base.get((Y, mk, fl), 0), ytd.get((mk, fl), 0); dr = min(b + n, w.get((Y, mk, fl), 0) / s * Dtot)
            e = b + n - dr; est.append({"make": mk, "fuel": fl, "base": b, "ytd": n, "dereg": round(dr), "est": round(e), "low": round(e * (1 - band)), "high": round(e * (1 + band))})
        meta.update({"est_year": Y + 1, "est_months": len(ym), "est_latest_month": ym[-1], "est_total_dereg": round(Dtot), "est_total_new": n_ytd, "est_opening": O})
    gr = defaultdict(int)                          # new registrations on one consistent footing for 2015 onwards
    for r in (nd or []): gr[(r["y"], fuel_group(r["fuel"]), "MPV/STW" if r["body"] in ("MPV", "STW") else r["body"])] += r["u"]
    out = {"meta": meta, "history": hist, "est": est, "groups": [{"y": y, "fuel": fg, "body": b, "u": u} for (y, fg, b), u in sorted(gr.items())]}
    (D / "popmodel.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    ev = meta.get("est_year")
    print(f"POPULATION MODEL: method '{METHODS[best]}' (average backtest error {mae[best]:.2f}% of population over {back[best][0][0]}-{back[best][-1][0]}; ignoring deregistrations entirely would be off by {naive:.2f}%)")
    print(f"  make-level backtest: model {stt.mean(wape):.1f}% vs {stt.mean(wape0):.1f}% with no deregistrations (share of cars misallocated); typical make off by {stt.median(mape):.1f}%")
    if ev: print(f"  {ev} to {ym[-1]}: opening {O:,} + new {n_ytd:,} - estimated deregistrations {round(Dtot):,} = about {O + n_ytd - round(Dtot):,}")
if __name__ == "__main__": rebuild()
