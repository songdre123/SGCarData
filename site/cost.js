// SG Car Cost Tracker
const $ = (id) => document.getElementById(id);
const fmt = (n) => (n == null ? "—" : n.toLocaleString("en-SG"));
const fmtMoney = (n) => (n == null ? "—" : "$" + n.toLocaleString("en-SG"));

let COSTS = [];
let HISTORY = null;
let costChart = null;
let omvChart = null;

async function load() {
  HISTORY = await (await fetch("data/cost_history.json")).json();
  const month = HISTORY && HISTORY.months ? HISTORY.months[HISTORY.months.length - 1] : "2026-08";
  COSTS = await (await fetch("data/costs/" + month + ".json")).json();
  const lu = $("lastUpdate");
  if (lu) lu.textContent = "Updated " + month;
  initCostChartPeriods();
  initOmvFilters();
  refreshCostChartCarOptions();
  initFilters();
  refreshModels();
  render();
}

function initFilters() {
  const makes = [...new Set(COSTS.map((r) => r.make))].sort();
  const m = $("costMake");
  if (m) { makes.forEach((x) => m.add(new Option(x, x))); m.addEventListener("change", ()=>{ refreshModels(); render(); }); }
  const fuels = [...new Set(COSTS.map((r) => r.fuel))].sort();
  const f = $("costFuel");
  if (f) { fuels.forEach((x) => f.add(new Option(x, x))); f.addEventListener("change", render); }
  const cats = [...new Set(COSTS.map((r) => r.coe_cat).filter(Boolean))].sort();
  const c = $("costCat");
  if (c) { cats.forEach((x) => c.add(new Option("Cat " + x, x))); c.addEventListener("change", render); }
  if ($("costSearch")) $("costSearch").addEventListener("input", render);
  ["costOmvMin", "costOmvMax"].forEach((id) => {
    if ($(id)) $(id).addEventListener("input", render);
  });
  if ($("costReset")) $("costReset").addEventListener("click", () => {
    if ($("costSearch")) $("costSearch").value = "";
    if (m) m.value = "__all__";
    if (f) f.value = "__all__";
    if (c) c.value = "__all__";
    if ($("costOmvMin")) $("costOmvMin").value = "";
    if ($("costOmvMax")) $("costOmvMax").value = "";
    if ($("costModel")) $("costModel").value = "__all__";
    if ($("costChartCars")) {
      [...$("costChartCars").options].forEach((option) => {
        option.selected = option.value === "";
      });
    }
    render();
  });
  const cm = $("costMonth");
  if (cm && HISTORY) {
    HISTORY.months.slice().reverse().forEach(x=>cm.add(new Option(x,x)));
    cm.value = HISTORY.months[HISTORY.months.length-1];
    cm.addEventListener("change", async ()=>{
      try{
        const response = await fetch("data/costs/"+cm.value+".json");
        if (!response.ok) throw new Error(`Could not load costs for ${cm.value}: HTTP ${response.status}`);
        COSTS = await response.json();
        refreshModels();
        refreshCostChartCarOptions();
        render();
      }catch(e){ console.error(e); }
    });
  }

  const cmod = $("costModel");
  if (cmod) {
    const models = [...new Set(COSTS.map((r)=>(r.make+"|"+r.model)))].sort().map(x=>x.split("|")[1]);
    models.forEach(x=>cmod.add(new Option(x,x)));
    cmod.addEventListener("change", render);
  }

  document.querySelectorAll("#costChartFilters input").forEach((x) => x.addEventListener("change", function(){ renderChart(); }));
  const chartCars = $("costChartCars");
  if (chartCars) {
    chartCars.addEventListener("change", () => {
      const selected = [...chartCars.selectedOptions].some((option) => option.value);
      const placeholder = [...chartCars.options].find((option) => option.value === "");
      if (placeholder) placeholder.selected = !selected;
      renderChart();
    });
  }
  $("costChartFrom").addEventListener("change", () => {
    if ($("costChartFrom").value > $("costChartTo").value) {
      $("costChartTo").value = $("costChartFrom").value;
    }
    renderChart();
  });
  $("costChartTo").addEventListener("change", () => {
    if ($("costChartTo").value < $("costChartFrom").value) {
      $("costChartFrom").value = $("costChartTo").value;
    }
    renderChart();
  });
}

function filtered() {
  const q = $("costSearch") ? $("costSearch").value.trim().toLowerCase() : "";
  const omvMin = $("costOmvMin")?.value === "" ? null : Number($("costOmvMin")?.value);
  const omvMax = $("costOmvMax")?.value === "" ? null : Number($("costOmvMax")?.value);
  return COSTS.filter((r) => {
    if ($("costMake") && $("costMake").value !== "__all__" && r.make !== $("costMake").value) return false;
    if ($("costFuel") && $("costFuel").value !== "__all__" && r.fuel !== $("costFuel").value) return false;
    if ($("costCat") && $("costCat").value !== "__all__" && r.coe_cat !== $("costCat").value) return false;
    if ($("costModel") && $("costModel").value !== "__all__" && r.model !== $("costModel").value) return false;
    if (omvMin != null && (r.omv == null || r.omv < omvMin)) return false;
    if (omvMax != null && (r.omv == null || r.omv > omvMax)) return false;
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
    tr.innerHTML = '<td>' + (r.make||"") + '</td><td>' + (r.model||"") + '</td><td>' + (r.fuel||"") + '</td><td>' + (r.coe_cat || "") + '</td><td>' + fmt(r.cc) + '</td><td>' + fmt(r.kw) + '</td>' +
      '<td>' + fmtMoney(r.omv) + '</td><td>' + fmtMoney(r.arf) + '</td><td>' + fmtMoney(r.gst_excise) + '</td><td>' + fmtMoney(r.ves) + '</td><td>' + fmt(r.eeai) + '</td>' +
      '<td>' + fmtMoney(r.regn_fee) + '</td><td>' + fmtMoney(r.coe) + '</td><td>' + fmtMoney(r.basic_ex_coe) + '</td><td>' + fmtMoney(r.basic_with_coe) + '</td>' +
      '<td>' + fmtMoney(r.price_ex_coe) + '</td><td>' + fmtMoney(r.price_with_coe) + '</td><td>' + diffCell + '</td>';
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
  if ($("costNote")) $("costNote").textContent = rows.length + " models";
}

function renderChart() {
  if (typeof Chart === "undefined") return;
  const ctx = $("costChart");
  if (!ctx) return;
  const monthKeys = (HISTORY?.months || []).filter(
    (month) => month >= $("costChartFrom").value && month <= $("costChartTo").value,
  );
  const endMonth = $("costChartTo").value;
  const checked = [...document.querySelectorAll("#costChartFilters input")].find(x=>x.checked);
  const rankField = checked ? checked.value : "price_with_coe";
  const active = [...document.querySelectorAll("#costChartFilters input")]
    .map((checkbox) => ({ field: checkbox.value, label: checkbox.parentElement.textContent.trim(), on: checkbox.checked }))
    .filter((metric) => metric.on);
  const selectedCars = new Set(
    [...($("costChartCars")?.selectedOptions || [])]
      .map((option) => option.value)
      .filter(Boolean),
  );
  const historyModels = (HISTORY?.models || []).filter((model) =>
    matchesCostChartFilters(model, selectedCars, endMonth),
  );
  let chartType = "bar";
  let labels = [];
  let datasets = [];
  const palette = ["#4ea1ff", "#7c5cff", "#2ecc71", "#f1c40f", "#ff6b5e", "#4fd1e8"];
  if (selectedCars.size) {
    chartType = "line";
    labels = monthKeys;
    for (const [modelIndex, model] of historyModels.entries()) {
      for (const [metricIndex, metric] of active.entries()) {
        const fieldIndex = HISTORY.fields.indexOf(metric.field);
        const values = monthKeys.map((month) => model.s[month]?.[fieldIndex] ?? null);
        if (values.every((value) => value == null)) continue;
        const color = palette[metricIndex % palette.length];
        datasets.push({
          label: `${model.make} ${model.model} — ${metric.label}`,
          data: values,
          borderColor: color,
          backgroundColor: color,
          borderWidth: 2,
          borderDash: modelIndex % 2 ? [6, 3] : [],
          pointRadius: 2,
          spanGaps: true,
        });
      }
    }
  } else {
    const fieldIndex = HISTORY.fields.indexOf(rankField);
    let rows = historyModels
      .filter((model) => model.s[endMonth]?.[fieldIndex] != null)
      .sort((a, b) => (b.s[endMonth][fieldIndex] || 0) - (a.s[endMonth][fieldIndex] || 0))
      .slice(0, 40);
    labels = rows.map((model) => `${model.make} ${model.model}`);
    datasets = active.map((metric, index) => {
      const metricIndex = HISTORY.fields.indexOf(metric.field);
      const color = palette[index % palette.length];
      return {
        label: metric.label,
        data: rows.map((model) => model.s[endMonth]?.[metricIndex] ?? 0),
        backgroundColor: color + "22",
        borderColor: color,
        borderWidth: 1,
      };
    });
  }
  if (costChart) costChart.destroy();
  costChart = null;
  if (!labels.length || !datasets.length) {
    costChart = null;
    $("costChartNote").textContent = selectedCars.size
      ? "No selected cars have data in this month range and filter combination."
      : `No matching models have cost data for ${endMonth}. Select one or more cars to compare their history across the chosen month range.`;
    return;
  }
  $("costChartNote").textContent = selectedCars.size
    ? `Monthly cost history from ${monthKeys[0]} to ${monthKeys.at(-1)}.`
    : `Top 40 matching models in ${endMonth}. Select one or more cars to compare monthly history across the chosen range.`;
  costChart = new Chart(ctx, {
    type: chartType,
    data: { labels, datasets },
    options: {
      ...chartOpts(),
      indexAxis: chartType === "bar" ? "y" : "x",
      scales: chartType === "bar"
        ? {
            x: {
              ticks: { color: "#9aa3bd", callback: (value) => "$" + (value / 1000) + "k" },
              grid: { color: "#2c3557" },
            },
            y: {
              ticks: { color: "#9aa3bd", font: { size: 10 } },
              grid: { display: false },
            },
          }
        : chartOpts().scales,
    },
  });
}

function costChartCarKey(row) {
  return row.id || [row.make, row.model, row.fuel, row.cc || "", row.kw, row.coe_cat || row.cat || ""].join("|");
}

function refreshCostChartCarOptions() {
  const select = $("costChartCars");
  if (!select) return;
  const selected = new Set(
    [...select.selectedOptions].map((option) => option.value).filter(Boolean),
  );
  select.innerHTML = '<option value="" disabled>Select cars (optional)</option>';
  const cars = [...new Map((HISTORY?.models || []).map((row) => [costChartCarKey(row), row])).values()]
    .sort((a, b) => a.make.localeCompare(b.make) || a.model.localeCompare(b.model));
  for (const row of cars) {
    const details = [row.fuel, row.cat ? `Cat ${row.cat}` : ""].filter(Boolean).join(", ");
    const label = `${row.make} ${row.model}${details ? ` (${details})` : ""}`;
    const option = new Option(label, costChartCarKey(row));
    option.selected = selected.has(option.value);
    select.add(option);
  }
  if (![...select.options].some((option) => option.selected && option.value)) {
    select.options[0].selected = true;
  }
}

function initCostChartPeriods() {
  const months = HISTORY?.months || [];
  for (const id of ["costChartFrom", "costChartTo"]) {
    const select = $(id);
    select.innerHTML = "";
    months.forEach((month) => select.add(new Option(month, month)));
  }
  $("costChartFrom").value = months[0] || "";
  $("costChartTo").value = months.at(-1) || "";
}

function matchesCostChartFilters(model, selectedCars, month) {
  if (selectedCars.size && !selectedCars.has(costChartCarKey(model))) return false;
  if ($("costMake").value !== "__all__" && model.make !== $("costMake").value) return false;
  if ($("costModel").value !== "__all__" && model.model !== $("costModel").value) return false;
  if ($("costFuel").value !== "__all__" && model.fuel !== $("costFuel").value) return false;
  if ($("costCat").value !== "__all__" && model.cat !== $("costCat").value) return false;
  const query = $("costSearch").value.trim().toLowerCase();
  if (query && !`${model.make} ${model.model}`.toLowerCase().includes(query)) return false;
  const min = $("costOmvMin").value === "" ? null : Number($("costOmvMin").value);
  const max = $("costOmvMax").value === "" ? null : Number($("costOmvMax").value);
  if (min != null || max != null) {
    const omvIndex = HISTORY.fields.indexOf("omv");
    const months = selectedCars.size
      ? HISTORY.months.filter((historyMonth) =>
          historyMonth >= $("costChartFrom").value && historyMonth <= $("costChartTo").value)
      : [month];
    const matchesOmv = months.some((historyMonth) => {
      const omv = model.s[historyMonth]?.[omvIndex];
      return omv != null && (min == null || omv >= min) && (max == null || omv <= max);
    });
    if (!matchesOmv) return false;
  }
  return true;
}

function initOmvFilters() {
  const makes = [...new Set((HISTORY?.models || []).map((model) => model.make))].sort();
  makes.forEach((make) => $("omvMake").add(new Option(make, make)));
  $("omvMake").addEventListener("change", () => {
    refreshOmvModels();
    renderOmvChart();
  });
  $("omvModel").addEventListener("change", renderOmvChart);
}

function refreshOmvModels() {
  const make = $("omvMake").value;
  const select = $("omvModel");
  select.innerHTML = '<option value="">Choose model</option>';
  const models = (HISTORY?.models || [])
    .filter((model) => model.make === make && Object.values(model.s || {}).some((values) => values[0] != null))
    .sort((a, b) => a.model.localeCompare(b.model) || a.id.localeCompare(b.id));
  models.forEach((model) => {
    const details = [model.fuel, model.cat ? `Cat ${model.cat}` : ""].filter(Boolean).join(", ");
    select.add(new Option(details ? `${model.model} (${details})` : model.model, model.id));
  });
  select.disabled = !models.length;
  select.value = "";
  if (!make) $("omvNote").textContent = "Choose a make and model to display its monthly OMV history.";
  else if (!models.length) $("omvNote").textContent = "No models with OMV history are available for this make.";
}

function renderOmvChart() {
  const canvas = $("omvChart");
  if (!canvas || typeof Chart === "undefined" || !HISTORY) return;
  if (omvChart) {
    omvChart.destroy();
    omvChart = null;
  }
  const selected = HISTORY.models.find((model) => model.id === $("omvModel").value);
  if (!selected) {
    $("omvChartWrap").hidden = true;
    return;
  }
  const monthKeys = HISTORY.months || [];
  $("omvNote").textContent = `Monthly OMV history for ${selected.make} ${selected.model}.`;
  $("omvChartWrap").hidden = false;
  const palette = "#3ddbb0";
  omvChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: monthKeys,
      datasets: [{
        label: "OMV",
        data: monthKeys.map((month) => selected.s[month]?.[0] ?? null),
        borderColor: palette,
        backgroundColor: palette,
        borderWidth: 2,
        pointRadius: 2,
        spanGaps: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "nearest", intersect: false },
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#9aa3bd", maxRotation: 45 } },
        y: {
          ticks: { color: "#9aa3bd", callback: (value) => fmtMoney(value) },
          grid: { color: "#2c3557" },
        },
      },
    },
  });
}

function refreshModels() {
  const make = $("costMake") ? $("costMake").value : "__all__";
  const mod = $("costModel");
  if (!mod) return;
  mod.innerHTML = '<option value="__all__">All models</option>';
  let list = COSTS;
  if (make !== "__all__") list = list.filter(r=>r.make===make);
  [...new Set(list.map(r=>r.model))].sort().forEach(x=>mod.add(new Option(x,x)));
}

function chartOpts() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    resizeDelay: 0,
    interaction: { mode: "index", intersect: false },
    plugins: { legend: { labels: { color: "#e8ecf5" } }, tooltip: { mode: "index", intersect: false } },
    scales: {
      x: { ticks: { color: "#9aa3bd", maxRotation: 45, font: { size: 10 } }, grid: { display: false } },
      y: { ticks: { color: "#9aa3bd", callback: (v) => "$" + (v / 1000) + "k" }, grid: { color: "#2c3557" } },
    },
  };
}

load();
