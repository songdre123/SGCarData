const MODE = new URLSearchParams(location.search).get("t") === "trf" ? "trf" : "pop";
const $ = id => document.getElementById(id), fmt = n => Number(n).toLocaleString("en-SG");
const J = u => fetch(u).then(r => r.ok ? r.json() : null).catch(() => null);
const PAL = ["#3ddbb0", "#f2b84b", "#5aa9ff", "#ff6b5e", "#b28cff"];
let D = {}, chart = {};
const draw = (id, cfg) => { chart[id]?.destroy(); chart[id] = new Chart($(id), cfg); };
const lbl = m => new Date(m + "-01").toLocaleDateString("en-GB", { month: "short", year: "numeric" });

(async () => {
  const [meta, reg, pop, trf] = await Promise.all(["meta", "registrations", "population", "transfers"].map(n => J("data/" + n + ".json")));
  D = { meta, reg, pop, trf };
  document.querySelectorAll(".nav-link").forEach(a => a.classList.toggle("active", a.getAttribute("href").endsWith("t=" + MODE)));
  const src = MODE === "pop" ? pop : trf;
  if (!src) { $("note").textContent = "No data yet. Upload the " + (MODE === "pop" ? "annual car population" : "monthly car transfer") + " PDF to the incoming folder."; return; }
  $("title").textContent = MODE === "pop" ? "Car population by make, estimated to date" : "Car ownership transfers by make";
  const fuels = [...new Set(src.map(r => r.fuel))].sort();
  $("fuel").innerHTML = '<option value="">All fuel types</option>' + fuels.map(f => `<option>${f}</option>`).join("");
  if (MODE === "trf") { const ms = [...new Set(trf.map(r => r.m))].sort(); $("month").innerHTML = '<option value="">All months</option>' + ms.map(m => `<option value="${m}">${lbl(m)}</option>`).join(""); }
  else $("monthLbl").hidden = true;
  ["fuel", "split", "month", "search"].forEach(id => $(id).addEventListener("input", () => render(true)));
  render(true);
})();

function render(reset) {
  const split = $("split").value === "fuel", fuel = $("fuel").value, q = $("search").value.trim().toLowerCase(), by = new Map();
  const add = (r, k, v) => { const key = r.make + "|" + (split ? r.fuel : ""); let o = by.get(key); if (!o) by.set(key, o = { make: r.make, fuel: split ? r.fuel : "", base: 0, ytd: 0 }); o[k] += v; };
  let cols, note, chartRows;
  if (MODE === "pop") {
    const py = Math.max(...D.pop.map(r => +r.y)), ny = py + 1, ms = D.meta.months.filter(m => m.startsWith(ny));
    D.pop.filter(r => +r.y === py && (!fuel || r.fuel === fuel)).forEach(r => add(r, "base", r.u));
    D.reg.filter(r => ms.includes(r.m) && (!fuel || r.fuel === fuel)).forEach(r => add(r, "ytd", r.u));
    note = `Estimate = end-${py} population plus new registrations ${ms.length ? "from Jan to " + lbl(ms[ms.length - 1]) + " " + ny : "since then (none loaded yet)"}. It does not subtract vehicles deregistered or exported, so it runs higher than the true population.`;
    cols = [{ get: r => r.make }, ...(split ? [{ get: r => r.fuel }] : []),
      { get: r => r.base, num: 1, sum: 1 }, { get: r => r.ytd, num: 1, sum: 1 }, { get: r => r.base + r.ytd, num: 1, sum: 1 },
      { get: r => r.base ? (r.ytd / r.base) * 100 : 0, num: 1, dec: 1, suf: "%" }];
    $("heads").innerHTML = `<th>Make</th>${split ? "<th>Fuel</th>" : ""}<th>End-${py} population</th><th>Registrations ${ny} YTD</th><th>Estimated now</th><th>Growth</th>`;
  } else {
    const m = $("month").value;
    D.trf.filter(r => (!fuel || r.fuel === fuel) && (!m || r.m === m)).forEach(r => add(r, "base", r.u));
    const tot = [...by.values()].reduce((s, o) => s + o.base, 0);
    note = "Effective transfers of car ownership (second-hand sales). Includes station wagons, tax-exempted and VQS-exempted cars; excludes taxis.";
    cols = [{ get: r => r.make }, ...(split ? [{ get: r => r.fuel }] : []), { get: r => r.base, num: 1, sum: 1 },
      { get: r => tot ? (r.base / tot) * 100 : 0, num: 1, sum: 1, dec: 1, suf: "%" }];
    $("heads").innerHTML = `<th>Make</th>${split ? "<th>Fuel</th>" : ""}<th>Transfers</th><th>Share</th>`;
    const mt = {}; D.trf.filter(r => !fuel || r.fuel === fuel).forEach(r => mt[r.m] = (mt[r.m] || 0) + r.u);
    const ks = Object.keys(mt).sort();
    draw("c2", { type: "bar", data: { labels: ks.map(lbl), datasets: [{ label: "Transfers", data: ks.map(k => mt[k]), backgroundColor: PAL[1] }] }, options: { plugins: { legend: { display: false } }, maintainAspectRatio: false } });
  }
  $("c2wrap").hidden = MODE === "pop"; $("note").textContent = note;
  let rows = [...by.values()].filter(o => !q || (o.make + " " + o.fuel).toLowerCase().includes(q)).sort((a, b) => (b.base + b.ytd) - (a.base + a.ytd));
  const top = rows.slice(0, 15);
  draw("c1", { type: "bar", data: { labels: top.map(o => o.make + (o.fuel ? " " + o.fuel : "")), datasets: MODE === "pop"
      ? [{ label: "Population at last year-end", data: top.map(o => o.base), backgroundColor: PAL[2] }, { label: "Registrations this year", data: top.map(o => o.ytd), backgroundColor: PAL[0] }]
      : [{ label: "Transfers", data: top.map(o => o.base), backgroundColor: PAL[0] }] },
    options: { indexAxis: "y", maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true } }, plugins: { legend: { position: "bottom" } } } });
  pagedTable($("tbl"), rows, cols, { reset });
}
