"""Parse LTA commercial-vehicle population and registration PDFs.

Usage: python scripts/parse_commercial_pdf.py file.pdf
The parser recognizes the MVP01-11 population report, MVP02-4 annual new
registrations, and M08 monthly registrations. It validates PDF totals before
updating site/data/commercial.json.
"""
import json
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "site" / "data" / "commercial.json"
NUM = re.compile(r"^\d[\d,]*$")
YEAR = re.compile(r"^20\d\d$")
MONTH = re.compile(r"^20\d\d-\d\d$")
BODY = ("GPV", "LGV", "HGV", "VHGV", "BUS", "Total")
FUELS = (
    "Petrol-Electric (Plug-In)",
    "Diesel-Electric (Plug-In)",
    "Petrol-Electric",
    "Diesel-Electric",
    "Petrol-CNG",
    "Petrol-LPG",
    "CNG",
    "Gas",
    "Petrol",
    "Diesel",
    "Electric",
    "Others",
)


def read_pages(path):
    result = subprocess.run(
        ["pdftotext", "-bbox", str(path), "-"],
        capture_output=True,
        text=True,
        check=True,
    )
    root = ET.fromstring(result.stdout)
    pages = []
    for page in root.findall(".//{*}page"):
        words = [
            {
                "top": float(w.attrib["yMin"]),
                "x0": float(w.attrib["xMin"]),
                "x1": float(w.attrib["xMax"]),
                "text": w.text or "",
            }
            for w in page.findall(".//{*}word")
        ]
        pages.append(group_lines(words))
    return pages


def group_lines(words):
    lines = []
    for word in sorted(words, key=lambda w: (w["top"], w["x0"])):
        if lines and abs(lines[-1]["top"] - word["top"]) <= 2:
            lines[-1]["words"].append(word)
        else:
            lines.append({"top": word["top"], "words": [word]})
    for line in lines:
        line["words"].sort(key=lambda w: w["x0"])
        line["text"] = " ".join(w["text"] for w in line["words"])
    return lines


def years_on(line):
    return [int(w["text"]) for w in line["words"] if YEAR.fullmatch(w["text"])]


def number_words(line):
    return [w for w in line["words"] if NUM.fullmatch(w["text"])]


def row_label(line):
    numbers = number_words(line)
    if not numbers:
        return []
    first_x = min(w["x0"] for w in numbers)
    return [w["text"] for w in line["words"] if w["x0"] < first_x]


def row_values(line, anchors, has_period_total=False):
    """Map numeric cells to the closest header position; return cells and labels."""
    numbers = number_words(line)
    if not numbers:
        return {}, None, []
    labels = row_label(line)
    cells = defaultdict(int)
    period_total = None
    for word in numbers:
        if has_period_total and anchors and word["x1"] < anchors[0] - 5:
            period_total = int(word["text"].replace(",", ""))
            continue
        if not anchors:
            continue
        index = min(range(len(anchors)), key=lambda i: abs(anchors[i] - word["x1"]))
        cells[index] += int(word["text"].replace(",", ""))
    return cells, period_total, labels


def category_anchors(line, expected):
    found = [w for w in line["words"] if w["text"] in BODY]
    if len(found) != expected:
        return None
    return [w["x1"] for w in found]


def make_and_fuel(labels):
    text = " ".join(labels)
    for fuel in FUELS:
        if text.endswith(" " + fuel):
            make = text[: -len(fuel)].strip()
            if make:
                return make, fuel
    return None, None


def report_errors(errors):
    if errors:
        print("CHECK FAILED - nothing written:", *errors[:15], sep="\n  ")
        sys.exit(1)


def parse_population(pages):
    make_year = defaultdict(int)
    make_fuel_year = defaultdict(int)
    sums = defaultdict(int)
    totals = {}
    errors = []
    sections = set()

    for lines in pages:
        text = " ".join(line["text"] for line in lines).upper()
        if "POPULATION BY MAKE" not in text:
            continue
        if "BUS POPULATION BY MAKE" in text:
            vehicle = "bus"
        elif "GOODS VEHICLE" in text:
            vehicle = "goods"
        else:
            continue
        header = next(
            (
                line
                for line in lines
                if "End" in line["text"]
                and "Period" in line["text"]
                and years_on(line)
            ),
            None,
        )
        if header is None:
            continue
        has_fuel = "Fuel Type" in header["text"]
        years = years_on(header)
        anchors = [w["x1"] for w in header["words"] if YEAR.fullmatch(w["text"])]
        if len(anchors) != len(years):
            errors.append(f"{vehicle}: year header does not match columns")
            continue
        section = (vehicle, tuple(years), has_fuel)
        sections.add(section)
        for line in lines:
            if line["top"] <= header["top"] + 2:
                continue
            cells, _, labels = row_values(line, anchors)
            if not labels or not cells:
                continue
            if labels[0].upper() == "TOTAL":
                totals[section] = {
                    year: cells.get(i, 0) for i, year in enumerate(years)
                }
                continue
            if has_fuel:
                make, fuel = make_and_fuel(labels)
                if make is None:
                    errors.append(
                        f"unrecognized population row: {' '.join(labels)}"
                    )
                    continue
            else:
                make, fuel = " ".join(labels).strip(), ""
                if not make:
                    continue
            for i, year in enumerate(years):
                value = cells.get(i, 0)
                if has_fuel:
                    make_fuel_year[(vehicle, year, make, fuel)] += value
                else:
                    make_year[(vehicle, year, make)] += value
                sums[(section, year)] += value

    for section in sections:
        if section not in totals:
            errors.append(f"{section[0]} population table has no TOTAL row")
            continue
        for year in section[1]:
            actual = sums[(section, year)]
            expected = totals[section][year]
            if actual != expected:
                errors.append(
                    f"{section[0]} population {year}: rows add to {actual}, "
                    f"PDF TOTAL says {expected}"
                )
    if not sections or not make_year or not make_fuel_year:
        errors.append("population make and propellant tables were not recognized")

    report_errors(errors)
    detailed_by_make = defaultdict(int)
    detail_years = defaultdict(set)
    for (vehicle, year, make, _fuel), value in make_fuel_year.items():
        detailed_by_make[(vehicle, year, make)] += value
        detail_years[vehicle].add(year)
    make_only_keys = set(make_year)
    detail_keys = set(detailed_by_make)
    for vehicle, year, make in make_only_keys | detail_keys:
        if year not in detail_years[vehicle] or make == "OTHERS":
            continue
        detail_value = detailed_by_make[(vehicle, year, make)]
        make_only_value = make_year[(vehicle, year, make)]
        if detail_value != make_only_value:
            errors.append(
                f"{vehicle} {make} {year}: propellant rows add to "
                f"{detail_value}, make-only table says {make_only_value}"
            )
    report_errors(errors)

    combined = defaultdict(int)
    for (vehicle, year, make, fuel), value in make_fuel_year.items():
        combined[(year, make, fuel)] += value
    records = [
        {"y": year, "make": make, "fuel": fuel, "u": value}
        for (year, make, fuel), value in sorted(combined.items())
        if value
    ]
    historical = defaultdict(int)
    for (vehicle, year, make), value in make_year.items():
        if year not in detail_years[vehicle] and value:
            historical[(year, make)] += value
    records.extend(
        {"y": year, "make": make, "fuel": "", "u": value}
        for (year, make), value in sorted(historical.items())
    )
    return sorted(records, key=lambda row: (row["y"], row["make"], row["fuel"]))


def parse_annual(pages):
    make_year = defaultdict(int)
    sums = defaultdict(int)
    totals = {}
    errors = []
    sections = set()

    for lines in pages:
        text = " ".join(line["text"] for line in lines).upper()
        if (
            "NEW REGISTRATION OF GOODS VEHICLES AND BUSES" not in text
            or "PERIOD (YEAR)" not in text
        ):
            continue
        period = next(
            (
                line
                for line in lines
                if "Period" in line["text"] and "Year" in line["text"] and years_on(line)
            ),
            None,
        )
        header = next(
            (
                line
                for line in lines
                if "Make/" in line["text"] and all(body in line["text"] for body in BODY)
            ),
            None,
        )
        if period is None or header is None:
            continue
        years = years_on(period)
        anchors = category_anchors(header, len(years) * len(BODY))
        if anchors is None:
            errors.append(f"annual registration {years}: category columns do not match years")
            continue
        section = tuple(years)
        sections.add(section)
        for line in lines:
            if line["top"] <= header["top"] + 2:
                continue
            cells, _, labels = row_values(line, anchors)
            if not labels or not cells:
                continue
            if labels[0].upper() == "TOTAL":
                totals[section] = {
                    (year, col): cells.get(i * len(BODY) + col, 0)
                    for i, year in enumerate(years)
                    for col in range(len(BODY))
                }
                continue
            make, fuel = make_and_fuel(labels)
            if make is None:
                errors.append(f"unrecognized annual registration row: {' '.join(labels)}")
                continue
            for i, year in enumerate(years):
                offset = i * len(BODY)
                body_sum = sum(cells.get(offset + j, 0) for j in range(len(BODY) - 1))
                row_total = cells.get(offset + len(BODY) - 1, 0)
                if body_sum != row_total:
                    errors.append(
                        f"{year} {make}: vehicle types add to {body_sum}, "
                        f"row Total says {row_total}"
                    )
                sums[(section, year, len(BODY) - 1)] += row_total
                for col in range(len(BODY) - 1):
                    sums[(section, year, col)] += cells.get(offset + col, 0)
                make_year[(year, make, fuel)] += row_total

    for section in sections:
        if section not in totals:
            errors.append(f"annual registration table {section} has no TOTAL row")
            continue
        for year in section:
            for col in range(len(BODY)):
                actual = sums[(section, year, col)]
                expected = totals[section][(year, col)]
                if actual != expected:
                    errors.append(
                        f"annual registration {year} {BODY[col]}: rows add to {actual}, "
                        f"PDF TOTAL says {expected}"
                    )
    if not sections or not make_year:
        errors.append("no annual commercial registration tables recognized")

    report_errors(errors)
    return [
        {"y": year, "make": make, "fuel": fuel, "u": value}
        for (year, make, fuel), value in sorted(make_year.items())
        if value
    ]


def parse_monthly(pages):
    by_make_month = defaultdict(int)
    section_rows = defaultdict(lambda: defaultdict(int))
    section_totals = {}
    errors = []
    sections = set()

    for lines in pages:
        text = " ".join(line["text"] for line in lines).upper()
        if "NEW REGISTRATION OF GOODS VEHICLES AND BUSES BY MAKE IN" not in text:
            continue
        period = next(
            (
                line
                for line in lines
                if "Period" in line["text"]
                and "Month" in line["text"]
                and any(MONTH.fullmatch(w["text"]) for w in line["words"])
            ),
            None,
        )
        header = next(
            (
                line
                for line in lines
                if "Make/" in line["text"] and all(body in line["text"] for body in BODY)
            ),
            None,
        )
        if period is None or header is None:
            continue
        months = tuple(
            w["text"] for w in period["words"] if MONTH.fullmatch(w["text"])
        )
        anchors = category_anchors(header, len(months) * len(BODY))
        if not months or anchors is None:
            errors.append("monthly registration header does not match its month columns")
            continue
        section = months
        sections.add(section)
        for line in lines:
            if line["top"] <= header["top"] + 2:
                continue
            cells, period_total, labels = row_values(
                line, anchors, has_period_total=True
            )
            if not labels or not cells:
                continue
            if labels[0].upper() == "TOTAL":
                section_totals[section] = {
                    month: cells.get(i * len(BODY) + len(BODY) - 1, 0)
                    for i, month in enumerate(months)
                }
                if period_total is not None and period_total != sum(
                    section_totals[section].values()
                ):
                    errors.append(
                        f"monthly table {section}: period total {period_total} "
                        f"does not equal monthly totals"
                    )
                continue
            make, fuel = make_and_fuel(labels)
            if make is None:
                errors.append(f"unrecognized monthly registration row: {' '.join(labels)}")
                continue
            row_period_total = 0
            for i, month in enumerate(months):
                offset = i * len(BODY)
                body_sum = sum(cells.get(offset + j, 0) for j in range(len(BODY) - 1))
                row_total = cells.get(offset + len(BODY) - 1, 0)
                if body_sum != row_total:
                    errors.append(
                        f"{month} {make}: vehicle types add to {body_sum}, "
                        f"row Total says {row_total}"
                    )
                row_period_total += row_total
                section_rows[section][month] += row_total
                by_make_month[(month, make, fuel)] += row_total
            if period_total is not None and period_total != row_period_total:
                errors.append(
                    f"{make} {section}: period total {period_total} "
                    f"does not equal monthly sum {row_period_total}"
                )

    for section in sections:
        if section not in section_totals:
            errors.append(f"monthly registration table {section} has no TOTAL row")
            continue
        for month in section:
            actual = section_rows[section][month]
            expected = section_totals[section][month]
            if actual != expected:
                errors.append(
                    f"monthly registration {month}: rows add to {actual}, "
                    f"PDF TOTAL says {expected}"
                )
    if not sections or not by_make_month:
        errors.append("no monthly commercial registration tables recognized")

    report_errors(errors)
    return [
        {"m": month, "make": make, "fuel": fuel, "u": value}
        for (month, make, fuel), value in sorted(by_make_month.items())
        if value
    ]


def save(kind, period_key, records):
    dataset = (
        json.loads(DATA.read_text(encoding="utf-8"))
        if DATA.exists()
        else {"population": [], "annual": [], "monthly": []}
    )
    old = dataset.get(kind, [])
    periods = {row[period_key] for row in records}
    dataset[kind] = sorted(
        [
            row for row in old if row[period_key] not in periods
        ] + records,
        key=lambda row: (row[period_key], row["make"], row.get("fuel", "")),
    )
    DATA.parent.mkdir(parents=True, exist_ok=True)
    DATA.write_text(json.dumps(dataset, separators=(",", ":")), encoding="utf-8")
    print(f"{kind}: updated {len(records)} make/propellant rows for {sorted(periods)} | ALL CHECKS PASSED")


def main():
    if len(sys.argv) != 2:
        sys.exit("Usage: python scripts/parse_commercial_pdf.py file.pdf")
    src = Path(sys.argv[1])
    pages = read_pages(src)
    full_text = " ".join(line["text"] for page in pages for line in page).upper()
    if "NEW REGISTRATION OF GOODS VEHICLES AND BUSES BY MAKE IN" in full_text:
        save("monthly", "m", parse_monthly(pages))
    elif "TOTAL ANNUAL NEW REGISTRATION OF GOODS VEHICLES AND BUSES" in full_text:
        save("annual", "y", parse_annual(pages))
    elif "POPULATION BY MAKE" in full_text:
        save("population", "y", parse_population(pages))
    else:
        sys.exit("CHECK FAILED - unrecognized commercial-vehicle report")


if __name__ == "__main__":
    main()
