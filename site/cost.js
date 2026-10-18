// SG Car Cost Tracker
const $ = (id) => document.getElementById(id);
const fmt = (n) => (n == null ? "—" : n.toLocaleString("en-SG"));
const fmtMoney = (n) => (n == null ? "—" : "$" + n.toLocaleString("en-SG"));

let COSTS = [];
let HISTORY = null;
let costChart = null;

async function load() {
  HISTORY = await (await fetch("data/cost_history.json")).json();
  const month = HISTORY && HISTORY.months ? HISTORY.months[HISTORY.months.length - 1] : "2026-08";
  COSTS = await (await fetch("data/costs/" + month + ".json")).json();
  const lu = $("lastUpdate");
  if (lu) lu.textContent = "Updated " + month;
  initFilters();
  render();
}

function initFilters() {
  const makes = [...new Set(COSTS.map((r) => r.make))].sort();
  const m = $("costMake");
  if (m) { makes.forEach((x) => m.add(new Option(x, x))); m.addEventListener("change", render); }
  const fuels = [...new Set(COSTS.map((r) => r.fuel))].sort();
  const f = $("costFuel");
  if (f) { fuels.forEach((x) => f.add(new Option(x, x))); f.addEventListener("change", render); }
  const cats = [...new Set(COSTS.map((r) => r.coe_cat).filter(Boolean))].sort();
  const c = $("costCat");
  if (c) { cats.forEach((x) => c.add(new Option("Cat " + x, x))); c.addEventListener("change", render); }
  if ($("costSearch")) $("costSearch").addEventListener("input", render);
  if ($("costReset")) $("costReset").addEventListener("click", () => {
    if ($("costSearch")) $("costSearch").value = "";
    if (m) m.value = "__all__";
    if (f) f.value = "__all__";
    if (c) c.value = "__all__";
    render();
  });
  const cm = $("costMonth");
  if (cm && HISTORY) {
    HISTORY.months.slice().reverse().forEach(x=>cm.add(new Option(x,x)));
    cm.value = HISTORY.months[HISTORY.months.length-1];
    cm.addEventListener("change", async ()=>{
      try{ COSTS = await (await fetch("data/costs/"+cm.value+".json")).json(); render(); }catch(e){}
    });
  }
  document.querySelectorAll("#costChartFilters input").forEach((x) => x.addEventListener("change", function(){ renderChart(); }));
}

function filtered() {
  const q = $("costSearch") ? $("costSearch").value.trim().toLowerCase() : "";
  return COSTS.filter((r) => {
    if ($("costMake") && $("costMake").value !== "__all__" && r.make !== $("costMake").value) return false;
    if ($("costFuel") && $("costFuel").value !== "__all__" && r.fuel !== $("costFuel").value) return false;
    if ($("costCat") && $("costCat").value !== "__all__" && r.coe_cat !== $("costCat").value) return false;
    if (q && !((r.make + " " + r.model).toLowerCase().includes(q))) return false;
    return true;
  });
}

function render() {
  const rows = filtered();
  renderKPIs(rows);
  renderTable(rows);
  renderChart(rows);
}

function renderKPIs(rows) {
  const el = $("costKPIs");
  if (!el) return;
  const models = rows.length;
  const priced = rows.filter((r) => r.price_with_coe != null);
  const withPrice = priced.length;
  const avgPrice = withPrice ? Math.round(priced.reduce((s, r) => s + r.price_with_coe, 0) / withPrice) : 0;
  const minPrice = withPrice ? Math.min(...priced.map((r) => r.price_with_coe)) : 0;
  const maxPrice = withPrice ? Math.max(...priced.map((r) => r.price_with_coe)) : 0;
  el.innerHTML = '<div class="kpi"><div class="kpi-label">Models</div><div class="kpi-value">' + fmt(models) + '</div></div>' +
    '<div class="kpi"><div class="kpi-label">With listed price</div><div class="kpi-value">' + fmt(withPrice) + '</div></div>' +
    '<div class="kpi"><div class="kpi-label">Avg price (with COE)</div><div class="kpi-value">' + fmtMoney(avgPrice) + '</div></div>' +
    '<div class="kpi"><div class="kpi-label">Price range</div><div class="kpi-value">' + fmtMoney(minPrice) + ' – ' + fmtMoney(maxPrice) + '</div></div>';
}

function renderTable(rows) {
  const tbody = document.getElementById("costBody");
  if (!tbody) return;
  tbody.innerHTML = "";
  const sorted = [...rows].sort((a, b) => (a.make < b.make ? -1 : a.make > b.make ? 1 : (a.model || "").localeCompare(b.model || "")));
  const frag = document.createDocumentFragment();
  sorted.forEach((r) => {
    const tr = document.createElement("tr");
    const diff = r.diff_with_coe;
    const diffCell = diff == null ? "—" : (diff >= 0 ? "+" + fmt(diff) : fmt(diff));
    tr.innerHTML = '<td>' + r.make + '</td><td>' + r.model + '</td><td>' + r.fuel + '</td><td>' + (r.coe_cat || "") + '</td><td>' + fmt(r.cc) + '</td><td>' + fmt(r.kw) + '</td>' +
      '<td>' + fmtMoney(r.omv) + '</td><td>' + fmtMoney(r.arf) + '</td><td>' + fmtMoney(r.gst_excise) + '</td><td>' + fmtMoney(r.ves) + '</td><td>' + fmt(r.eeai) + '</td>' +
      '<td>' + fmtMoney(r.regn_fee) + '</td><td>' + fmtMoney(r.coe) + '</td><td>' + fmtMoney(r.basic_ex_coe) + '</td><td>' + fmtMoney(r.basic_with_coe) + '</td>' +
      '<td>' + fmtMoney(r.price_ex_coe) + '</td><td>' + fmtMoney(r.price_with_coe) + '</td><td>' + diffCell + '</td>';
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
  if ($("costNote")) $("costNote").textContent = rows.length + " models";
}

function renderChart(rowsArg) {
  if (typeof Chart === "undefined") return;
  const ctx = $("costChart");
  if (!ctx) return;
  const rows = rowsArg || filtered();
  const top = [...rows].filter((r) => r.price_with_coe != null).sort((a, b) => b.price_with_coe - a.price_with_coe).slice(0, 40);
  const labels = top.map((r) => r.make + " " + r.model);
  const active = [...document.querySelectorAll("#costChartFilters input")].map((c) => ({ field: c.value, on: c.checked }));
  const palette = ["#4ea1ff", "#7c5cff", "#2ecc71", "#f1c40f"];
  const datasets = [];
  active.forEach((a, i) => {
    if (!a.on) return;
    datasets.push({ label: a.field, data: top.map((r) => r[a.field]), backgroundColor: palette[i] + "22", borderColor: palette[i], borderWidth: 1 });
  });
  if (!costChart) {
    costChart = new Chart(ctx, { type: "bar", data: { labels: [], datasets: [] }, options: chartOpts() });
  }
  costChart.data.labels = labels;
  costChart.data.datasets = datasets;
  costChart.update();
}

function chartOpts() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: "#e8ecf5" } } },
    scales: {
      x: { ticks: { color: "#9aa3bd", maxRotation: 45, font: { size: 10 } }, grid: { display: false } },
      y: { ticks: { color: "#9aa3bd", callback: (v) => "$" + (v / 1000) + "k" }, grid: { color: "#2c3557" } },
    },
  };
}

load();
