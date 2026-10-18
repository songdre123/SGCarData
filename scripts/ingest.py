"""Process every PDF in incoming/: detect its type by content, parse + validate it, then move it to archive/.
Usage: python scripts/ingest.py        (exit code 1 if any PDF fails its checks; failed PDFs stay in incoming/)
With no PDFs present it just rebuilds site/data/registrations.json (use after editing lookups.json).
"""
import shutil, subprocess, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import store

ROOT = Path(__file__).resolve().parent.parent
INCOMING, ARCHIVE = ROOT / "incoming", ROOT / "archive"
ARCHIVE.mkdir(exist_ok=True)
failed = 0
for pdf in sorted(INCOMING.glob("*.pdf")):
    head = subprocess.run(["pdftotext", "-l", "1", str(pdf), "-"], capture_output=True, text=True).stdout.upper()
    if "NEW REGISTRATION OF CARS BY MAKE" in head:
        script = "parse_regn_pdf.py"
    elif "COST (S$) FOR CARS REGISTERED" in head:
        script = "parse_cost_pdf.py"
    else:
        print(f"SKIPPED {pdf.name}: not a recognised LTA PDF"); failed += 1; continue
    print(f"--- {pdf.name} -> {script}")
    if subprocess.run([sys.executable, str(ROOT / "scripts" / script), str(pdf)]).returncode == 0:
        shutil.move(str(pdf), ARCHIVE / pdf.name)
    else:
        print(f"FAILED {pdf.name}: left in incoming/"); failed += 1
if not failed and any(store.REGN.glob("20??-??.json")):
    store.rebuild()          # always rebuild, so edits to lookups.json also take effect
sys.exit(1 if failed else 0)
