#!/usr/bin/env python3
"""Generate punch effect IDs from GTPS3 Base.h's numeric get_punch_id switch.

Fail on unknown C++ syntax or duplicated labels instead of guessing semantics.
The source mapping is a third-party private server, not official server data.
"""
import argparse, hashlib, importlib.util, json, re
from pathlib import Path
spec=importlib.util.spec_from_file_location('gtps3_generator',Path(__file__).with_name('generate-gtps3-consumables.py'))
g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
def extract(src):
 mask=g.mask_cpp(src)
 match=re.search(r'\bint\s+get_punch_id\s*\(\s*const\s+int\s+id_\s*\)\s*\{',mask)
 if not match: raise ValueError('get_punch_id function not found')
 start=mask.index('{',match.start());end=g.close_brace(mask,start)
 body=mask[start+1:end]
 sw=re.search(r'\bswitch\s*\(\s*id_\s*\)\s*\{',body)
 if not sw: raise ValueError('punch switch not found')
 begin=body.index('{',sw.start());finish=g.close_brace(body,begin)
 if re.sub(r'\s+','',body[:sw.start()]) or re.sub(r'\s+','',body[finish+1:])!='return0;':
  raise ValueError('unexpected code outside punch switch')
 switch=body[begin+1:finish]
 pattern=re.compile(r'\s*(?:(case)\s+(\d+)\s*:|(return)\s+(\d+)\s*;)')
 pending=[];result={};pos=0
 while pos<len(switch):
  if not switch[pos:].strip():break
  m=pattern.match(switch,pos)
  if not m: raise ValueError('unsupported switch syntax at '+repr(switch[pos:pos+100]))
  if m.group(1):pending.append(int(m.group(2)))
  else:
   effect=int(m.group(4))
   if not pending or not 0<=effect<=255:raise ValueError('invalid punch effect')
   for item in pending:
    if item in result:raise ValueError('duplicate item '+str(item))
    result[item]=effect
   pending=[]
  pos=m.end()
 if pending or not result:raise ValueError('incomplete or empty switch')
 return result

def generate(base,out):
 mapping=extract(base.read_text(encoding='utf-8-sig'));out.parent.mkdir(parents=True,exist_ok=True)
 text='// Generated from GTPS3 Base.h get_punch_id; do not edit.\n// GTPS3 ae49cffa6c4c8bdc8fa1bfd0e6b6e3c3b01e654e; third-party values.\n'
 text+='export const GTPS3_PUNCH_EFFECTS: Readonly<Record<number,number>> = {\n'
 text+=''.join(f'  {item}: {mapping[item]},\n' for item in sorted(mapping))+'};\n'
 out.write_text(text,encoding='utf-8')
 return {'mappings':len(mapping),'max_effect':max(mapping.values()),'base_sha256':hashlib.sha256(base.read_bytes()).hexdigest()}
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--base',type=Path,required=True);p.add_argument('--out',type=Path,default=Path('server/playmods/gtps3-punch.generated.ts'))
 a=p.parse_args();print(json.dumps(generate(a.base,a.out),indent=2))
