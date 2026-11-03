const $ = id => document.getElementById(id);
const COLORS = ["#3ddbb0", "#f2b84b", "#5aa9ff", "#ff6b5e", "#b28cff", "#7ee081", "#ff9f5a", "#4fd1e8"];
const fmt = n => Number(n).toLocaleString("en-SG");
const chartState = { current: null };
let data;
let activeView;

initialize();

async function initialize() {
  try {
    const response = await fetch("data/commercial.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`data/commercial.json returned HTTP ${response.status}`);
    }
    data = await response.json();
    if (!data || !Array.isArray(data.population) || !Array.isArray(data.annual) || !Array.isArray(data.monthly)) {
      throw new Error("data/commercial.json does not contain population, annual, and monthly arrays");
    }
  } catch (error) {
    console.error("Could not load commercial vehicle data:", error);
    $("title").textContent = "Commercial vehicles";
    $("note").textContent = `Could not load commercial vehicle data: ${error.message}`;
    return;
  }

  document.querySelectorAll(".nav-link").forEach(link => {
    link.classList.toggle("active", link.getAttribute("href") === "commercial.html");
  });
  $("view").addEventListener("change", render);
  $("chartPeriod").addEventListener("change", drawChart);
  $("search").addEventListener("input", drawChart);
  $("tableYear").addEventListener("change", () => {
    refreshTableMonthOptions();
    renderTable();
  });
  $("tableMonth").addEventListener("change", renderTable);
  $("tableSearch").addEventListener("input", renderTable);
  addMultiFilterListener("tableMake");
  addMultiFilterListener("tableFuel");
  $("resetFilters").addEventListener("click", resetFilters);
  try {
    render();
  } catch (error) {
    console.error("Could not render commercial vehicle dashboard:", error);
    $("note").textContent = `Commercial vehicle data loaded, but the page could not render it: ${error.message}`;
  }
}

function currentRows() {
  if (!data) return [];
  if ($("view").value === "population") return data.population || [];
  return $("view").value === "monthly" ? data.monthly || [] : data.annual || [];
}

function currentPeriodKey() {
  return $("view").value === "monthly" ? "m" : "y";
}

function periodLabel(value, key) {
  return key === "m"
    ? new Date(value + "-01").toLocaleDateString("en-GB", { month: "short", year: "numeric" })
    : String(value);
}

function selectedValues(id) {
  return new Set([...$(id).selectedOptions].map(option => option.value).filter(Boolean));
}

function addMultiFilterListener(id) {
  $(id).addEventListener("change", () => {
    const select = $(id);
    const hasSelection = [...select.selectedOptions].some(option => option.value);
    const placeholder = [...select.options].find(option => option.value === "");
    if (placeholder) placeholder.selected = !hasSelection;
    renderTable();
  });
}

function resetMultiFilter(id) {
  [...$(id).options].forEach(option => {
    option.selected = option.value === "";
  });
}

function setOptions(id, placeholderText, values, previous) {
  const select = $(id);
  select.innerHTML = select.multiple ? `<option value="" disabled>${placeholderText}</option>` : "";
  for (const [value, label] of values) select.add(new Option(label, value));
  const available = new Set(values.map(([value]) => value));
  const kept = [...previous].filter(value => available.has(value));
  for (const option of select.options) {
    option.selected = option.value ? kept.includes(option.value) : kept.length === 0;
  }
  if (!select.multiple && !kept.length && select.options.length) {
    select.options[0].selected = true;
  }
}

function render() {
  if (!data) {
    $("title").textContent = "Commercial vehicles";
    $("note").textContent = "No commercial vehicle data yet. Add the LTA population, annual registration, or monthly registration PDF to incoming/.";
    return;
  }

  const view = $("view").value;
  const switchedToMonthly = view === "monthly" && activeView !== "monthly";
  const key = currentPeriodKey();
  const records = currentRows();
  const periods = [...new Set(records.map(row => String(row[key])))].sort();
  const previousChartPeriod = $("chartPeriod").value;
  $("tableMonth").hidden = key !== "m";
  $("title").textContent = view === "population"
    ? "Commercial vehicle population by make"
    : `New commercial vehicle ${view} by make`;

  $("chartPeriod").innerHTML = "";
  if (view === "monthly" && periods.length) {
    const latestYear = periods.at(-1).slice(0, 4);
    const ytdMonths = periods.filter(month => month.startsWith(latestYear));
    $("chartPeriod").add(new Option(`${latestYear} YTD (Jan–${periodLabel(ytdMonths.at(-1), "m").split(" ")[0]})`, "__ytd__"));
  }
  periods.forEach(value => $("chartPeriod").add(new Option(periodLabel(value, key), value)));
  const chartPeriodValues = [...$("chartPeriod").options].map(option => option.value);
  if (chartPeriodValues.includes(previousChartPeriod)) $("chartPeriod").value = previousChartPeriod;
  else if (view === "monthly" && chartPeriodValues.includes("__ytd__")) $("chartPeriod").value = "__ytd__";
  else if (periods.length) $("chartPeriod").value = periods.at(-1);

  const years = [...new Set(records.map(row => String(row.y ?? row.m.slice(0, 4))))].sort();
  const months = [...new Set(records.filter(row => key === "m").map(row => row.m))].sort();
  const previousYear = $("tableYear").value;
  const selectedYear = previousYear && previousYear !== "__all__" && years.includes(previousYear)
    ? previousYear
    : key === "m" ? years.at(-1) || "__all__" : "__all__";
  setOptions(
    "tableYear",
    "All years",
    [["__all__", "All years"], ...years.map(year => [year, year])],
    new Set([selectedYear]),
  );
  if (switchedToMonthly) $("tableMonth").value = "__ytd__";
  refreshTableMonthOptions(months);
  activeView = view;
  const makes = [...new Set(records.map(row => row.make))].sort();
  const fuels = [...new Set(records.map(row => row.fuel || "__not_reported__"))].sort();
  setOptions("tableMake", "All makes", makes.map(make => [make, make]), selectedValues("tableMake"));
  setOptions(
    "tableFuel",
    "All propellants",
    fuels.map(fuel => [fuel, fuel === "__not_reported__" ? "Not reported" : fuel]),
    selectedValues("tableFuel"),
  );

  if (!periods.length) {
    $("note").textContent = `No ${view === "population" ? "population" : "registration"} data available yet. Upload the matching LTA PDF to incoming/.`;
    drawChart();
    renderTable();
    return;
  }

  const dataNote = view === "population"
    ? "End-of-year population of goods vehicles and buses."
    : view === "monthly" && $("chartPeriod").value === "__ytd__"
      ? "Year-to-date new registrations of goods vehicles and buses."
      : `New ${view} registrations of goods vehicles and buses.`;
  $("note").textContent = `${dataNote} The chart breaks each make down by propellant for the selected ${key === "y" ? "year" : $("chartPeriod").value === "__ytd__" ? "year to date" : "month"}.`;
  drawChart();
  renderTable();
}

function refreshTableMonthOptions(months = [...new Set(currentRows().filter(row => row.m).map(row => row.m))].sort()) {
  const year = $("tableYear").value;
  const filteredMonths = months.filter(month => year === "__all__" || month.startsWith(year));
  const previousMonth = $("tableMonth").value;
  const latest = filteredMonths.at(-1);
  const options = [["__all__", "All months"]];
  if (latest) options.push(["__ytd__", `YTD through ${periodLabel(latest, "m")}`]);
  options.push(...filteredMonths.map(month => [month, periodLabel(month, "m")]));
  const defaultSelection = previousMonth && options.some(([value]) => value === previousMonth)
    ? previousMonth
    : latest ? "__ytd__" : "__all__";
  setOptions(
    "tableMonth",
    "All months",
    options,
    new Set([defaultSelection]),
  );
}

function drawChart() {
  chartState.current?.destroy();
  chartState.current = null;
  const records = currentRows();
  const key = currentPeriodKey();
  const period = $("chartPeriod").value;
  if (!period) return;

  const query = $("search").value.trim().toLowerCase();
  const byMake = new Map();
  let chartRows = records.filter(row => String(row[key]) === period);
  if (key === "m" && period === "__ytd__") {
    const latestYear = [...new Set(records.map(row => row.m.slice(0, 4)))].sort().at(-1);
    chartRows = aggregateMonthlyRows(records.filter(row => row.m.startsWith(latestYear)), latestYear);
  }
  for (const row of chartRows) {
    if (query && !row.make.toLowerCase().includes(query)) continue;
    const fuel = row.fuel || "Not reported";
    if (!byMake.has(row.make)) byMake.set(row.make, new Map());
    const fuels = byMake.get(row.make);
    fuels.set(fuel, (fuels.get(fuel) || 0) + row.u);
  }
  const makes = [...byMake.entries()]
    .map(([make, fuels]) => ({ make, fuels, total: [...fuels.values()].reduce((sum, value) => sum + value, 0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);
  if (!makes.length) return;
  const fuelTypes = [...new Set(makes.flatMap(row => [...row.fuels.keys()]))].sort();

  chartState.current = new Chart($("c1"), {
    type: "bar",
    data: {
      labels: makes.map(row => row.make),
      datasets: fuelTypes.map((fuel, index) => ({
        label: fuel,
        data: makes.map(row => row.fuels.get(fuel) || 0),
        backgroundColor: COLORS[index % COLORS.length],
        borderWidth: 0,
      })),
    },
    options: {
      indexAxis: "y",
      maintainAspectRatio: false,
      scales: { x: { stacked: true }, y: { stacked: true } },
      plugins: { legend: { position: "bottom" } },
    },
  });
}

function renderTable() {
  const records = currentRows();
  const key = currentPeriodKey();
  const year = $("tableYear").value;
  const month = $("tableMonth").value;
  const makes = selectedValues("tableMake");
  const fuels = selectedValues("tableFuel");
  const query = $("tableSearch").value.trim().toLowerCase();
  const filteredRecords = records.filter(row => {
    const rowYear = String(row.y ?? (row.m === "__ytd__" ? year : row.m.slice(0, 4)));
    if (year !== "__all__" && rowYear !== year) return false;
    if (key === "m" && month !== "__all__" && month !== "__ytd__" && row.m !== month) return false;
    if (makes.size && !makes.has(row.make)) return false;
    const fuel = row.fuel || "__not_reported__";
    if (fuels.size && !fuels.has(fuel)) return false;
    const rowMonth = key === "m" ? periodLabel(row.m, "m") : "";
    if (query && !`${rowYear} ${rowMonth} ${row.make} ${row.fuel || "Not reported"}`.toLowerCase().includes(query)) return false;
    return true;
  });
  const ytdYear = year === "__all__"
    ? records.map(row => row.m?.slice(0, 4)).filter(Boolean).sort().at(-1)
    : year;
  const ytdEndMonth = records
    .map(row => row.m)
    .filter(value => value?.startsWith(ytdYear || ""))
    .sort()
    .at(-1);
  let rows = key === "m" && month === "__ytd__"
    ? aggregateMonthlyRows(filteredRecords, ytdYear, ytdEndMonth)
    : filteredRecords;
  rows = rows.sort((a, b) => String(b[key]).localeCompare(String(a[key])) || a.make.localeCompare(b.make) || (a.fuel || "").localeCompare(b.fuel || ""));

  const columns = [
    { h: "Data type", get: () => $("view").value === "population" ? "Population" : "Registrations" },
    { h: "Year", get: row => row.y ?? (row.m === "__ytd__" ? ytdYear : row.m.slice(0, 4)) },
    ...(key === "m" ? [{ h: "Month", get: row => row.m === "__ytd__" ? `YTD through ${periodLabel(row.ytdEnd, "m")}` : periodLabel(row.m, "m") }] : []),
    { h: "Make", get: row => row.make },
    { h: "Propellant", get: row => row.fuel || "Not reported" },
    {
      h: "Units",
      get: row => row.u,
      num: 1,
      sum: $("view").value !== "population" || $("tableYear").value !== "__all__",
    },
  ];
  $("tableHeads").innerHTML = columns.map(column =>
    `<th${column.num ? ' class="num"' : ""}>${column.h}</th>`
  ).join("");
  window.pagedTable($("tbl"), rows, columns, { reset: true });

  $("tableNote").textContent = $("view").value === "population"
    ? "Population propellant detail is published from 2022 onward; earlier population years are reported by make only and appear as “Not reported”."
    : key === "m" && month === "__ytd__"
      ? `Year-to-date totals sum monthly registrations from January through ${periodLabel(rows[0]?.ytdEnd || "", "m")} for ${year === "__all__" ? "the latest year" : year}.`
    : "Annual and monthly registrations come from separate LTA reports. Each row aggregates the selected make and propellant across goods vehicles and buses.";
}

function aggregateMonthlyRows(rows, year, ytdEndMonth) {
  const grouped = new Map();
  for (const row of rows) {
    if (year && !row.m.startsWith(year)) continue;
    const key = `${row.make}|${row.fuel || ""}`;
    if (!grouped.has(key)) {
      grouped.set(key, { m: "__ytd__", make: row.make, fuel: row.fuel || "", u: 0, ytdEnd: ytdEndMonth || row.m });
    }
    const total = grouped.get(key);
    total.u += row.u;
    if (!ytdEndMonth && row.m > total.ytdEnd) total.ytdEnd = row.m;
  }
  return [...grouped.values()];
}

function resetFilters() {
  $("tableYear").value = "__all__";
  $("tableMonth").value = "__all__";
  $("tableSearch").value = "";
  resetMultiFilter("tableMake");
  resetMultiFilter("tableFuel");
  if ($("view").value === "monthly") {
    const years = currentRows().map(row => row.m.slice(0, 4));
    $("tableYear").value = years.sort().at(-1) || "__all__";
    $("tableMonth").value = "__ytd__";
    refreshTableMonthOptions();
  }
  renderTable();
}
