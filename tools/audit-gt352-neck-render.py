#!/usr/bin/env python3
"""Verify source instructions used for the necklace patch.
Usage: python3 tools/audit-gt352-neck-render.py /path/to/extracted/Growtopia.exe
The Windows client is user-supplied; this script does not distribute it.
"""
import hashlib, struct, sys
from pathlib import Path
if len(sys.argv)!=2: raise SystemExit(__doc__)
b=Path(sys.argv[1]).read_bytes()
sha=hashlib.sha256(b).hexdigest()
expected='20763ab578ba681c804a576acba2c2e42543f86ba8cdf242afa689b7e3ea1583'
if sha!=expected: raise SystemExit('Unsupported executable SHA-256: '+sha)
u16=lambda pos:struct.unpack_from('<H',b,pos)[0]
u32=lambda pos:struct.unpack_from('<I',b,pos)[0]
pe=u32(0x3c)
if b[pe:pe+4]!=b'PE\0\0': raise SystemExit('Not a PE executable')
sec_count=u16(pe+6); optional=pe+24; size=u16(pe+20)
if u16(optional)!=0x10b: raise SystemExit('Expected PE32')
base=u32(optional+28); headers=optional+size
sections=[]
for i in range(sec_count):
 p=headers+i*40
 virtual_size,va,raw_size,raw=struct.unpack_from('<IIII',b,p+8)
 sections.append((va,raw_size,raw))
def read(address,n):
 rva=address-base
 for va,length,offset in sections:
  if 0<=rva-va and rva-va+n<=length:return b[offset+rva-va:offset+rva-va+n]
 raise ValueError('Address is not present in a PE file section')
signatures={
 'neck_animation_modes_4_7_24':(0x54c465,'83f804740a83f807740583f818751ae887b1f4ff8b8830010000b81f85eb51f7e18bdac1eb0683e301'),
 'dragoscarf_attack_frame_conditions':(0x54c48e,'81ffee11000075438b4e0483b9f8140000127455f6816214000001754c80b9a41400000075436a01e8f53bf6ffb9c01000006639480874318b460480b80c150000047525bb02000000'),
 'neck_types_23_24_y_offset':(0x54c4f7,'8b55108b424483f817740583f818751bf30f104638f30f590580c48500f30f104d0cf30f5cc8f30f114d0c'),
 'dragoscarf_neck_id':(0x4d135a,'0fb74e10c74508ee110000c745f474180000663b4d08740a663b4df40f85df010000'),
 'dragoscarf_native_particle_94':(0x4d14c1,'663b45087541e824b91500f30f1045f06a0083ec14c744241000000000f30f1144240cf30f1045e8f30f11442408f30f1045dcf30f11442404f30f1045d8f30f1104246a5e'),
}
for name,(addr,hexbytes) in signatures.items():
 expected_bytes=bytes.fromhex(hexbytes)
 if read(addr,len(expected_bytes))!=expected_bytes: raise SystemExit(f'Signature mismatch: {name}')
 print(f'{name}: verified at 0x{addr:x}')
value=struct.unpack('<f',read(0x85c480,4))[0]
if value!=16.0:raise SystemExit('Unexpected offset constant')
print('neck_y_offset_scaled:',value)
print('Note: native particle ID 94 is not established as equivalent in the project client.')
print('sha256:',sha)
