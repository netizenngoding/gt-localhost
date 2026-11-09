#!/usr/bin/env python3
"""Repack the user's PNG into the native middle-finger RTTXTR texture.
Requires Pillow: python -m pip install Pillow
Run from the repository root: python tools/update-middle-sprite.py [file.png]
"""
import base64, re, struct, sys, zlib
from pathlib import Path
from PIL import Image
root = Path(__file__).resolve().parent.parent
source = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'public/custom-emotes/middle-source.png'
image = Image.open(source).convert('RGBA')
if image.height != 16 or not 1 <= image.width <= 32:
    raise SystemExit('Sprite harus maksimal 32 x 16 piksel, dengan tinggi tepat 16 piksel.')
canvas = Image.new('RGBA', (32, 16), (0, 0, 0, 0))
canvas.paste(image, (0, 0))
# Exact RTTXTR header obtained from this pinned client's original hand asset.
h = bytearray(124); h[:6] = b'RTTXTR'
struct.pack_into('<IIIIIIII', h, 8, 16, 32, 0x1401, 16, 32, 1, 1, 0)
struct.pack_into('<III', h, 100, 16, 32, 2048)
raw = h + canvas.tobytes()
compressed = zlib.compress(raw, 9)
header = bytearray(32); header[:6] = b'RTPACK'
struct.pack_into('<III', header, 8, len(compressed), len(raw), 1)
encoded = base64.b64encode(header + compressed).decode('ascii')
branding = root / 'public/WebLoaderData/ServerBranding.js'
text = branding.read_text(encoding='utf-8')
pattern = r'(const customMiddle=Uint8Array\.from\(atob\(")[^"]*("\),c=>c\.charCodeAt\(0\)\);)'
text, n = re.subn(pattern, lambda m: m[1] + encoded + m[2], text)
if n != 1: raise SystemExit('Lokasi aset custom tidak ditemukan; patch client mungkin berbeda.')
branding.write_text(text, encoding='utf-8')
print('Sprite berhasil dipaketkan; restart server dan hard refresh seluruh client.')
