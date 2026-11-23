import xml.etree.ElementTree as E,pathlib,json,collections,hashlib,argparse
parser=argparse.ArgumentParser(description='独立对照公开源 MusicXML 与仓库示例的持续发声音高区间；不调用谱线导入器')
parser.add_argument('source_dir',type=pathlib.Path,help='已下载并解压的 <id>.xml / <id>.mxl 目录')
parser.add_argument('--output',type=pathlib.Path,required=True)
args=parser.parse_args()
repo=pathlib.Path(__file__).resolve().parent.parent

def digest(events):
 # Canonical sounding occupancy: union adjacent intervals for each pitch; rests are checked via end.
 ps=collections.defaultdict(list)
 for a,b,p in events:ps[p].append((a,b))
 out=[]
 for p,spans in sorted(ps.items()):
  merged=[]
  for a,b in sorted(spans):
   if merged and a<=merged[-1][1]+1e-6:merged[-1][1]=max(b,merged[-1][1])
   else:merged.append([a,b])
  out.extend([[p,f'{a:.5f}',f'{b:.5f}']for a,b in merged])
 return hashlib.sha256(json.dumps(out,separators=(',',':')).encode()).hexdigest()
result={}
for f in sorted(args.source_dir.glob('*.xml')):
 id=f.stem
 score_path=repo/'src/lib/music/examples-pd'/f'{id}.ts'
 if not score_path.exists() or id=='lullaby':continue  # Noctave's lullaby is a different edition.
 r=E.parse(f).getroot();part=r.find('part');measures=part.findall('measure');div=1;bar=4;start=0;ev=collections.OrderedDict();bounds=[];fifths=[]
 for i,m in enumerate(measures):
  cursor=mx=0;onset=0
  for n in m:
   if n.tag=='attributes':
    div=float(n.findtext('divisions',str(div)));t=n.find('time')
    if t is not None:bar=sum(map(int,t.findtext('beats').split('+')))*4/int(t.findtext('beat-type'))
    for k in n.findall('key'):fifths.append([start+cursor,int(k.findtext('fifths')),k.findtext('mode','major')])
   d=float(n.findtext('duration','0'))/div
   if n.tag=='backup':cursor-=d
   elif n.tag=='forward':cursor+=d;mx=max(mx,cursor)
   elif n.tag=='note' and n.find('grace') is None:
    key=n.findtext('voice','1')+'/'+n.findtext('staff','1');events=ev.setdefault(key,[])
    if n.find('chord') is None:onset=cursor;cursor+=d;mx=max(mx,cursor)
    p=n.find('pitch')
    if p is not None and n.find('cue') is None:
     midi=(int(p.findtext('octave'))+1)*12+{'C':0,'D':2,'E':4,'F':5,'G':7,'A':9,'B':11}[p.findtext('step')]+int(p.findtext('alter','0'))
     events.append((start+onset,start+onset+d,midi))
  span=mx if i in [0,len(measures)-1] or m.get('implicit')=='yes' else max(mx,bar)
  bounds.append([round(start,6),round(span,6),bar]);start+=span
 pad={'elise':1,'alla-turca':1,'nocturne':5.5}.get(id,0)
 for events in ev.values():events[:]=[(a+pad,b+pad,p)for a,b,p in events]
 s=json.loads(score_path.read_text().split('export const score = ',1)[1].rsplit(' as Score;',1)[0]);vs=[s['notes']]+([s['voice2']]if 'voice2'in s else [])+s.get('extraVoices',[]);checks=[]
 for (key,events),v in zip(ev.items(),vs):
  at=0;actual=[]
  for n in v:
   actual.extend((at,at+n['dur'],p)for p in n['pitches']);at+=n['dur']
  checks.append({'voice':key,'sourceDigest':digest(events),'scoreDigest':digest(actual),'match':digest(events)==digest(actual)})
 result[id]={'sourceSha256':hashlib.sha256((args.source_dir/(id+'.mxl')).read_bytes()).hexdigest(),'measures':bounds,'keys':fifths,'voices':checks}
 print(id,[v['match']for v in checks], 'irregular bars',[(i+1,b)for i,b in enumerate(bounds)if abs(b[1]-b[2])>1e-6][:10])
args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2))
