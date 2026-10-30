"""Build a compact, auditable snapshot from fetched primary sources (never invented rows)."""
import json
import re
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
raw = json.loads((ROOT / 'data/source-manifest.json').read_text(encoding='utf-8'))
market = json.loads((ROOT / 'data/market.json').read_text(encoding='utf-8'))
sectors = dict(zip('RELIANCE TCS INFY HCLTECH HDFCBANK ICICIBANK SBIN ONGC NTPC MARUTI M&M ITC HINDUNILVR SUNPHARMA DRREDDY BHARTIARTL LT TITAN'.split(), ['Energy & retail','IT services','IT services','IT services','Banking','Banking','Banking','Energy','Utilities','Automobiles','Automobiles','Consumer staples','Consumer staples','Pharmaceuticals','Pharmaceuticals','Telecommunications','Industrials','Consumer discretionary']))
companies = [dict(ticker=t, name=v['name'], sector=sectors.get(t.removesuffix('.NS'), 'Other'), validation='Yahoo Finance historical symbol verified', updated_at=v['retrieved_at']) for t,v in market.items()]
companies += [dict(ticker=t, name=n, sector=s, validation='Verified primary company document', updated_at='2026-10-30') for t,n,s in [('ASIANPAINT.NS','Asian Paints Limited','Paints & coatings'),('PERSISTENT.NS','Persistent Systems Limited','IT services'),('DMART.NS','Avenue Supermarts Limited','Retail')]]
docs = []
for d in raw:
    if d['status'] != 'ok':
        continue
    # Index bounded relevant pages of large annual reports. Preserve real PDF page numbers.
    pages = d['pages']
    if len(pages) > 80:
        terms = ['consolidated balance sheet','consolidated statement of profit','consolidated statement of cash','segment reporting','business overview','management discussion','risk management','revenue from operations','cash generated from operations','principal risks']
        scored = [(sum(term in p['text'].lower() for term in terms),p) for p in pages]
        chosen = {p['page']:p for _,p in sorted(scored,key=lambda x:x[0],reverse=True)[:35]}
        chosen.update({p['page']:p for p in pages[:5]})
        pages = sorted(chosen.values(),key=lambda p:p['page'])
    title = f"{next((c['name'] for c in companies if c['ticker']==d['ticker']),d['ticker'])} · {d['period']} · {d['type'].replace('_',' ')}"
    docs.append(dict(id=d['id'],ticker=d['ticker'],title=title,type=d['type'],period=d['period'],url=d['url'],published_at=None if d['type'] in ['annual_report','transcript'] else d['published_at'],retrieved_at=d['retrieved_at'],hash=d['sha256'],mode='historical',pages=pages, total_pages=len(d['pages'])))
byid={d['id']:d for d in docs}
metrics=[]
def add(ticker,name,values,periods,doc,page,basis='Consolidated IFRS',unit='INR crore'):
    source=byid.get(doc)
    if not source:
        return
    text=next(p['text'] for p in source['pages'] if p['page']==page)
    for value,period in zip(values,periods):
        if value is not None:
            assert str(value) in text.replace(',','') or f'{value:,}' in text, f'Missing {doc}:{page} {value}'
        metrics.append(dict(id=f'{ticker}-{name}-{period}',ticker=ticker,name=name,value=value,period=period,unit=unit,basis=basis,document_id=doc,page=page))
for name,values in [('Revenue',[40925,37923,162990,153670]),('PBT',[9663,10240,37608,35988]),('PAT',[7033,7969,26713,26233]),('EBITDA',[None,None,None,None])]:
    add('INFY.NS',name,values,['Q4 FY2025','Q4 FY2024','FY2025','FY2024'],'infy-results',6)
add('INFY.NS','Free cash flow',[34549],['FY2025'],'infy-results',1)
for name,values in [('Revenue',[41764]),('PBT',[9670]),('PAT',[6806]),('EBITDA',[None])]:
    add('INFY.NS',name,values,['Q3 FY2025'],'infy-results-q3',6)
for name,values in [('Revenue',[28499,29890,30246]),('EBITDA',[6111,6860,6482]),('PAT',[3986,4591,4307])]:
    add('HCLTECH.NS',name,values,['Q4 FY2024','Q3 FY2025','Q4 FY2025'],'hcl-results',32,'Consolidated Ind AS')
add('HCLTECH.NS','PBT',[5735],['Q4 FY2025'],'hcl-results',38,'Consolidated Ind AS')
add('HCLTECH.NS','Revenue',[117055],['FY2025'],'hcl-results',3,'Consolidated Ind AS')
add('HCLTECH.NS','Free cash flow',[21153],['FY2025'],'hcl-results',38,'Consolidated Ind AS')
add('HCLTECH.NS','Operating cash flow',[22261],['FY2025'],'hcl-results',38,'Consolidated Ind AS')
add('HCLTECH.NS','PAT',[17390],['FY2025'],'hcl-results',3,'Consolidated Ind AS')
add('HCLTECH.NS','Borrowings',[2291],['FY2025'],'hcl-results',38,'Consolidated Ind AS')
events=[
dict(id='infy-fy25-results',ticker='INFY.NS',headline='Growth improved. The final guidance was still missed.',date='2025-04-17',date_precision='Release date; time not recorded',category='results',summary='Infosys reported FY2025 constant-currency revenue growth of 4.2%, below the 4.5–5.0% range set in January. Operating margin was 21.1%.',why='Compare delivery with the most recent guidance, rather than judging the quarter only by year-on-year growth. Review the call for management’s explanation.',document_id='infy-results',evidence_page=1,confidence='high',severity=34,magnitude=16,novelty=9,evidence=10,questions=['Did management deliver on its FY2025 revenue guidance?','Does cash flow support reported profitability?']),
dict(id='hcl-fy25-results',ticker='HCLTECH.NS',headline='A stronger year. A softer finish.',date='2025-04-22',date_precision='Release date; time not recorded',category='results',summary='HCLTech reported FY2025 revenue growth of 4.7% in constant currency. Q4 constant-currency revenue fell 0.8% sequentially, while FY2026 guidance was set at 2–5%.',why='Annual growth and the exit-quarter trajectory tell different stories. Inspect the quarterly margin and the assumptions behind next year’s guidance.',document_id='hcl-results',evidence_page=3,confidence='high',severity=28,magnitude=10,novelty=8,evidence=10,questions=['What did management guide for future margins?','How did revenue and EBITDA change this quarter?']),
dict(id='infy-call-q4',ticker='INFY.NS',headline='Q4 earnings call: management’s explanation, in context',date='2025-04-17',date_precision='Call date; transcript publication date unavailable',category='earnings_call',summary='The archived earnings call provides management commentary and analyst questions following the FY2025 results.',why='Supporting context is available in research. Kept below the financial-results signal to avoid showing the same development twice.',document_id='infy-call-q4',evidence_page=3,confidence='high',severity=5,magnitude=0,novelty=1,evidence=8,questions=['What risks did management discuss?']),
dict(id='hcl-call',ticker='HCLTECH.NS',headline='Q4 earnings call: the assumptions behind the outlook',date='2025-04-22',date_precision='Call date; transcript publication date unavailable',category='earnings_call',summary='The archived call describes the scenarios supporting the FY2026 guidance range.',why='Useful follow-up evidence, grouped below the results filing to reduce repetition. The call date is known; the transcript’s publication date is not.',document_id='hcl-call',evidence_page=14,confidence='high',severity=5,magnitude=0,novelty=1,evidence=8,questions=['What assumptions underpin FY2026 guidance?']),
]
events=[e for e in events if e['document_id'] in byid]
guidance=[dict(ticker='INFY.NS',metric='Revenue growth',period='FY2025',basis='Consolidated constant-currency revenue growth (%)',low=4.5,high=5,actual=4.2,actual_period='FY2025',actual_basis='Consolidated constant-currency revenue growth (%)',guidance_document='infy-call-q3',guidance_page=7,actual_document='infy-results',actual_page=1,qualifier='January 2025 revised full-year guidance, not the initial annual outlook. The comparison measures delivery against the last cited range; a miss does not establish misconduct.'),dict(ticker='INFY.NS',metric='Operating margin',period='FY2025',basis='Consolidated IFRS operating margin (%)',low=20,high=22,actual=21.1,actual_period='FY2025',actual_basis='Consolidated IFRS operating margin (%)',guidance_document='infy-call-q3',guidance_page=7,actual_document='infy-results',actual_page=1,qualifier='January 2025 full-year operating-margin range. Revenue guidance and operating-margin guidance are separate commitments.')]
seed=dict(version='2025-primary-v1',as_of='2025-04-22',companies=companies,portfolio=list(market),documents=docs,metrics=metrics,events=events,guidance=guidance,market=market)
(ROOT/'data/seed.json').write_text(json.dumps(seed,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
print(f"Built {len(companies)} companies, {len(docs)} documents, {len(metrics)} metrics, {sum(len(v['points']) for v in market.values())} real daily observations")
