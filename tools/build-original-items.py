"""Build v18-compatible ORIGINAL item definitions from a pinned v14 community baseline.
Usage: python tools/build-original-items.py BASELINE_DAT CLIENT_JS CLIENT_DATA OUTPUT_TS
Only asset checksums are adapted to the supplied client; item names/types/graphics
coordinates/options come from baseline. This does not license or clean client assets.
"""
import sys,struct,re,hashlib,json,base64
from pathlib import Path
source,manifest,bundle,output=map(Path,sys.argv[1:])
b=source.read_bytes();assert hashlib.sha256(b).hexdigest() == '1e024cced3fd4eaa2ddb96ba4c8b66893acc98f56ec68a1cc3049f36ab57082c', 'Unexpected baseline: verify provenance before changing this pin'
version,count=struct.unpack_from('<HI',b);assert version==14
files={n:(int(a),int(e)) for n,a,e in re.findall(r'\{filename:"([^\"]+)"\s*,start:(\d+),end:(\d+)\}',manifest.read_text())}
f=bundle.open('rb');cache={};missing=set()
def asset_hash(name,texture=False):
 if not name:return 0
 candidates=['/game/'+name,'/'+name.lstrip('/')] if texture else ['/'+name.lstrip('/'),'/game/'+name]
 path=next((p for p in candidates if p in files),None)
 if path is None:missing.add(name);return None
 if path not in cache:
  a,e=files[path];f.seek(a);data=f.read(e-a);v=0x55555555
  for x in data:v=((v>>27)+(v<<5)+x)&0xffffffff
  cache[path]=v
 return cache[path]
pos=6;records=[]
def string():
 global pos
 n=struct.unpack_from('<H',b,pos)[0];pos+=2;s=b[pos:pos+n];pos+=n;return s
for index in range(count):
 start=pos;id=struct.unpack_from('<I',b,pos)[0];assert id==index;pos+=8
 string();texture=string().decode('latin1');textureHashPos=pos;pos+=23
 extra=string().decode('latin1');extraHashPos=pos;pos+=8
 for _ in range(4):string()
 pos+=24
 for _ in range(3):string()
 pos+=80;string();pos+=13+4+4
 record=bytearray(b[start:pos])
 for name,offset,is_texture in [(texture,textureHashPos,True),(extra,extraHashPos,False)]:
  value=asset_hash(name,is_texture)
  if value is not None:struct.pack_into('<I',record,offset-start,value)
 records.append(bytes(record)+bytes(37))
assert pos==len(b)
result=struct.pack('<HI',18,count)+b''.join(records)
output.write_text('// Generated original definitions; asset checksums adapted to client. See tools/build-original-items.py.\nexport const ORIGINAL_ITEMS_BASE64 = "'+base64.b64encode(result).decode()+'";\n')
report={'baselineSha256':hashlib.sha256(b).hexdigest(),'records':count,'outputBytes':len(result),'outputSha256':hashlib.sha256(result).hexdigest(),'assetHashesAdapted':len(cache),'missingAssetPaths':sorted(missing)}
output.with_suffix('.audit.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
