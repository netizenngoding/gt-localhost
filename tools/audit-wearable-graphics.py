#!/usr/bin/env python3
"""Compare v18 wearable graphics against a supplied native-client items.dat.

Usage: python3 tools/audit-wearable-graphics.py UPSTREAM_ITEMS_DAT OUTPUT_CSV
This is a comparison, NOT proof that a difference is a bug: upstream may contain
custom items and renderers. Never automatically overwrite baseline records.
"""
import base64, csv, hashlib, re, struct, sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
if len(sys.argv) != 3:
    raise SystemExit(__doc__)
original = base64.b64decode(re.search(r'"([A-Za-z0-9+/=]+)"', (root / 'server/database/original-item-data.ts').read_text()).group(1))
upstream = Path(sys.argv[1]).read_bytes()

def parse(data):
    version, count = struct.unpack_from('<HI', data)
    if version != 18:
        raise ValueError(f'Expected v18, got v{version}')
    p = 6
    def string():
        nonlocal p
        size = struct.unpack_from('<H', data, p)[0]; p += 2
        result = data[p:p+size]; p += size
        if len(result) != size: raise ValueError('Truncated string')
        return result
    items = {}
    key = b'PBG892FXX982ABC*'
    for expected in range(count):
        ident, flags, action, material = struct.unpack_from('<IHBB', data, p); p += 8
        if ident != expected: raise ValueError(f'Unexpected item ID {ident}, wanted {expected}')
        name = bytes(x ^ key[(i+ident)%16] for i,x in enumerate(string())).decode('utf-8','replace')
        texture = string().decode('latin1')
        raw = data[p:p+23]
        if len(raw)!=23: raise ValueError('Truncated record')
        p += 23
        extra = string(); p += 8
        for _ in range(4): string()
        p += 24
        for _ in range(3): string()
        p += 80
        string(); p += 13+4+4+25
        string(); string(); p += 4+4
        items[ident] = {'name':name, 'action':action, 'flags':flags, 'texture':texture,
                        'hash':f'{struct.unpack_from("<I",raw)[0]:08x}',
                        'visual':raw[4], 'x':raw[9], 'y':raw[10], 'extra':extra.decode('latin1')}
    if p != len(data): raise ValueError(f'Unexpected trailing bytes: {len(data)-p}')
    return items

a,b = parse(original),parse(upstream)
fields = ['action','flags','texture','hash','visual','x','y','extra']
columns = ['id','baseline_name','upstream_name','differing_fields'] + [f'{side}_{f}' for f in fields for side in ('baseline','upstream')]
count = same = changed = 0
with Path(sys.argv[2]).open('w',newline='',encoding='utf-8') as f:
    out=csv.DictWriter(f,fieldnames=columns);out.writeheader()
    for ident in sorted(a.keys() & b.keys()):
        x,y=a[ident],b[ident]
        if x['action'] not in (20,107) and y['action'] not in (20,107): continue
        differences=[field for field in fields if x[field]!=y[field]]
        count += 1; same += not bool(differences); changed += bool(differences)
        row={'id':ident,'baseline_name':x['name'],'upstream_name':y['name'],'differing_fields':','.join(differences)}
        for field in fields: row['baseline_'+field]=x[field];row['upstream_'+field]=y[field]
        out.writerow(row)
print(f'baseline_sha256={hashlib.sha256(original).hexdigest()} upstream_sha256={hashlib.sha256(upstream).hexdigest()}')
print(f'wearable_records={count} same={same} differences={changed}; output={sys.argv[2]}')
