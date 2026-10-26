const $ = id => document.getElementById(id), fmt = n => Number(n).toLocaleString("en-SG"), S = n => "S$" + fmt(n);
const CATS = { A: "Cat A: cars up to 1600cc and 97kW", B: "Cat B: cars above 1600cc or 97kW", C: "Cat C: goods vehicles and buses", D: "Cat D: motorcycles", E: "Cat E: open" };
const COL = { A: "#3ddbb0", B: "#f2b84b", C: "#5aa9ff", D: "#ff6b5e", E: "#b28cff" };
const day = d => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
let D = [], ch = {}, sel = new Set(["A", "B"]);
const draw = (id, cfg) => { ch[id]?.destroy(); ch[id] = new Chart($(id), cfg); };

(async () => {
  D = await fetch("data/coe.json").then(r => r.ok ? r.json() : null).catch(() => null) || [];
  if (!D.length) { $("note").textContent = "No COE data yet. Upload the COE bidding results CSV to the incoming folder."; return; }
  const years = [...new Set(D.map(r => r.d.slice(0, 4)))].sort().reverse();
  $("fcat").innerHTML = '<option value="">All categories</option>' + Object.keys(CATS).map(c => `<option value="${c}">${CATS[c]}</option>`).join("");
  $("fyear").innerHTML = '<option value="">All years</option>' + years.map(y => `<option>${y}</option>`).join("");
  $("cat2").innerHTML = Object.keys(CATS).map(c => `<option value="${c}">${CATS[c]}</option>`).join("");
  $("chips").innerHTML = Object.keys(CATS).map(c => `<label class="chip"><input type="checkbox" value="${c}" ${sel.has(c) ? "checked" : ""}> <span style="color:${COL[c]}">&#9632;</span> Cat ${c}</label>`).join("");
  $("chips").onchange = e => { e.target.checked ? sel.add(e.target.value) : sel.delete(e.target.value); premium(); };
  ["range"].forEach(id => $(id).onchange = () => { premium(); quota(); });
  $("cat2").onchange = quota; $("fcat").onchange = $("fyear").onchange = () => table(true);
  cards(); premium(); quota(); table(true);
})();

function cards() {
  const dates = [...new Set(D.map(r => r.d))].sort(), last = dates[dates.length - 1], prev = dates[dates.length - 2];
  const ex = D.find(r => r.d === last).ex;
  $("latest").textContent = "Latest result: " + ex;
  $("note").textContent = "Announced " + day(last) + (prev ? ". Change is against the previous exercise on " + day(prev) + "." : "");
  $("cards").innerHTML = Object.keys(CATS).map(c => {
    const a = D.find(r => r.d === last && r.c === c), b = D.find(r => r.d === prev && r.c === c);
    if (!a) return "";
    const dp = b ? a.p - b.p : null, pc = b ? dp / b.p * 100 : null;
    return `<div class="coe-card" style="border-top:4px solid ${COL[c]}"><small>${CATS[c]}</small><b>${S(a.p)}</b>
      <span class="${dp == null ? "" : dp >= 0 ? "bad" : "good"}">${dp == null ? "no earlier exercise" : (dp >= 0 ? "+" : "-") + S(Math.abs(dp)) + " (" + (pc >= 0 ? "+" : "") + pc.toFixed(1) + "%)"}</span>
      <span>Quota ${fmt(a.q)} | bids ${fmt(a.b)} | successful ${fmt(a.s)}</span><span>${(a.b / a.q).toFixed(2)} bids per place</span></div>`;
  }).join("");
}

function inRange(r) {
  const n = +$("range").value; if (!n) return true;
  const last = D.reduce((m, r) => r.d > m ? r.d : m, ""), cut = new Date(last); cut.setFullYear(cut.getFullYear() - n);
  return r.d >= cut.toISOString().slice(0, 10);
}
function premium() {
  const rows = D.filter(inRange), dates = [...new Set(rows.map(r => r.d))].sort();
  draw("c1", { type: "line", data: { labels: dates.map(day), datasets: [...sel].sort().map(c => ({
    label: "Cat " + c, borderColor: COL[c], backgroundColor: COL[c], pointRadius: dates.length > 80 ? 0 : 3, borderWidth: 2, spanGaps: true,
    data: dates.map(d => rows.find(r => r.d === d && r.c === c)?.p ?? null) })) },
    options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: x => `${x.dataset.label}: ${S(x.raw)}` } } },
      scales: { y: { ticks: { callback: v => S(v) } }, x: { ticks: { maxTicksLimit: 10 } } } } });
}
function quota() {
  const c = $("cat2").value, rows = D.filter(r => r.c === c && inRange(r)).sort((a, b) => a.d.localeCompare(b.d));
  const line = (label, k, color, dash) => ({ label, data: rows.map(r => r[k]), borderColor: color, backgroundColor: color, borderDash: dash, pointRadius: rows.length > 80 ? 0 : 3, borderWidth: 2 });
  draw("c2", { type: "line", data: { labels: rows.map(r => day(r.d)), datasets: [line("Quota", "q", "#8aa5a2", [6, 4]), line("Bids received", "b", "#f2b84b"), line("Successful bids", "s", "#3ddbb0")] },
    options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, plugins: { legend: { position: "bottom" } }, scales: { y: { ticks: { callback: fmt } }, x: { ticks: { maxTicksLimit: 10 } } } } });
}
function table(reset) {
  const c = $("fcat").value, y = $("fyear").value;
  const rows = D.filter(r => (!c || r.c === c) && (!y || r.d.startsWith(y))).sort((a, b) => b.d.localeCompare(a.d) || a.c.localeCompare(b.c));
  pagedTable($("tbl"), rows, [
    { get: r => day(r.d) }, { get: r => r.ex }, { get: r => "Cat " + r.c },
    { get: r => r.q, num: 1, sum: 1 }, { get: r => r.b, num: 1, sum: 1 }, { get: r => r.s, num: 1, sum: 1 },
    { get: r => r.q ? r.b / r.q : 0, num: 1, dec: 2 }, { get: r => "S$" + fmt(r.p), num: 1 }], { reset });
}
