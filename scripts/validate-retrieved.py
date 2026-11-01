"""Independent review of the new Britannia transcript, never model-calculated EBITDA."""
import json
from urllib.request import urlopen
base='http://127.0.0.1:5173/api/'
data=json.load(urlopen(base+'companies/BRITANNIA.NS/overview'))
expected=[('Revenue','Q4 FY2026',4686),('PBT','Q4 FY2026',785),('PAT','Q4 FY2026',678),('PBT','FY2026',3289),('PAT','FY2026',2533)]
for name,period,value in expected:
 row=next(m for m in data['metrics'] if m['name']==name and m['period']==period and m['basis']=='consolidated, reported')
 assert row['value']==value,(name,period,row['value'],value)
 doc=json.load(urlopen(base+'documents/'+row['document_id']))
 page=next(p['text'] for p in doc['pages'] if p['page']==row['page'])
 assert str(value) in page.replace(',','')
 assert 'consolidated results' in page.lower() and 'full year on a consolidated basis' in page.lower()
assert not any(m['name']=='EBITDA' for m in data['metrics']), 'Operating profit alone does not establish EBITDA'
print('Independently verified 5 Britannia quarter/year source values on original PDF page 7; operating profit was not relabelled EBITDA.')
