// SG Car Data Dashboard
const $ = (id) => document.getElementById(id);
const fmt = (n) => (n == null ? "—" : n.toLocaleString("en-SG"));

let ALL = [];
let MONTHS = [];
let LATEST = "";
let SCOPE = { year: "__all__", month: "__all__" };
let monthlyChart = null;
let fuelChart = null;
let bodyChart = null;
let makeChart = null;

async function load() {
  const meta = await (await fetch("data/meta.json")).json();
  MONTHS = meta.months;
  LATEST = meta.latest;
  ALL = await (await fetch("data/registrations.json")).json();
  initScope();
  initFilters();
  render();
}

function initScope() {
  const years = [...new Set(MONTHS.map((m) => m.slice(0, 4)))].sort();
  const y = $("scopeYear");
  y.innerHTML = '<option value="__all__">All years</option>';
  years.forEach((x) => y.add(new Option(x, x)));

  const m = $("scopeMonth");
  m.innerHTML = '<option value="__all__">All months (YTD)</option>';

  y.addEventListener("change", () => {
    refreshMonthOptions();
    render();
  });
  refreshMonthOptions();
  $("scopeMonth").addEventListener("change", () => { SCOPE.month = $("scopeMonth").value; render(); });
  $("scopeYear").addEventListener("change", () => { SCOPE.year = $("scopeYear").value; render(); });
  $("monthlyGroup").addEventListener("change", render);
}


function refreshTableMonthOptions() {
  const year = $("tableYear") ? $("tableYear").value : "__all__";
  const m = $("tableMonth");
  if (!m) return;
  const keep = m.value;
  m.innerHTML = '<option value="__all__">All months</option>';
  MONTHS.filter((x)=>year==="__all__"||x.slice(0,4)===year).forEach((x)=>m.add(new Option(x,x)));
  m.value = keep && [...m.options].some((o)=>o.value===keep)?keep:"__all__";
}

function refreshMonthOptions() {
  const year = $("scopeYear").value;
  const m = $("scopeMonth");
  const keep = m.value;
  m.innerHTML = '<option value="__all__">All months (YTD)</option>';
  MONTHS.filter((x) => year === "__all__" || x.slice(0, 4) === year).forEach((x) =>
    m.add(new Option(x, x))
  );
  m.value = keep && [...m.options].some((o) => o.value === keep) ? keep : "__all__";
}

function scopeRows() {
  const y = $("scopeYear").value;
  const mo = $("scopeMonth").value;
  return ALL.filter((r) => {
    if (y !== "__all__" && r.m.slice(0, 4) !== y) return false;
    if (mo !== "__all__" && r.m !== mo) return false;
    return true;
  });
}

function initFilters() {
  // Table month filter
  const tm = $("tableMonth");
  if (tm) {
    tm.innerHTML = '<option value="__all__">All months</option>';
    tm.addEventListener("change", renderTable);
  }
  // Table year
  const ty = $("tableYear");
  if (ty) {
    const years = [...new Set(MONTHS.map((m)=>m.slice(0,4)))].sort();
    years.forEach(x=>ty.add(new Option(x,x)));
    ty.addEventListener("change", ()=>{
      refreshTableMonthOptions();
      renderTable();
    });
  }

  // Table make filter
  const tmk = $("tableMake");
  if (tmk) {
    const makes = [...new Set(ALL.map((r) => r.make))].sort();
    makes.forEach((x) => tmk.add(new Option(x, x)));
    tmk.addEventListener("change", renderTable);
  }
  // Table importer
  if ($("tableImporter")) $("tableImporter").addEventListener("change", renderTable);
  // Table body
  if ($("tableBody")) $("tableBody").addEventListener("change", renderTable);
  // Table fuel
  const tf = $("tableFuel");
  if (tf) {
    const fuels = [...new Set(ALL.map((r) => r.fuel))].sort();
    fuels.forEach((x) => tf.add(new Option(x, x)));
    tf.addEventListener("change", renderTable);
  }
  // Table search
  if ($("tableSearch")) $("tableSearch").addEventListener("input", renderTable);
  // Reset
  if ($("resetFilters")) $("resetFilters").addEventListener("click", () => {
    if ($("tableSearch")) $("tableSearch").value = "";
    if ($("tableYear")) $("tableYear").value = "__all__";
    if ($("tableMonth")) $("tableMonth").value = "__all__";
    if ($("tableMake")) $("tableMake").value = "__all__";
    if ($("tableImporter")) $("tableImporter").value = "__all__";
    if ($("tableBody")) $("tableBody").value = "__all__";
    if ($("tableFuel")) $("tableFuel").value = "__all__";
    renderTable();
  });
  // Top make month
  const tmm = $("topMakeMonth");
  if (tmm) {
    tmm.innerHTML = '<option value="__all__">All months</option>';
    MONTHS.forEach((x) => tmm.add(new Option(x, x)));
    tmm.addEventListener("change", renderMakeChart);
  }
  // Last update
  if ($("lastUpdate")) $("lastUpdate").textContent = "Updated " + LATEST;
}

function render() {
  renderKPIs();
  renderMonthlyBar();
  renderFuelChart();
  renderBodyChart();
  renderMakeChart();
  renderTable();
}

function renderKPIs() {
  const rows = scopeRows();
  const total = rows.reduce((s, r) => s + (r.u || 0), 0);
  const grid = $("kpiGrid");
  if (!grid) return;
  grid.innerHTML = `
    <div class="kpi"><div class="kpi-label">Total Registrations</div><div class="kpi-value">${fmt(total)}</div></div>
    <div class="kpi"><div class="kpi-label">Months</div><div class="kpi-value">${fmt([...new Set(rows.map((r) => r.m))].length)}</div></div>
    <div class="kpi"><div class="kpi-label">Makes</div><div class="kpi-value">${fmt([...new Set(rows.map((r) => r.make))].length)}</div></div>
    <div class="kpi"><div class="kpi-label">Latest</div><div class="kpi-value">${LATEST}</div></div>
  `;
}

function getColor(index) {
  const palette = [
    "#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f", "#edc949", "#af7aa1",
    "#ff9da7", "#9c755f", "#bab0ab", "#6b5b95", "#d64161", "#6a4c93", "#88d8b0"
  ];
  return palette[index % palette.length];
}

function renderMonthlyBar() {
  const ctx = $("monthlyChart");
  if (!ctx) return;
  const rows = scopeRows();
  if (!rows.length) {
    if (monthlyChart) { monthlyChart.destroy(); monthlyChart = null; }
    return;
  }

  // Get top 20 makes by total units in scope
  const makeTotals = {};
  rows.forEach((r) => { makeTotals[r.make] = (makeTotals[r.make] || 0) + (r.u || 0); });
  const topMakes = Object.entries(makeTotals).sort((a, b) => b[1] - a[1]).slice(0, 20).map((x) => x[0]);

  const groupKey = $("monthlyGroup") ? $("monthlyGroup").value : "body";
  // Build stacks by grouping key
  const stackKeys = {};
  rows.forEach((r) => {
    let g = r[groupKey];
    if (groupKey === "importer") g = r.importer; // AMD vs PI
    if (!g) g = "Other";
    stackKeys[g] = true;
  });
  const stacks = Object.keys(stackKeys).sort();

  // For each make, build dataset per stack
  const datasets = stacks.map((sk, i) => {
    const data = topMakes.map((mk) => {
      const sum = rows
        .filter((r) => r.make === mk)
        .filter((r) => {
          let g = r[groupKey];
          if (groupKey === "importer") g = r.importer;
          if (!g) g = "Other";
          return g === sk;
        })
        .reduce((s, r) => s + (r.u || 0), 0);
      return sum;
    });
    return {
      label: sk,
      data,
      backgroundColor: getColor(i),
      borderWidth: 0,
    };
  });

  const config = {
    type: "bar",
    data: {
      labels: topMakes,
      datasets,
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: "bottom", labels: { color: "#9aa3bd" } },
        title: {
          display: true,
          text: "Monthly Registrations by Make (Top 20) — Stacked by " +
            (groupKey === "body" ? "Body Type" : groupKey === "importer" ? "AMD vs PI" : "Fuel Type"),
          color: "#e7e9ee",
        },
        tooltip: {
          mode: "index",
          intersect: false,
          callbacks: {
            label: function(context) {
              const label = context.dataset.label || "";
              const value = context.parsed.x || 0;
              const total = context.chart._metasets[context.datasetIndex].total || context.parsed._stacksY?.[context.datasetIndex] || 0;
              const makeTotal = context.chart.data.datasets.reduce((s, ds) => s + (ds.data[context.dataIndex] || 0), 0);
              const p = makeTotal ? (value / makeTotal) * 100 : 0;
              return label + ": " + fmt(value) + " (" + p.toFixed(1) + "% of make)";
            }
          }
        },
      },
      scales: {
        x: {
          stacked: true,
          ticks: { color: "#9aa3bd" },
          grid: { color: "#2c3557" },
        },
        y: {
          stacked: true,
          ticks: { color: "#9aa3bd" },
          grid: { display: false },
        },
      },
    },
  };

  if (monthlyChart) {
    monthlyChart.destroy();
  }
  monthlyChart = new Chart(ctx, config);
}

function renderFuelChart() {
  const ctx = $("fuelChart");
  if (!ctx) return;
  const rows = scopeRows();
  const totals = {};
  rows.forEach((r) => { totals[r.fuel] = (totals[r.fuel] || 0) + (r.u || 0); });
  const labels = Object.keys(totals).sort();
  const data = labels.map((k) => totals[k]);

  const config = {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: labels.map((_, i) => getColor(i)),
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: true, position: "bottom", labels: { color: "#9aa3bd" } },
        title: { display: true, text: "Fuel Mix", color: "#e7e9ee" },
        tooltip: {
          callbacks: {
            label: function(context) {
              const total = context.dataset.data.reduce((a,b)=>a+(b||0),0);
              const v = context.parsed || 0;
              return context.label + ": " + fmt(v) + " (" + (total?(v/total*100).toFixed(1):0) + "%)";
            }
          }
        }
      },
    },
  };

  if (fuelChart) fuelChart.destroy();
  fuelChart = new Chart(ctx, config);
}

function renderBodyChart() {
  const ctx = $("bodyChart");
  if (!ctx) return;
  const rows = scopeRows();
  const totals = {};
  rows.forEach((r) => { totals[r.body] = (totals[r.body] || 0) + (r.u || 0); });
  const labels = Object.keys(totals).sort();
  const data = labels.map((k) => totals[k]);

  const config = {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: labels.map((_, i) => getColor(i)),
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        title: { display: true, text: "Body Types", color: "#e7e9ee" },
        tooltip: {
          callbacks: {
            label: function(context) {
              const total = context.dataset.data.reduce((a,b)=>a+(b||0),0);
              const v = context.parsed.y || 0;
              return context.dataset.label || context.label + ": " + fmt(v) + " (" + (total?(v/total*100).toFixed(1):0) + "%)";
            }
          }
        }
      },
      scales: {
        x: { ticks: { color: "#9aa3bd" }, grid: { color: "#2c3557" } },
        y: { ticks: { color: "#9aa3bd" }, grid: { color: "#2c3557" } },
      },
    },
  };

  if (bodyChart) bodyChart.destroy();
  bodyChart = new Chart(ctx, config);
}

function renderMakeChart() {
  const ctx = $("makeChart");
  if (!ctx) return;
  let rows = scopeRows();
  const monthSel = $("topMakeMonth");
  if (monthSel && monthSel.value !== "__all__") {
    rows = rows.filter((r) => r.m === monthSel.value);
  }
  const totals = {};
  rows.forEach((r) => { totals[r.make] = (totals[r.make] || 0) + (r.u || 0); });
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 15);
  const labels = sorted.map((x) => x[0]);
  const data = sorted.map((x) => x[1]);

  const config = {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: labels.map((_, i) => getColor(i)),
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      plugins: {
        legend: { display: false },
        title: { display: true, text: "Top Makes", color: "#e7e9ee" },
        tooltip: {
          callbacks: {
            label: function(context) {
              const total = context.dataset.data.reduce((a,b)=>a+(b||0),0);
              const v = context.parsed.x || 0;
              return (context.dataset.label||"") + ": " + fmt(v) + " (" + (total?(v/total*100).toFixed(1):0) + "%)";
            }
          }
        }
      },
      scales: {
        x: { ticks: { color: "#9aa3bd" }, grid: { color: "#2c3557" } },
        y: { ticks: { color: "#9aa3bd", autoSkip: false, maxRotation: 0, font: { size: 9 } }, grid: { display: false } },
      },
    },
  };

  if (makeChart) makeChart.destroy();
  makeChart = new Chart(ctx, config);
}

function renderTable() {
  const tbody = document.querySelector("#dataTable tbody");
  if (!tbody) return;
  let rows = scopeRows();
  const q = $("tableSearch") ? $("tableSearch").value.trim().toLowerCase() : "";
  const tm = $("tableMonth") ? $("tableMonth").value : "__all__";
  const tmk = $("tableMake") ? $("tableMake").value : "__all__";
  const tim = $("tableImporter") ? $("tableImporter").value : "__all__";
  const tbd = $("tableBody") ? $("tableBody").value : "__all__";
  const tf = $("tableFuel") ? $("tableFuel").value : "__all__";

  const ty = $("tableYear") ? $("tableYear").value : "__all__";
  rows = rows.filter((r) => {
    if (ty !== "__all__" && r.m.slice(0,4) !== ty) return false;
    if (tm !== "__all__" && r.m !== tm) return false;
    if (tmk !== "__all__" && r.make !== tmk) return false;
    if (tim !== "__all__" && r.importer !== tim) return false;
    if (tbd !== "__all__" && r.body !== tbd) return false;
    if (tf !== "__all__" && r.fuel !== tf) return false;
    if (q && !(r.m + " " + r.make + " " + r.importer + " " + r.fuel + " " + r.body).toLowerCase().includes(q)) return false;
    return true;
  });

  tbody.innerHTML = rows.slice(0, 500).map((r) => `
    <tr>
      <td>${r.m}</td>
      <td>${r.make}</td>
      <td>${r.importer}</td>
      <td>${r.fuel}</td>
      <td>${r.body}</td>
      <td class="num">${fmt(r.u)}</td>
      <td>${r.country || ""}</td>
      <td>${r.tier || ""}</td>
      <td>${r.distributor || ""}</td>
    </tr>
  `).join("");

  const note = $("tableNote");
  if (note) note.textContent = `Showing ${fmt(rows.length)} rows${rows.length > 500 ? " (first 500)" : ""}`;
}

load();

function pctOfTotal(total, v) {
  if (!total || !v) return "";
  const p = (v / total) * 100;
  return " (" + p.toFixed(1) + "%)";
}
