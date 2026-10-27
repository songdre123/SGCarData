const MODE = new URLSearchParams(location.search).get("t") === "trf" ? "trf" : "pop";
const $ = id => document.getElementById(id), fmt = n => Number(n).toLocaleString("en-SG");
const J = u => fetch(u).then(r => r.ok ? r.json() : null).catch(() => null);
const PAL = ["#3ddbb0", "#f2b84b", "#5aa9ff", "#ff6b5e", "#b28cff", "#7ee081", "#ff9f5a", "#4fd1e8", "#e86fa8", "#c3d35a"];
const VIEWS = { est: "Estimated population now", hist: "Population by year", dereg: "Deregistrations by year", newreg: "New registrations by year" };
let D = {}, chart = {};
const draw = (id, cfg) => { chart[id]?.destroy(); chart[id] = new Chart($(id), cfg); };
const lbl = m => new Date(m + "-01").toLocaleDateString("en-GB", { month: "short", year: "numeric" });
const heads = cols => $("heads").innerHTML = cols.map(c => `<th${c.num ? ' class="num"' : ""}>${c.h}</th>`).join("");

(async () => {
  const [meta, reg, pop, trf, mod] = await Promise.all(["meta", "registrations", "population", "transfers", "popmodel"].map(n => J("data/" + n + ".json")));
  D = { meta, reg, pop, trf, mod };
  document.querySelectorAll(".nav-link").forEach(a => a.classList.toggle("active", a.getAttribute("href").endsWith("t=" + MODE)));
  const src = MODE === "pop" ? pop : trf;
  if (!src) { $("note").textContent = "No data yet. Upload the " + (MODE === "pop" ? "annual car population" : "monthly car transfer") + " PDF to the incoming folder."; return; }
  $("title").textContent = MODE === "pop" ? "Car population by make" : "Car ownership transfers by make";
  const fuels = [...new Set(src.map(r => r.fuel))].sort();
  $("fuel").innerHTML = '<option value="">All fuel types</option>' + fuels.map(f => `<option>${f}</option>`).join("");
  if (MODE === "trf") {
    const ms = [...new Set(trf.map(r => r.m))].sort(); $("month").innerHTML = '<option value="">All months</option>' + ms.map(m => `<option value="${m}">${lbl(m)}</option>`).join("");
    $("view").hidden = true; $("grp").hidden = true;
  } else {
    $("monthLbl").hidden = true;
    const ok = mod ? Object.keys(VIEWS) : ["est"];
    $("view").innerHTML = ok.map(v => `<option value="${v}">${VIEWS[v]}</option>`).join("");
  }
  ["view", "grp", "fuel", "split", "month", "search"].forEach(id => $(id).addEventListener("input", () => render(true)));
  render(true);
})();

function render(reset) {
  if (MODE === "trf") return renderTrf(reset);
  const v = $("view").value || "est";
  $("fuel").disabled = $("split").disabled = v !== "est"; $("grp").hidden = v !== "newreg"; $("c2wrap").hidden = true;
  $("title").textContent = v === "est" ? "Car population by make, estimated to date" : VIEWS[v];
  ({ est: viewEst, hist: viewHist, dereg: viewDereg, newreg: viewNew })[v](reset);
}

function estRows() {                           // from the model; falls back to opening + new registrations if no model has been built
  if (D.mod && D.mod.est.length) return D.mod.est;
  const py = Math.max(...D.pop.map(r => +r.y)), ms = D.meta.months.filter(m => m.startsWith(py + 1)), by = new Map();
  const add = (r, k, u) => { const key = r.make + "|" + r.fuel; if (!by.has(key)) by.set(key, { make: r.make, fuel: r.fuel, base: 0, ytd: 0, dereg: 0 }); by.get(key)[k] += u; };
  D.pop.filter(r => +r.y === py).forEach(r => add(r, "base", r.u)); D.reg.filter(r => ms.includes(r.m)).forEach(r => add(r, "ytd", r.u));
  return [...by.values()].map(o => ({ ...o, est: o.base + o.ytd, low: o.base + o.ytd, high: o.base + o.ytd }));
}
const rowsFilter = rows => { const q = $("search").value.trim().toLowerCase(); return rows.filter(r => !q || r.make.toLowerCase().includes(q)); };

function viewEst(reset) {
  const split = $("split").value === "fuel", fuel = $("fuel").value, by = new Map(), m = D.mod && D.mod.meta;
  estRows().filter(r => !fuel || r.fuel === fuel).forEach(r => {
    const k = r.make + "|" + (split ? r.fuel : ""); let o = by.get(k); if (!o) by.set(k, o = { make: r.make, fuel: split ? r.fuel : "", base: 0, ytd: 0, dereg: 0, est: 0, low: 0, high: 0 });
    ["base", "ytd", "dereg", "est", "low", "high"].forEach(f => o[f] += r[f]);
  });
  const rows = rowsFilter([...by.values()]).sort((a, b) => b.est - a.est), py = m ? m.pop_year : "last year";
  const cols = [{ h: "Make", get: r => r.make }, ...(split ? [{ h: "Fuel", get: r => r.fuel }] : []),
    { h: `End-${py} population`, get: r => r.base, num: 1, sum: 1 }, { h: m && m.est_year ? `New ${m.est_year} YTD` : "New this year", get: r => r.ytd, num: 1, sum: 1 },
    { h: "Est. deregistrations", get: r => -r.dereg, num: 1, sum: 1 }, { h: "Estimated now", get: r => r.est, num: 1, sum: 1 },
    { h: "Likely range", get: r => fmt(r.low) + " to " + fmt(r.high), num: 1 }, { h: "Change", get: r => r.base ? (r.est - r.base) / r.base * 100 : 0, num: 1, dec: 1, suf: "%" }];
  heads(cols);
  if (m && m.est_year) {
    const b = m.backtest, c = m.methods[m.chosen];
    $("note").textContent = `Estimated population = end-${py} population + registrations from Jan to ${lbl(m.est_latest_month)} - estimated deregistrations. LTA does not publish deregistrations, so they are derived from past years (population last year + new registrations - population this year) and projected using "${c.label}", the method with the lowest error when tested on ${b.years[0]}-${b.years[b.years.length - 1]}. That test was off by ${c.mae_pct}% of the national population on average (ignoring deregistrations: ${b.no_deregistration_wape_pct}% of cars in the wrong make). The range is that typical error.`;
  } else $("note").textContent = "Estimate = last year-end population + registrations since. No deregistration model has been built yet (upload the annual new registrations PDF), so this overstates the population.";
  const top = rows.slice(0, 15);
  draw("c1", { type: "bar", data: { labels: top.map(o => o.make + (o.fuel ? " " + o.fuel : "")), datasets: [
    { label: "Population at last year-end", data: top.map(o => o.base), backgroundColor: PAL[2] }, { label: "New registrations this year", data: top.map(o => o.ytd), backgroundColor: PAL[0] },
    { label: "Estimated deregistrations", data: top.map(o => -o.dereg), backgroundColor: PAL[3] }] },
    options: { indexAxis: "y", maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true } }, plugins: { legend: { position: "bottom" } } } });
  pagedTable($("tbl"), rows, cols, { reset });
}

function yearTable(rows, years, extra) {       // rows: {make, v:{year:value}}
  const cols = [{ h: "Make", get: r => r.make }, ...years.map(y => ({ h: y, get: r => r.v[y] ?? 0, num: 1, sum: 1 })), ...(extra ? [extra] : [])]; heads(cols); return cols;
}
function viewHist(reset) {
  const years = Object.keys(D.mod.meta.pop_by_year).sort(), all = Object.entries(D.mod.history).map(([make, h]) => ({ make, v: h.pop }));
  const rows = rowsFilter(all).sort((a, b) => (b.v[years[years.length - 1]] || 0) - (a.v[years[years.length - 1]] || 0));
  $("note").textContent = "Cars on the road at the end of each year (LTA). Before 2022 LTA publishes population by make only, not by fuel type. Until 2021 the smallest makes are grouped under OTHERS.";
  const top = rows.filter(r => r.make !== "OTHERS").slice(0, 8);
  draw("c1", { type: "line", data: { labels: years, datasets: top.map((r, i) => ({ label: r.make, data: years.map(y => r.v[y] ?? null), borderColor: PAL[i], backgroundColor: PAL[i], borderWidth: 2, pointRadius: 2, spanGaps: true })) }, options: { maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } } });
  pagedTable($("tbl"), rows, yearTable(rows, years), { reset });
}
function viewDereg(reset) {
  const mt = D.mod.meta, years = Object.keys(mt.total_dereg_by_year).sort();
  const rows = rowsFilter(Object.entries(D.mod.history).map(([make, h]) => ({ make, v: h.dereg, pop: h.pop }))).filter(r => Object.keys(r.v).length);
  const rate = r => { const ys = years.slice(-3).filter(y => r.v[y] != null && r.pop[y - 1] >= 50); return ys.length ? ys.reduce((s, y) => s + Math.max(0, r.v[y]) / r.pop[y - 1], 0) / ys.length * 100 : 0; };
  rows.sort((a, b) => (b.v[years[years.length - 1]] || 0) - (a.v[years[years.length - 1]] || 0));
  $("note").textContent = "Implied net deregistrations = population at the end of last year + new registrations - population at the end of this year. It is net of anything else that adds cars (such as used imports), and is blank where a make was grouped under OTHERS the year before. The chart shows how closely deregistrations follow new registrations, because Singapore's quota system keeps the population almost flat.";
  draw("c1", { type: "bar", data: { labels: years, datasets: [{ label: "Implied deregistrations", data: years.map(y => mt.total_dereg_by_year[y]), backgroundColor: PAL[3] }, { type: "line", label: "New registrations", data: years.map(y => mt.new_by_year[y]), borderColor: PAL[0], backgroundColor: PAL[0], borderWidth: 2 }] }, options: { maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } } });
  pagedTable($("tbl"), rows, yearTable(rows, years, { h: "Avg yearly rate, last 3 years", get: rate, num: 1, dec: 1, suf: "%" }), { reset });
}
function viewNew(reset) {
  const key = $("grp").value === "body" ? "body" : "fuel", g = D.mod.groups, years = [...new Set(g.map(r => r.y))].sort(), names = [...new Set(g.map(r => r[key]))];
  const rows = rowsFilter(names.map(n => ({ make: n, v: Object.fromEntries(years.map(y => [y, g.filter(r => r.y === y && r[key] === n).reduce((s, r) => s + r.u, 0)])) })));
  heads([{ h: key === "body" ? "Body type" : "Fuel type" }, ...years.map(y => ({ h: y, num: 1 }))]);
  $("note").textContent = "New registrations by year. LTA's 2015-2021 tables only split fuel into Petrol, Diesel and Others (Electric, Hybrid and Plug-in hybrid) and merge MPV with station-wagon, so every year is grouped the same way here to keep the series comparable.";
  draw("c1", { type: "bar", data: { labels: years, datasets: rows.map((r, i) => ({ label: r.make, data: years.map(y => r.v[y]), backgroundColor: PAL[i % PAL.length] })) }, options: { maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true } }, plugins: { legend: { position: "bottom" } } } });
  pagedTable($("tbl"), rows, [{ get: r => r.make }, ...years.map(y => ({ get: r => r.v[y], num: 1, sum: 1 }))], { reset });
}

function renderTrf(reset) {
  const split = $("split").value === "fuel", fuel = $("fuel").value, q = $("search").value.trim().toLowerCase(), by = new Map(), m = $("month").value;
  D.trf.filter(r => (!fuel || r.fuel === fuel) && (!m || r.m === m)).forEach(r => { const k = r.make + "|" + (split ? r.fuel : ""); let o = by.get(k); if (!o) by.set(k, o = { make: r.make, fuel: split ? r.fuel : "", base: 0 }); o.base += r.u; });
  const tot = [...by.values()].reduce((s, o) => s + o.base, 0), rows = [...by.values()].filter(o => !q || (o.make + " " + o.fuel).toLowerCase().includes(q)).sort((a, b) => b.base - a.base);
  const cols = [{ h: "Make", get: r => r.make }, ...(split ? [{ h: "Fuel", get: r => r.fuel }] : []), { h: "Transfers", get: r => r.base, num: 1, sum: 1 }, { h: "Share", get: r => tot ? r.base / tot * 100 : 0, num: 1, sum: 1, dec: 1, suf: "%" }];
  heads(cols); $("c2wrap").hidden = false;
  $("note").textContent = "Effective transfers of car ownership (second-hand sales). Includes station wagons, tax-exempted and VQS-exempted cars; excludes taxis.";
  const mt = {}; D.trf.filter(r => !fuel || r.fuel === fuel).forEach(r => mt[r.m] = (mt[r.m] || 0) + r.u); const ks = Object.keys(mt).sort();
  draw("c2", { type: "bar", data: { labels: ks.map(lbl), datasets: [{ label: "Transfers", data: ks.map(k => mt[k]), backgroundColor: PAL[1] }] }, options: { plugins: { legend: { display: false } }, maintainAspectRatio: false } });
  const top = rows.slice(0, 15);
  draw("c1", { type: "bar", data: { labels: top.map(o => o.make + (o.fuel ? " " + o.fuel : "")), datasets: [{ label: "Transfers", data: top.map(o => o.base), backgroundColor: PAL[0] }] }, options: { indexAxis: "y", maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } } });
  pagedTable($("tbl"), rows, cols, { reset });
}
