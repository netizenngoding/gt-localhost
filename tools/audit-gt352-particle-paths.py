#!/usr/bin/env python3
"""Verify v3.52 particle evidence and inventory native player-update call sites.

Usage: python3 tools/audit-gt352-particle-paths.py /path/Growtopia.exe report.json
Requires GNU objdump; the supplied executable is not distributed. Context is raw
machine disassembly, not inferred item-to-effect mappings or runnable effects.
"""
import hashlib
import json
import re
import struct
import subprocess
import sys
from collections import deque
from pathlib import Path

SHA256 = '20763ab578ba681c804a576acba2c2e42543f86ba8cdf242afa689b7e3ea1583'


def read_pe_address(data, address, size):
    def u16(offset): return struct.unpack_from('<H', data, offset)[0]
    def u32(offset): return struct.unpack_from('<I', data, offset)[0]
    pe = u32(0x3c)
    if data[pe:pe + 4] != b'PE\0\0' or u16(pe + 24) != 0x10b:
        raise ValueError('Expected PE32 executable')
    base = u32(pe + 24 + 28)
    sections = pe + 24 + u16(pe + 20)
    rva = address - base
    for i in range(u16(pe + 6)):
        _, va, raw_size, raw = struct.unpack_from('<IIII', data, sections + i * 40 + 8)
        if 0 <= rva - va and rva - va + size <= raw_size and raw + rva - va + size <= len(data):
            return data[raw + rva - va:raw + rva - va + size]
    raise ValueError(f'Address 0x{address:x} is outside file-backed PE sections')


def verify(data):
    sha = hashlib.sha256(data).hexdigest()
    if sha != SHA256:
        raise ValueError('Unsupported executable SHA-256: ' + sha)
    # The two values written at +0x28 and +0x20 are BYTES, not dwords.
    signatures = {
        'item_6008_check': (0x4a2a9f, 'b97817000066394e0e0f85ba000000'),
        'emitter_59_initialization': (0x4a2b0b, '6a3bf30f114804e8e9b61700'),
        'emitter_59_configuration': (0x61f837, 'c7464c02000000c6462801c6462001'),
        'emitter_59_cleanup': (0x4a2b98, '8d8f340e0000e8cd780200'),
    }
    for name, (address, hex_data) in signatures.items():
        expected = bytes.fromhex(hex_data)
        if read_pe_address(data, address, len(expected)) != expected:
            raise ValueError(f'{name}: signature mismatch at {address:#x}')
    # Native dispatch uses emitter_id - 1 as its jump-table index.
    table_value = struct.unpack('<I', read_pe_address(data, 0x62036c + (59 - 1) * 4, 4))[0]
    if table_value != 0x61f837:
        raise ValueError('Unexpected emitter 59 jump table entry')
    return {'sha256': sha, 'item_id': 6008, 'emitter_id': 59,
            'emitter_configuration_address': '0x61f837',
            'configuration_writes': {'offset_0x4c_dword': 2, 'offset_0x28_byte': 1, 'offset_0x20_byte': 1}}


def call_sites(disassembly):
    # Restrict this listing to the native player-update routine region; no guesses
    # about the nearest item check, branch conditions, or effect-ID equivalence.
    history = deque(maxlen=25)
    results = []
    for line in disassembly.splitlines():
        m = re.match(r'^\s*([0-9a-fA-F]+):\s+((?:[0-9a-fA-F]{2}\s+)+)\s*(.*)$', line)
        if not m:
            continue
        addr, operation = int(m.group(1), 16), m.group(3).strip()
        if re.search(r'\bcall\s+0x(?:61e200|621860)\b', operation):
            results.append({'address': f'0x{addr:x}', 'call': operation,
                            'preceding_instructions': list(history)})
        history.append(f'{addr:#x}: {operation}')
    return results


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    path = Path(sys.argv[1])
    evidence = verify(path.read_bytes())
    proc = subprocess.run(['objdump', '-d', '-M', 'intel', '--start-address=0x4a0000',
                           '--stop-address=0x4b0000', str(path)], check=True, text=True,
                          stdout=subprocess.PIPE)
    calls = call_sites(proc.stdout)
    if not any(c['address'] == '0x4a2b12' for c in calls):
        raise ValueError('Expected emitter call not found in objdump output')
    report = {'evidence': evidence,
              'warning': 'Emitter IDs and single-particle IDs are distinct; contexts are not verified item mappings.',
              'range': ['0x4a0000', '0x4b0000'], 'calls': calls}
    Path(sys.argv[2]).write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(f"Verified item 6008 / persistent emitter 59. Listed {len(calls)} initializer/particle calls in player-update region.")
    print('Report:', sys.argv[2])

if __name__ == '__main__':
    main()
