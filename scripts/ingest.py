"""Retrieve public sources without bypassing access controls; keep a provenance manifest.

Run with the bundled Python (pypdf/httpx), or pip install httpx pypdf.
Blocked sources remain explicit failures. No synthetic observations are generated.
"""
import argparse
import csv
import hashlib
import io
import json
import time
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".python-libs"))
import httpx
SOURCES = [
    ("infy-results", "INFY.NS", "results", "FY2025", "2025-04-17", "https://www.infosys.com/investors/reports-filings/quarterly-results/2024-2025/q4/documents/ifrs-inr-press-release.pdf"),
    ("infy-results-q3", "INFY.NS", "results", "Q3 FY2025", "2025-01-16", "https://www.infosys.com/investors/reports-filings/quarterly-results/2024-2025/q3/documents/ifrs-inr-press-release.pdf"),
    ("infy-call-q3", "INFY.NS", "transcript", "Q3 FY2025", "2025-01-16", "https://www.infosys.com/investors/reports-filings/quarterly-results/2024-2025/q3/documents/transcripts/earningscall.pdf"),
    ("infy-call-q4", "INFY.NS", "transcript", "Q4 FY2025", "2025-04-17", "https://www.infosys.com/investors/reports-filings/quarterly-results/2024-2025/q4/documents/transcripts/earningscall.pdf"),
    ("hcl-results", "HCLTECH.NS", "results", "FY2025", "2025-04-22", "https://www.hcltech.com/sites/default/files/document/open/quarter-results/2025-05/HCLTech_Q4_FY25_Investor_Release.pdf"),
    ("hcl-call", "HCLTECH.NS", "transcript", "Q4 FY2025", "2025-04-22", "https://www.hcltech.com/sites/default/files/document/open/quarter-results/2025-04/HCLTech-Earnings-Q4FY25-Transcript.pdf"),
    ("infy-annual", "INFY.NS", "annual_report", "FY2025", "2025-06-02", "https://www.infosys.com/investors/reports-filings/annual-report/annual/documents/infosys-ar-25.pdf"),
    ("asian-results", "ASIANPAINT.NS", "results", "FY2025", "2025-05-08", "https://www.asianpaints.com/content/dam/asianpaints/website/secondary-navigation/investors/announcements-pdfs/2025-2026/SEINTIMATIONFE08052025.pdf"),
    ("asian-call", "ASIANPAINT.NS", "transcript", "Q4 FY2025", "2025-05-08", "https://www.asianpaints.com/content/dam/asianpaints/website/secondary-navigation/investors/announcements-pdfs/2025-2026/SEINTIMATIONTRANSCRIPT080525.pdf"),
    ("persistent-annual", "PERSISTENT.NS", "annual_report", "FY2025", "2025-06-20", "https://www.persistent.com/wp-content/uploads/2025/06/persistent-annual-report-2025.pdf"),
    ("dmart-results", "DMART.NS", "results", "FY2025", "2025-05-03", "https://nsearchives.nseindia.com/corporate/DMART_03052025170236_ASLPressrelease03052025.pdf"),
]
TICKERS = "RELIANCE TCS INFY HCLTECH HDFCBANK ICICIBANK SBIN ONGC NTPC MARUTI M&M ITC HINDUNILVR SUNPHARMA DRREDDY BHARTIARTL LT TITAN".split()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--market-only", action="store_true")
    parser.add_argument("--documents-only", action="store_true")
    parser.add_argument("--ticker", help="Fetch one ticker instead of the portfolio")
    parser.add_argument("--live", action="store_true", help="Fetch last 3 months rather than demo historical window")
    args = parser.parse_args()
    target = ROOT / "data" / "sources"
    target.mkdir(parents=True, exist_ok=True)
    manifest = []
    with httpx.Client(timeout=35, follow_redirects=False, headers={"User-Agent": "FINN-prototype/1.0 public-financial-research"}) as client:
        if not args.market_only:
            from pypdf import PdfReader
            for doc_id, ticker, kind, period, published, url in SOURCES:
                entry = dict(id=doc_id, ticker=ticker, type=kind, period=period, published_at=published, url=url, retrieved_at=datetime.now(timezone.utc).isoformat())
                try:
                    dest = target / f"{doc_id}.pdf"
                    if dest.exists():
                        entry['retrieved_at'] = datetime.fromtimestamp(dest.stat().st_mtime, timezone.utc).isoformat()
                    content = dest.read_bytes() if dest.exists() else client.get(url).raise_for_status().content
                    if not content.startswith(b"%PDF"):
                        raise ValueError("Source did not return a PDF")
                    dest.write_bytes(content)
                    pages = [dict(page=i+1, text=p.extract_text() or "") for i,p in enumerate(PdfReader(io.BytesIO(content)).pages)]
                    entry.update(status="ok", sha256=hashlib.sha256(content).hexdigest(), pages=pages)
                    print(doc_id, "ok", len(pages), "pages", flush=True)
                except Exception as error:
                    entry.update(status="unavailable", error=str(error)[:300])
                    print(doc_id, "unavailable", str(error)[:100], flush=True)
                manifest.append(entry)
                time.sleep(1)
            (ROOT / "data" / "source-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        if args.documents_only:
            return
        prices = {}
        for symbol in ([args.ticker.upper().removesuffix(".NS")] if args.ticker else TICKERS):
            ticker = symbol + ".NS"
            query = "range=3mo&interval=1d" if args.live else "period1=1740787200&period2=1745366400&interval=1d"
            url = f"https://query1.finance.yahoo.com/v8/finance/chart/{quote(ticker)}?{query}"
            try:
                r = client.get(url)
                r.raise_for_status()
                data = r.json()["chart"]["result"][0]
                raw = data["indicators"]["quote"][0]
                adjusted = data["indicators"].get("adjclose", [{}])[0].get("adjclose", raw["close"])
                points = [dict(date=datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d"), close=raw["close"][i], adjusted_close=adjusted[i], volume=raw["volume"][i]) for i,t in enumerate(data["timestamp"]) if raw["close"][i] is not None and adjusted[i] is not None and raw["volume"][i] is not None]
                prices[ticker] = dict(name=data["meta"].get("longName", symbol), source="Yahoo Finance", url=url, retrieved_at=datetime.now(timezone.utc).isoformat(), currency=data["meta"].get("currency"), exchange=data["meta"].get("exchangeName"), points=points)
                print(ticker, len(points), "daily observations", flush=True)
            except Exception as error:
                print(ticker, "unavailable", str(error)[:120], flush=True)
            time.sleep(.4)
        (ROOT / "data" / ("market-live.json" if args.live else "market.json")).write_text(json.dumps(prices, indent=2), encoding="utf-8")

if __name__ == "__main__":
    main()
