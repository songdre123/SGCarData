// SG Car Cost Tracker
const $ = (id) => document.getElementById(id);
const fmt = (n) => (n == null || isNaN(n) ? "—" : n.toLocaleString("en-SG"));
const fmtMoney = (n) => (n == null || isNaN(n) ? "—" : "$" + n.toLocaleString("en-SG"));

let COSTS = [];
let HISTORY = null;
let costChart = null;
let costTrend = null;

async function load() {
  try {
    HISTORY = await (await fetch("data/cost_history.json")).json();
    const month = latestMonth();
    COSTS = await (await fetch("data/costs/" + month + ".json")).json();
    const lu = $("lastUpdate");
    if (lu) lu.textContent = "Updated " + month;
    initFilters();
    render();
  } catch (e) {
    console.error(e);
  }
}

function latestMonth() {
  if (HISTORY && HISTORY.months && HISTORY.months.length) return HISTORY.months[HISTORY.months.length - 1];
  return "2026-08";
}

function initFilters() {
  const makes = [...new Set(COSTS.map((r) => r.make))].sort();
  const m = $("costMake");
  if (m) {
    makes.forEach((x) => m.add(new Option(x, x)));
    m.addEventListener("change", render);
  }
  const fuels = [...new Set(COSTS.map((r) => r.fuel))].sort();
  const f = $("costFuel");
  if (f) {
    fuels.forEach((x) => f.add(new Option(x, x)));
    f.addEventListener("change", render);
  }
  const cats = [...new Set(COSTS.map((r) => r.coe_cat).filter(Boolean))].sort();
  const c = $("costCat");
  if (c) {
    cats.forEach((x) => c.add(new Option("Cat " + x, x)));
    c.addEventListener("change", render);
  }
  const s = $("costSearch");
  if (s) s.addEventListener("input", render);
  const r = $("costReset");
  if (r) r.addEventListener("click", () => {
    if (s) s.value = "";
    if (m) m.value = "__all__";
    if (f) f.value = "__all__";
    if (c) c.value = "__all__";
    render();
  });
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
  renderTrend(rows);
}

function renderKPIs(rows) {
  const el = $("costKPIs");
  if (!el) return;
  const models = rows.length;
  const priced = rows.filter((r) => r.price_with_coe != null && !isNaN(r.price_with_coe));
  const withPrice = priced.length;
  const avgPrice = withPrice ? Math.round(priced.reduce((s, r) => s + r.price_with_coe, 0) / withPrice) : 0;
  const minPrice = withPrice ? Math.min(...priced.map((r) => r.price_with_coe)) : 0;
  const maxPrice = withPrice ? Math.max(...priced.map((r) => r.price_with_coe)) : 0;
  el.innerHTML = '<div class="kpi"><div class="kpi-label">Models</div><div class="kpi-value">' + fmt(models) + '</div></div>' +
    '<div class="kpi"><div class="kpi-label">With listed price</div><div class="kpi-value">' + fmt(withPrice) + '</div></div>' +
    '<div class="kpi"><div class="kpi-label">Avg price (with COE)</div><div class="kpi-value">' + fmtMoney(avgPrice) + '</div></div>' +
    '<div class="kpi"><div class="kpi-label">Price range</div><div class="kpi-value">' + fmtMoney(minPrice) + " – " + fmtMoney(maxPrice) + '</div></div>';
}

function renderTable(rows) {
  const tbody = document.getElementById("costBody");
  if (!tbody) return;
  tbody.innerHTML = "";
  const sorted = [...rows].sort((a, b) => (a.make < b.make ? -1 : a.make > b.make ? 1 : (a.model || "").localeCompare(b.model || "")));
  let html = "";
  for (let i = 0; i < Math.min(sorted.length, 1000); i++) {
    const r = sorted[i];
    html += "<tr>" +
      "<td>" + (r.make||"") + "</td>" +
      "<td>" + (r.model||"") + "</td>" +
      "<td>" + (r.fuel||"") + "</td>" +
      "<td>" + (r.coe_cat||"") + "</td>" +
      "<td>" + fmt(r.cc) + "</td>" +
      "<td>" + fmt(r.kw) + "</td>" +
      "<td>" + fmtMoney(r.omv) + "</td>" +
      "<td>" + fmtMoney(r.arf) + "</td>" +
      "<td>" + fmtMoney(r.gst_excise) + "</td>" +
      "<td>" + fmtMoney(r.ves) + "</td>" +
      "<td>" + fmt(r.eeai) + "</td>" +
      "<td>" + fmtMoney(r.regn_fee) + "</td>" +
      "<td>" + fmtMoney(r.coe) + "</td>" +
      "<td>" + fmtMoney(r.basic_ex_coe) + "</td>" +
      "<td>" + fmtMoney(r.basic_with_coe) + "</td>" +
      "<td>" + fmtMoney(r.price_ex_coe) + "</td>" +
      "<td>" + fmtMoney(r.price_with_coe) + "</td>" +
      "<td>" + (r.diff_with_coe==null?"—":fmt(r.diff_with_coe)) + "</td>" +
      "</tr>";
  }
  tbody.innerHTML = html;
  const note = document.getElementById("costNote");
  if (note) note.textContent = sorted.length + " models (showing up to 1000)";
}

function renderChart(rows) {
  if (typeof Chart === "undefined") return;
  const ctx = $("costBreakdownChart");
  if (!ctx) return;
  const top = [...rows].filter((r) => r.price_with_coe != null && !isNaN(r.price_with_coe)).sort((a,b)=>b.price_with_coe-a.price_with_coe).slice(0,40);
  const labels = top.map(r => (r.make+" "+r.model).slice(0,40));
  const data = top.map(r => r.price_with_coe);
  if (!costChart) {
    costChart = new Chart(ctx, {type:"bar", data:{labels:[],datasets:[]}, options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{legend:{labels:{color:"#e8ecf5"}}},
      scales:{
        x:{ticks:{color:"#9aa3bd",maxRotation:45,font:{size:10}},grid:{display:false}},
        y:{ticks:{color:"#9aa3bd",callback:(v)=>"$"+(v/1000)+"k"},grid:{color:"#2c3557"}}
      }
    }});
  }
  costChart.data.labels = labels;
  costChart.data.datasets = [{label:"Price with COE", data, backgroundColor:"#4ea1ff22", borderColor:"#4ea1ff", borderWidth:1}];
  costChart.update();
}

function renderTrend(rows) {
  if (typeof Chart === "undefined") return;
  const ctx = $("costTrendChart");
  if (!ctx) return;
  const month = latestMonth();
  if (!costTrend) {
    costTrend = new Chart(ctx, {type:"line", data:{labels:[],datasets:[]}, options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{
        x:{ticks:{color:"#9aa3bd"},grid:{color:"#2c3557"}},
        y:{ticks:{color:"#9aa3bd"},grid:{color:"#2c3557"}}
      }
    }});
  }
  costTrend.data.labels = [month];
  costTrend.data.datasets = [{label:"Models", data:[rows.length], borderColor:"#4ea1ff", tension:0.2}];
  costTrend.update();
}

window.addEventListener("DOMContentLoaded", load);
if (document.readyState !== "loading") load();
