"""Process every PDF and COE CSV in incoming/: detect its type by content, parse + validate it, then move it to archive/.
Usage: python scripts/ingest.py        (exit code 1 if any PDF fails its checks; failed PDFs stay in incoming/)
With no PDFs present it just rebuilds site/data/registrations.json (use after editing lookups.json).
"""
import shutil, subprocess, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import store, cost_history, popmodel, sanity

ROOT = Path(__file__).resolve().parent.parent
INCOMING, ARCHIVE = ROOT / "incoming", ROOT / "archive"
ARCHIVE.mkdir(exist_ok=True)
failed = 0
for pdf in sorted(list(INCOMING.glob("*.pdf")) + list(INCOMING.glob("*.csv"))):
    if pdf.suffix.lower() == ".csv":
        head = pdf.read_text(encoding="utf-8-sig", errors="ignore")[:400].upper()
    else:
        head = subprocess.run(["pdftotext", "-l", "1", str(pdf), "-"], capture_output=True, text=True).stdout.upper()
    if "QUOTA PREMIUM" in head and "BIDDING EXERCISE" in head:
        script = "parse_coe_csv.py"
    elif "ANNUAL NEW REGISTRATION OF CARS" in head:
        script = "parse_newreg_pdf.py"
    elif "NEW REGISTRATION OF CARS BY MAKE" in head:
        script = "parse_regn_pdf.py"
    elif "COST (S$) FOR CARS REGISTERED" in head:
        script = "parse_cost_pdf.py"
    elif "TOTAL CAR POPULATION BY MAKE" in head or "EFFECTIVE TRANSFER OF CAR OWNERSHIP BY MAKE" in head:
        script = "parse_stats_pdf.py"
    else:
        print(f"SKIPPED {pdf.name}: not a recognised LTA file"); failed += 1; continue
    print(f"--- {pdf.name} -> {script}")
    if subprocess.run([sys.executable, str(ROOT / "scripts" / script), str(pdf)]).returncode == 0:
        shutil.move(str(pdf), ARCHIVE / pdf.name)
    else:
        print(f"FAILED {pdf.name}: left in incoming/"); failed += 1
if not failed and any(store.REGN.glob("20??-??.json")):
    store.rebuild()          # always rebuild, so edits to lookups.json also take effect
    cost_history.rebuild()   # ...and edits to cost_aliases.json
    popmodel.rebuild()       # population history, implied deregistrations and the current estimate
    sanity.run()
sys.exit(1 if failed else 0)
