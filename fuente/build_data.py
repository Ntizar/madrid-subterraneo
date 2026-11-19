import json,math,re,collections,datetime
from pathlib import Path
R=Path(__file__).parent
ss=json.load(open(R/'reference/crtm-0.geojson'))['features'];ts=json.load(open(R/'reference/crtm-4.geojson'))['features']
def distance(a,b):return math.hypot((a[0]-b[0])*85000,(a[1]-b[1])*111320)
def title(s):return s.title().replace(' De ',' de ').replace(' Del ',' del ').replace(' La ',' la ').replace(' Los ',' los ').replace(' Las ',' las ').replace('El Casar','El Casar')
groups={}; raw_to_group={}
for f in ss:
 p=f['properties'];n=p.get('DENOMINACION');lines=[a.strip() for a in (p.get('LINEAS') or '').split(',') if a.strip()]
 if not n or not lines:continue
 key='s'+str(p.get('CODIGOCTMESTACIONREDMETRO') or p['CODIGOESTACION'])
 g=groups.setdefault(key,{'id':key,'names':[],'raw':[],'lines':[],'coords':[],'zones':[]})
 if n not in g['names']:g['names'].append(n)
 g['raw'].append(p['CODIGOESTACION']);g['coords'].append(f['geometry']['coordinates']);g['lines']=sorted(set(g['lines']+lines),key=lambda a:int(a) if a.isdigit() else 20)
 if p['CORONATARIFARIA'] and p['CORONATARIFARIA'] not in g['zones']:g['zones'].append(p['CORONATARIFARIA'])
 raw_to_group[p['CODIGOESTACION']]=key
for g in groups.values():
 g['name']=' / '.join(title(n) for n in g.pop('names'));g['lon']=sum(c[0] for c in g['coords'])/len(g['coords']);g['lat']=sum(c[1] for c in g['coords'])/len(g['coords'])
# Explicit official interchange inconsistencies are retained, not guessed.
edges={};bad=[]
for f in ts:
 p=f['properties'];geom=f['geometry'];branch=str(p['NUMEROLINEAUSUARIO']);line=re.match(r'\d+|R',branch,re.I).group().upper()
 if not geom:continue
 coords=geom['coordinates'] if geom['type']=='LineString' else sum(geom['coordinates'],[])
 dest=raw_to_group.get(p['CODIGOESTACION'])
 if not dest:bad.append([p['IDTRAMO'],'no-dest']);continue
 # Segment endpoints identify previous station; restrict to the same published line.
 candidates=[g for g in groups.values() if line in g['lines'] and g['id']!=dest]
 ends=[(min(distance(c,coords[0]) for c in groups[dest]['coords']),coords[-1]),(min(distance(c,coords[-1]) for c in groups[dest]['coords']),coords[0])]
 _,other=min(ends,key=lambda x:x[0]);src=min(candidates,key=lambda g:min(distance(c,other) for c in g['coords']))
 d=min(distance(c,other) for c in src['coords'])
 if d>600:bad.append([p['IDTRAMO'],round(d),src['name'],groups[dest]['name']]);continue
 a,b=sorted([src['id'],dest]);k=(a,b,line)
 if k not in edges:edges[k]={'a':src['id'],'b':dest,'line':line,'branch':branch,'coords':[[round(c[0],6),round(c[1],6)] for c in coords],'length':round(p.get('LONGITUDTRAMOANTERIOR') or p.get('Shape__Length') or 0),'endpoint_offset_m':round(d)}
# Dedup groups via CODIGOCTMESTACIONREDMETRO when the official raw identifier binds them.
for g in groups.values():g.pop('coords')
colors=['#2dbef0','#ed1c24','#d5a900','#b65518','#74b900','#777b83','#ee7518','#df65a0','#a60084','#005aa9','#009b3a','#a49800','#334155']
lines=[{'id':str(i) if i<13 else 'R','color':colors[i-1],'name':f'Línea {i}' if i<13 else 'Ramal'} for i in range(1,14)]
used=set(v for e in edges.values() for v in [e['a'],e['b']]);stations=[g for g in groups.values() if g['id'] in used]
obj={'meta':{'source':'CRTM · Servicios geográficos M4_Red','retrieved':'2026-11-18','source_date':'20260529','note':'Copia geográfica consultada el 18/11/2026. No indica incidencias, horarios ni servicio en tiempo real.','license':'https://www.crtm.es/licencia-de-uso','source_url':'https://services5.arcgis.com/UxADft6QPcvFyDU1/arcgis/rest/services/M4_Red/FeatureServer'},'lines':lines,'stations':stations,'edges':list(edges.values())}
(R/'public/data/network.json').write_text(json.dumps(obj,ensure_ascii=False,separators=(',',':')))
print('STATIONS',len(stations),'EDGES',len(edges),'BAD',bad)
print('L3',[(groups[e['a']]['name'],groups[e['b']]['name']) for e in edges.values() if e['line']=='3'])
