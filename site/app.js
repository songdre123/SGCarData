// SG Car Data Dashboard
const $ = (id) => document.getElementById(id);
const fmt = (n) => (n == null ? "—" : n.toLocaleString("en-SG"));

let ALL = [];
let MONTHS = [];
let LATEST = "";
let SCOPE = { year: "__all__", month: "__all__" };
let OVERVIEW_SORT = { key: "u", direction: "desc" };
let BMW_SIME_SHARE = 60;
let monthlyChart = null;
let fuelChart = null;
let bodyChart = null;
let makeChart = null;
let registrationTrendChart = null;
let marketShareChart = null;

async function load() {
  const meta = await (await fetch("data/meta.json")).json();
  MONTHS = meta.months;
  LATEST = meta.latest;
  ALL = await (await fetch("data/registrations.json")).json();
  initScope();
  initFilters();
  initRegistrationTrendFilters();
  render();
}
function getCurrentYear() {
  const now = new Date();
  return now.getFullYear().toString();
}

function selectedFilterValues(id) {
  const select = $(id);
  return select
    ? new Set([...select.selectedOptions].map((option) => option.value).filter(Boolean))
    : new Set();
}

function resetMultiFilter(id) {
  const select = $(id);
  if (!select) return;
  [...select.options].forEach((option) => {
    option.selected = option.value === "";
  });
}

function addMultiFilterListener(id, onChange) {
  const select = $(id);
  if (!select) return;
  select.addEventListener("change", () => {
    const hasSelection = [...select.selectedOptions].some((option) => option.value);
    const placeholder = [...select.options].find((option) => option.value === "");
    if (placeholder) placeholder.selected = !hasSelection;
    onChange();
  });
}

function initPanelToggles() {
  const animations = new WeakMap();
  document.querySelectorAll("details.panel").forEach((panel, index) => {
    const summary = panel.querySelector(":scope > summary");
    const content = panel.querySelector(":scope > .panel-content");
    const button = summary?.querySelector(".panel-toggle");
    if (!summary || !content || !button) return;

    content.id = `panel-content-${index + 1}`;
    button.setAttribute("aria-controls", content.id);
    button.setAttribute("aria-expanded", String(panel.open));
    const panelName = button.getAttribute("aria-label").replace(/^(Collapse|Expand)\s+/, "");
    button.setAttribute("aria-label", `${panel.open ? "Collapse" : "Expand"} ${panelName}`);
    summary.addEventListener("click", (event) => {
      event.preventDefault();
      if (event.target.closest(".panel-toggle") !== button) return;

      const opening = button.getAttribute("aria-expanded") !== "true";
      const previous = animations.get(panel);
      const computed = getComputedStyle(content);
      const fromHeight = previous ? content.getBoundingClientRect().height : opening ? 0 : content.scrollHeight;
      const fromOpacity = previous ? Number(computed.opacity) : opening ? 0 : 1;
      previous?.cancel();
      animations.delete(panel);

      panel.open = true;
      button.setAttribute("aria-expanded", String(opening));
      button.setAttribute("aria-label", `${opening ? "Collapse" : "Expand"} ${panelName}`);
      content.style.overflow = "hidden";
      const toHeight = opening ? content.scrollHeight : 0;
      const animation = content.animate(
        [
          { height: `${fromHeight}px`, opacity: fromOpacity },
          { height: `${toHeight}px`, opacity: opening ? 1 : 0 },
        ],
        {
          duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 220,
          easing: "ease",
        },
      );
      animations.set(panel, animation);
      animation.onfinish = () => {
        if (animations.get(panel) !== animation) return;
        animations.delete(panel);
        if (!opening) panel.open = false;
        content.style.removeProperty("overflow");
      };
    });
  });
}

function initScope() {
  const years = [...new Set(MONTHS.map((m) => m.slice(0, 4)))].sort();
  const y = $("scopeYear");
  y.innerHTML = '<option value="__all__">All years</option>';
  years.forEach((x) => y.add(new Option(x, x)));
  y.value = years.includes(getCurrentYear()) ? getCurrentYear() : "__all__";
  SCOPE.year = y.value;

  const m = $("scopeMonth");
  m.innerHTML = '<option value="__all__">All months (YTD)</option>';

  y.addEventListener("change", () => {
    SCOPE.year = y.value;
    refreshMonthOptions();
    $("ovYearFilter").hidden = y.value !== "__all__";
    render();
  });
  $("ovYearFilter").hidden = y.value !== "__all__";
  refreshMonthOptions();
  $("scopeMonth").addEventListener("change", () => { SCOPE.month = $("scopeMonth").value; render(); });
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
    ty.value = years.includes(getCurrentYear()) ? getCurrentYear() : "__all__";
    refreshTableMonthOptions();
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
  }
  addMultiFilterListener("tableMake", renderTable);
  // Table importer
  if ($("tableImporter")) $("tableImporter").addEventListener("change", renderTable);
  const tableTier = $("tableTier");
  if (tableTier) {
    const tiers = [...new Set(ALL.map((r) => r.tier).filter(Boolean))].sort();
    tiers.forEach((tier) => {
      tableTier.add(new Option(tier, tier));
    });
    if (ALL.some((r) => !r.tier)) tableTier.add(new Option("Other", "__other__"));
    tableTier.addEventListener("change", renderTable);
  }
  // Table body
  addMultiFilterListener("tableBody", renderTable);
  // Table fuel
  const tf = $("tableFuel");
  if (tf) {
    const fuels = [...new Set(ALL.map((r) => r.fuel))].sort();
    fuels.forEach((x) => tf.add(new Option(x, x)));
  }
  addMultiFilterListener("tableFuel", renderTable);
  // Table search
  if ($("tableSearch")) $("tableSearch").addEventListener("input", renderTable);
  // Reset
  if ($("resetFilters")) $("resetFilters").addEventListener("click", () => {
    if ($("tableSearch")) $("tableSearch").value = "";
    if ($("tableYear")) $("tableYear").value = "__all__";
    if ($("tableMonth")) $("tableMonth").value = "__all__";
    resetMultiFilter("tableMake");
    if ($("tableImporter")) $("tableImporter").value = "__all__";
    if ($("tableTier")) $("tableTier").value = "__all__";
    resetMultiFilter("tableBody");
    resetMultiFilter("tableFuel");
    renderTable();
  });
  // Top make month
  const tmm = $("topMakeMonth");
  if (tmm) {
    tmm.innerHTML = '<option value="__all__">All months</option>';
    MONTHS.forEach((x) => tmm.add(new Option(x, x)));
    tmm.addEventListener("change", renderMakeChart);
  }
  const monthlyMake = $("monthlyMake");
  const monthlyMonth = $("monthlyMonth");
  if (monthlyMonth) {
    MONTHS.forEach((month) => monthlyMonth.add(new Option(month, month)));
    monthlyMonth.addEventListener("change", renderMonthlyBar);
  }
  if (monthlyMake) {
    [...new Set(ALL.map((r) => r.make).filter(Boolean))].sort().forEach((make) => {
      monthlyMake.add(new Option(make, make));
    });
    monthlyMake.addEventListener("change", renderMonthlyBar);
  }
  ["monthlyGroup", "monthlyImporter", "monthlyFuel", "monthlyBody"].forEach((id) => {
    const filter = $(id);
    if (filter) filter.addEventListener("change", renderMonthlyBar);
  });
  const monthlyFuel = $("monthlyFuel");
  if (monthlyFuel) {
    [...new Set(ALL.map((r) => r.fuel).filter(Boolean))].sort().forEach((fuel) => {
      monthlyFuel.add(new Option(fuel, fuel));
    });
  }
  const bmwSimeShare = $("bmwSimeShare");
  if (bmwSimeShare) {
    bmwSimeShare.addEventListener("input", () => {
      BMW_SIME_SHARE = Number(bmwSimeShare.value);
      $("bmwSimeShareValue").textContent = `${BMW_SIME_SHARE}% SIME / ${100 - BMW_SIME_SHARE}% EUROKARS`;
      renderDistributorTable();
    });
  }
  // Last update
  if ($("lastUpdate")) $("lastUpdate").textContent = "Updated " + LATEST;

  // overview filters
  const ovMake = $("ovMake");
  if (ovMake) {
    [...new Set(ALL.map(r=>r.make).filter(Boolean))].sort().forEach((make) => {
      ovMake.add(new Option(make, make));
    });
  }
  addMultiFilterListener("ovMake", renderOverview);
  const ovy2 = $("ovYear");
  if (ovy2) {
    const years = [...new Set(MONTHS.map(m=>m.slice(0,4)))].sort();
    years.forEach(x=>ovy2.add(new Option(x,x)));
    ovy2.addEventListener("change", renderOverview);
  }
  const ovt2 = $("ovTier");
  if (ovt2) {
    const tiers = [...new Set(ALL.map(r=>r.tier).filter(Boolean))].sort();
    tiers.forEach(x=>ovt2.add(new Option(x,x)));
    if (ALL.some((r) => !r.tier)) ovt2.add(new Option("Other", "__other__"));
    ovt2.addEventListener("change", renderOverview);
  }
  const ovc2 = $("ovCountry");
  if (ovc2) {
    const countries = [...new Set(ALL.map(r=>r.country).filter(Boolean))].sort();
    countries.forEach(x=>ovc2.add(new Option(x,x)));
    ovc2.addEventListener("change", renderOverview);
  }
  const ovi = $("ovImporter");
  if (ovi) ovi.addEventListener("change", renderOverview);
  const ovBody = $("ovBody");
  if (ovBody) {
    const bodyNames = { CPE: "Coupe", HB: "Hatchback", MPV: "MPV", SDN: "Sedan", STW: "Station Wagon", SUV: "SUV" };
    [...new Set(ALL.map(r=>r.body).filter(Boolean))].sort().forEach((body) => {
      ovBody.add(new Option(bodyNames[body] || body, body));
    });
  }
  addMultiFilterListener("ovBody", renderOverview);
  const ovFuel = $("ovFuel");
  if (ovFuel) {
    [...new Set(ALL.map(r=>r.fuel).filter(Boolean))].sort().forEach((fuel) => {
      ovFuel.add(new Option(fuel, fuel));
    });
  }
  addMultiFilterListener("ovFuel", renderOverview);
  const shareMakes = $("shareMakes");
  if (shareMakes) {
    [...new Set(ALL.map((row) => row.make).filter(Boolean))]
      .sort()
      .forEach((make) => shareMakes.add(new Option(make, make)));
    addMultiFilterListener("shareMakes", renderMarketShareChart);
  }
  const overviewTable = $("overviewTable");
  if (overviewTable) {
    overviewTable.tHead.addEventListener("click", (event) => {
      const button = event.target.closest("[data-overview-sort]");
      if (!button) return;
      const key = button.dataset.overviewSort;
      OVERVIEW_SORT = {
        key,
        direction: OVERVIEW_SORT.key === key && OVERVIEW_SORT.direction === "desc" ? "asc" : "desc",
      };
      renderOverview();
    });
  }
}

function render() {
  renderKPIs();
  renderMonthlyBar();
  renderRegistrationTrend();
  renderMarketShareChart();
  renderFuelChart();
  renderBodyChart();
  renderMakeChart();
  renderDistributorTable();
  renderTable();
  renderOverview();
}

function initRegistrationTrendFilters() {
  const from = $("trendFrom");
  const to = $("trendTo");
  const makesSelect = $("trendMakes");
  MONTHS.forEach((month) => {
    from.add(new Option(month, month));
    to.add(new Option(month, month));
  });
  [...new Set(ALL.map((row) => row.make).filter(Boolean))]
    .sort()
    .forEach((make) => makesSelect.add(new Option(make, make)));
  addMultiFilterListener("trendMakes", renderRegistrationTrend);
  from.value = MONTHS[0] || "";
  to.value = LATEST;
  $("trendMode").addEventListener("change", () => {
    const custom = $("trendMode").value === "custom";
    $("trendFromLabel").hidden = !custom;
    $("trendToLabel").hidden = !custom;
    renderRegistrationTrend();
    renderMarketShareChart();
  });
  $("trendValues").addEventListener("change", renderRegistrationTrend);
  from.addEventListener("change", () => {
    if (from.value > to.value) to.value = from.value;
    renderRegistrationTrend();
    renderMarketShareChart();
  });
  to.addEventListener("change", () => {
    if (to.value < from.value) from.value = to.value;
    renderRegistrationTrend();
    renderMarketShareChart();
  });
  $("trendMode").value = "from_start";
  $("trendFromLabel").hidden = true;
  $("trendToLabel").hidden = true;
}

function getTrendMonths() {
  const mode = $("trendMode").value;
  if (mode === "current_year") {
    return MONTHS.filter((month) => month.startsWith(LATEST.slice(0, 4)) && month <= LATEST);
  }
  if (mode === "custom") {
    return MONTHS.filter((month) => month >= $("trendFrom").value && month <= $("trendTo").value);
  }
  return MONTHS.filter((month) => month <= LATEST);
}

function getMonthlyMakeTotals(months) {
  const totals = new Map(months.map((month) => [month, new Map()]));
  ALL.forEach((row) => {
    const monthTotals = totals.get(row.m);
    if (!monthTotals) return;
    monthTotals.set(row.make, (monthTotals.get(row.make) || 0) + (row.u || 0));
  });
  return totals;
}

function renderRegistrationTrend() {
  const canvas = $("registrationTrendChart");
  if (!canvas) return;
  const mode = $("trendMode").value;
  const months = getTrendMonths();
  const totals = getMonthlyMakeTotals(months);
  const selectedMakes = selectedFilterValues("trendMakes");
  const makes = selectedMakes.size
    ? [...selectedMakes]
    : [...ALL.reduce((makeTotals, row) => {
        if (totals.has(row.m)) makeTotals.set(row.make, (makeTotals.get(row.make) || 0) + (row.u || 0));
        return makeTotals;
      }, new Map())]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 10)
        .map(([make]) => make);
  const datasets = makes.map((make, index) => {
    let runningTotal = 0;
    return {
      label: make,
      data: months.map((month) => {
        const registrations = totals.get(month)?.get(make) || 0;
        if ($("trendValues").value === "monthly") return registrations;
        runningTotal += registrations;
        return runningTotal;
      }),
      borderColor: getColor(index),
      backgroundColor: getColor(index),
      borderWidth: 2,
      pointRadius: 2,
      tension: 0.2,
    };
  });
  if (registrationTrendChart) registrationTrendChart.destroy();
  registrationTrendChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: months,
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: true, position: "bottom", labels: { color: "#9aa3bd" } },
        tooltip: { callbacks: { label: (context) => `${context.dataset.label}: ${fmt(context.parsed.y)}` } },
      },
      scales: {
        x: { ticks: { color: "#9aa3bd", maxRotation: 45 }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { color: "#9aa3bd" }, grid: { color: "#2c3557" } },
      },
    },
  });
  const descriptions = {
    from_start: `Registrations by make from ${months[0]} through ${months.at(-1)}.`,
    current_year: `Registrations by make from January through ${months.at(-1)} (${LATEST.slice(0, 4)}).`,
    custom: `Registrations by make from ${months[0]} through ${months.at(-1)}.`,
  };
  const valueDescription = $("trendValues").value === "cumulative" ? "Cumulative totals." : "Monthly values.";
  $("trendNote").textContent = `${descriptions[mode]} ${valueDescription} ${selectedMakes.size ? "Showing selected makes." : "Showing the top 10 makes in this period."}`;
}

function renderMarketShareChart() {
  const canvas = $("marketShareChart");
  if (!canvas) return;
  const months = getTrendMonths();
  const totals = getMonthlyMakeTotals(months);
  const explicitMakes = selectedFilterValues("shareMakes");
  const latestTotals = totals.get(months.at(-1)) || new Map();
  const makes = explicitMakes.size
    ? [...explicitMakes]
    : [...latestTotals.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 8)
        .map(([make]) => make);
  const colors = makes.map((_, index) => getColor(index));
  const datasets = makes.flatMap((make, index) => {
    const registrations = months.map((month) => totals.get(month)?.get(make) || 0);
    const marketShares = months.map((month) => {
      const monthTotals = totals.get(month);
      const marketTotal = [...(monthTotals?.values() || [])].reduce((sum, units) => sum + units, 0);
      return marketTotal ? (monthTotals.get(make) || 0) / marketTotal * 100 : 0;
    });
    return [
      {
        type: "bar",
        label: `${make} registrations`,
        data: registrations,
        backgroundColor: colors[index] + "99",
        borderColor: colors[index],
        borderWidth: 1,
        stack: "registrations",
        yAxisID: "y",
      },
      {
        type: "line",
        label: `${make} market share`,
        data: marketShares,
        borderColor: colors[index],
        backgroundColor: colors[index],
        borderWidth: 2,
        pointRadius: 2,
        tension: 0.15,
        yAxisID: "yShare",
      },
    ];
  });
  if (marketShareChart) marketShareChart.destroy();
  marketShareChart = new Chart(canvas, {
    type: "bar",
    data: { labels: months, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom", labels: { color: "#9aa3bd" } },
        tooltip: {
          callbacks: {
            label(context) {
              const value = context.parsed.y ?? 0;
              return context.dataset.yAxisID === "yShare"
                ? `${context.dataset.label}: ${value.toFixed(1)}%`
                : `${context.dataset.label}: ${fmt(value)}`;
            },
          },
        },
      },
      scales: {
        x: { stacked: true, ticks: { color: "#9aa3bd", maxRotation: 45 }, grid: { display: false } },
        y: {
          stacked: true,
          beginAtZero: true,
          position: "left",
          title: { display: true, text: "Registrations", color: "#9aa3bd" },
          ticks: { color: "#9aa3bd" },
          grid: { color: "#2c3557" },
        },
        yShare: {
          beginAtZero: true,
          max: 100,
          position: "right",
          title: { display: true, text: "Market share", color: "#9aa3bd" },
          ticks: { color: "#9aa3bd", callback: (value) => `${value}%` },
          grid: { drawOnChartArea: false },
        },
      },
    },
  });
  $("shareNote").textContent = `Stacked bars show selected makes' registrations; lines show their share of all registrations for each month. ${months.at(-1)} is the latest available month.`;
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
  const p = ["#3ddbb0", "#f2b84b", "#5aa9ff", "#ff6b5e", "#b28cff", "#7ee081", "#ff9f5a", "#4fd1e8", "#e86fa8", "#c3d35a"];
  return p[index % p.length];
}

function renderMonthlyBar() {
  const ctx = $("monthlyChart");
  if (!ctx) return;
  const month = $("monthlyMonth")?.value || "__all__";
  let rows = month === "__all__" ? scopeRows() : ALL.filter((r) => r.m === month);
  const make = $("monthlyMake")?.value || "__all__";
  const importer = $("monthlyImporter")?.value || "__all__";
  const fuel = $("monthlyFuel")?.value || "__all__";
  const body = $("monthlyBody")?.value || "__all__";
  rows = rows.filter((r) =>
    (make === "__all__" || r.make === make) &&
    (importer === "__all__" || r.importer === importer) &&
    (fuel === "__all__" || r.fuel === fuel) &&
    (body === "__all__" || r.body === body)
  );
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
      resizeDelay: 0,
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
              const value = context.parsed?.x ?? 0;
              const idx = context.dataIndex;
              let makeTotal = 0;
              const datasets = context.chart.data.datasets || [];
              for (let i=0;i<datasets.length;i++) {
                const d = datasets[i].data || [];
                makeTotal += Number(d[idx]) || 0;
              }
              const p = makeTotal > 0 ? (value / makeTotal) * 100 : 0;
              return label + ": " + fmt(value) + " (" + p.toFixed(1) + "% of make, total " + fmt(makeTotal) + ")";
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
          ticks: { color: "#9aa3bd", autoSkip: false, maxRotation: 0, font: { size: 9 } },
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
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: true, position: "bottom", labels: { color: "#9aa3bd" } },
        title: { display: true, text: "Fuel Mix", color: "#e7e9ee" },
        tooltip: {
          callbacks: {
            label: function(context) {
              const total = context.dataset.data.reduce((a,b)=>a+(Number(b)||0),0);
              const v = context.parsed || 0;
              return context.label + ": " + fmt(v) + " (" + (total?((v/total)*100).toFixed(1):0) + "% of total)";
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
      maintainAspectRatio: false,
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
  const monthSel = $("topMakeMonth");
  const rows = monthSel && monthSel.value !== "__all__"
    ? ALL.filter((r) => r.m === monthSel.value)
    : scopeRows();
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
      maintainAspectRatio: false,
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

function renderDistributorTable() {
  const table = $("distributorTable");
  if (!table) return;
  const rows = scopeRows();
  const jointBMW = "EUROKARS AUTO / SIME MOTORS";
  const totals = {};
  let jointBMWUnits = 0;
  let totalUnits = 0;
  rows.forEach((row) => {
    const units = row.u || 0;
    totalUnits += units;
    if (row.make === "BMW" && row.distributor === jointBMW) {
      jointBMWUnits += units;
      return;
    }
    const distributor = row.distributor || "PARALLEL IMPORT (PI)";
    totals[distributor] = (totals[distributor] || 0) + units;
  });

  const simeUnits = Math.round(jointBMWUnits * BMW_SIME_SHARE / 100);
  totals["SIME MOTORS"] = (totals["SIME MOTORS"] || 0) + simeUnits;
  totals["EUROKARS AUTO"] = (totals["EUROKARS AUTO"] || 0) + jointBMWUnits - simeUnits;

  const ranked = Object.entries(totals)
    .map(([distributor, units]) => ({ distributor, units, share: totalUnits ? units / totalUnits * 100 : 0 }))
    .sort((a, b) => b.units - a.units || a.distributor.localeCompare(b.distributor));
  pagedTable(table, ranked, [
    { get: (_, index) => index + 1 },
    { get: (row) => row.distributor },
    { get: (row) => row.units, num: 1, sum: 1 },
    { get: (row) => row.share, num: 1, dec: 1, suf: "%" },
  ], { reset: true });
}

function renderTable() {
  const tbody = document.querySelector("#dataTable tbody");
  if (!tbody) return;
  let rows = scopeRows();
  const q = $("tableSearch") ? $("tableSearch").value.trim().toLowerCase() : "";
  const tm = $("tableMonth") ? $("tableMonth").value : "__all__";
  const tmk = selectedFilterValues("tableMake");
  const tim = $("tableImporter") ? $("tableImporter").value : "__all__";
  const ttier = $("tableTier") ? $("tableTier").value : "__all__";
  const tbd = selectedFilterValues("tableBody");
  const tf = selectedFilterValues("tableFuel");

  const ty = $("tableYear") ? $("tableYear").value : "__all__";
  rows = rows.filter((r) => {
    if (ty !== "__all__" && r.m.slice(0,4) !== ty) return false;
    if (tm !== "__all__" && r.m !== tm) return false;
    if (tmk.size && !tmk.has(r.make)) return false;
    if (tim !== "__all__" && r.importer !== tim) return false;
    if (ttier === "__other__" ? Boolean(r.tier) : ttier !== "__all__" && r.tier !== ttier) return false;
    if (tbd.size && !tbd.has(r.body)) return false;
    if (tf.size && !tf.has(r.fuel)) return false;
    if (q && !(r.m + " " + r.make + " " + r.importer + " " + r.fuel + " " + r.body).toLowerCase().includes(q)) return false;
    return true;
  });

  pagedTable($("dataTable"), rows, [
    { get: r => r.m }, { get: r => r.make }, { get: r => r.importer }, { get: r => r.fuel }, { get: r => r.body },
    { get: r => r.u, num: 1, sum: 1 }, { get: r => r.country || "" }, { get: r => r.tier || "" }, { get: r => r.distributor || "" }], { reset: true });
  const note = $("tableNote");
  if (note) note.textContent = `${fmt(rows.length)} rows match your filters`;
}

initPanelToggles();
load();

function pctOfTotal(total, v) {
  if (!total || !v) return "";
  const p = (v / total) * 100;
  return " (" + p.toFixed(1) + "%)";
}

function renderOverview() {
  const tbody = document.querySelector("#overviewTable tbody");
  if (!tbody) return;
  let rows = scopeRows();
  const ovy = $("scopeYear").value === "__all__" && $("ovYear") ? $("ovYear").value : "__all__";
  if (ovy !== "__all__") rows = rows.filter(r=>r.m.slice(0,4)===ovy);
  const ovt = $("ovTier") ? $("ovTier").value : "__all__";
  const ovc = $("ovCountry") ? $("ovCountry").value : "__all__";
  const ovi = $("ovImporter") ? $("ovImporter").value : "__all__";
  const ovMake = selectedFilterValues("ovMake");
  const ovBody = selectedFilterValues("ovBody");
  const ovFuel = selectedFilterValues("ovFuel");
  const totals = {};
  rows.forEach(r=>{
    if (ovt === "__other__" ? Boolean(r.tier) : ovt !== "__all__" && r.tier !== ovt) return;
    if (ovc !== "__all__" && r.country !== ovc) return;
    if (ovi !== "__all__" && r.importer !== ovi) return;
    if (ovMake.size && !ovMake.has(r.make)) return;
    if (ovBody.size && !ovBody.has(r.body)) return;
    if (ovFuel.size && !ovFuel.has(r.fuel)) return;
    totals[r.make] = totals[r.make] || {u:0,ad:0,ev:0,pi:0,countries:new Set()};
    totals[r.make].u += (r.u||0);
    if (r.importer==="AMD") totals[r.make].ad += (r.u||0);
    if (r.fuel==="Electric") totals[r.make].ev += (r.u||0);
    if (r.importer==="PI") totals[r.make].pi += (r.u||0);
    if (r.country) totals[r.make].countries.add(r.country);
  });
  const grand = Object.values(totals).reduce((s,x)=>s+x.u,0);
  const list = Object.entries(totals).map(([k,v])=>({make:k,u:v.u,ad:v.ad,ev:v.ev,pi:v.pi,c:[...v.countries].sort().join(", "),pct:grand? (v.u/grand*100):0,pctEv:v.u? (v.ev/v.u*100):0,pctPi:v.u?(v.pi/v.u*100):0}));
  const direction = OVERVIEW_SORT.direction === "asc" ? 1 : -1;
  list.sort((a, b) => direction * (a[OVERVIEW_SORT.key] - b[OVERVIEW_SORT.key]) || a.make.localeCompare(b.make));
  $("overviewTable").querySelectorAll("[data-overview-sort]").forEach((button) => {
    const key = button.dataset.overviewSort;
    const active = key === OVERVIEW_SORT.key;
    button.textContent = active ? (OVERVIEW_SORT.direction === "asc" ? "↑" : "↓") : "↕";
    button.setAttribute("aria-label", `Sort ${active && OVERVIEW_SORT.direction === "desc" ? "ascending" : "descending"} by ${button.dataset.sortLabel}`);
    button.setAttribute("aria-pressed", String(active));
  });
  pagedTable(document.getElementById("overviewTable"), list, [
    { get: (x, i) => i + 1 }, { get: x => x.make }, { get: x => x.u, num: 1, sum: 1 }, { get: x => x.ad, num: 1, sum: 1 }, { get: x => x.pct, num: 1, sum: 1, dec: 1, suf: "%" },
    { get: x => x.pctEv, num: 1, dec: 1, suf: "%" }, { get: x => x.pctPi, num: 1, dec: 1, suf: "%" },
    { get: x => x.ev, num: 1, sum: 1 }, { get: x => x.pi, num: 1, sum: 1 }, { get: x => x.c }], { reset: true });
}
