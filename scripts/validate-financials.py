"""Independent Python audit of deterministic calculations on the real snapshot."""
import json
import math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
seed=json.loads((ROOT/'data/seed.json').read_text(encoding='utf-8'))
def growth(current,base):
    if current is None or base is None or base<=0 or not all(math.isfinite(v) for v in [current,base]):
        return None
    return (current-base)/base*100
def relative_volume(points,n):
    if len(points)<n+1:
        return None
    average=sum(p['volume'] for p in points[-n-1:-1])/n
    return points[-1]['volume']/average if average>0 else None
assert growth(1,0) is None and growth(1,-1) is None
audit={'market':{},'quarters':{},'guidance':[]}
for ticker,market in seed['market'].items():
    points=sorted(market['points'],key=lambda p:p['date'])
    audit['market'][ticker]={'date':points[-1]['date'],'change_pct':growth(points[-1]['adjusted_close'],points[-2]['adjusted_close']),'relative_volume_20':relative_volume(points,20),'source_url':market['url']}
for ticker in ['INFY.NS','HCLTECH.NS']:
    rows=[m for m in seed['metrics'] if m['ticker']==ticker]
    audit['quarters'][ticker]={}
    for name in ['Revenue','EBITDA','PBT','PAT']:
        values={m['period']:m for m in rows if m['name']==name}
        current=values.get('Q4 FY2025',{}).get('value')
        previous=values.get('Q3 FY2025',{}).get('value')
        year_ago=values.get('Q4 FY2024',{}).get('value')
        audit['quarters'][ticker][name]={'qoq_pct':growth(current,previous),'yoy_pct':growth(current,year_ago),'unit':'INR crore','basis':values.get('Q4 FY2025',{}).get('basis')}
for g in seed['guidance']:
    assert g['period']==g['actual_period'] and g['basis']==g['actual_basis']
    delta=g['actual']-g['low'] if g['actual']<g['low'] else g['actual']-g['high'] if g['actual']>g['high'] else 0
    audit['guidance'].append({'ticker':g['ticker'],'metric':g['metric'],'variance_pp':delta,'guidance_source':g['guidance_document'],'actual_source':g['actual_document']})
assert math.isclose(audit['guidance'][0]['variance_pp'],-.3)
assert math.isclose(audit['market']['SBIN.NS']['relative_volume_20'],2.254896466098207,rel_tol=.01)
(ROOT/'data/calculation-audit.json').write_text(json.dumps(audit,indent=2),encoding='utf-8')
print(f"Python independently verified {len(audit['market'])} market summaries and {sum(len(v) for v in audit['quarters'].values())} quarterly metric comparisons.")
