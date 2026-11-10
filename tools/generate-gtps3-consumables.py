#!/usr/bin/env python3
"""Extract GTPS3 consumable switch, playmod rows, sounds and recipes.

Example:
  python3 tools/generate-gtps3-consumables.py --world ../gtps3/SERVER/World.h \
      --base ../gtps3/SERVER/Base.h --outdir server/playmods

This is a data extractor / bounded generator, NOT a general C++ transpiler.
Complex branch bodies have side effects and dependencies; generating IDs or
metadata does not make those branches executable in TypeScript.
"""
from __future__ import annotations
import argparse, ast, hashlib, json, re
from pathlib import Path


def mask_cpp(s: str) -> str:
    """Blank comments and string/character literals without changing offsets."""
    out = list(s); i = 0; n = len(s)
    while i < n:
        start = i
        if s.startswith('//', i):
            end = s.find('\n', i); i = n if end < 0 else end
        elif s.startswith('/*', i):
            end = s.find('*/', i + 2)
            if end < 0: raise ValueError('unterminated block comment')
            i = end + 2
        elif s[i] in ('"', "'"):
            quote = s[i]; i += 1
            while i < n:
                if s[i] == '\\': i += 2; continue
                if s[i] == quote: i += 1; break
                i += 1
            else: raise ValueError('unterminated C++ string or character literal')
        else:
            i += 1; continue
        for k in range(start, min(i, n)):
            if s[k] not in '\r\n': out[k] = ' '
    return ''.join(out)


def close_brace(mask: str, start: int) -> int:
    if mask[start] != '{': raise ValueError('expected open brace')
    depth = 0
    for i in range(start, len(mask)):
        if mask[i] == '{': depth += 1
        if mask[i] == '}':
            depth -= 1
            if depth == 0: return i
    raise ValueError('unmatched open brace')


def extract_table(src: str, mask: str) -> list[list[str]]:
    match = re.search(r'\binfo_about_playmods\s*\{', mask)
    if not match: raise ValueError('info_about_playmods table not found')
    begin = mask.index('{', match.start()); end = close_brace(mask, begin)
    result = []; i = begin + 1
    while i < end:
        if mask[i] == '{':
            stop = close_brace(mask, i)
            raw = src[i:stop + 1]
            vals = [ast.literal_eval(m.group()) for m in re.finditer(r'"(?:\\.|[^"\\])*"', raw)]
            if len(vals) != 13: raise ValueError(f'playmod row expected 13 strings, got {len(vals)} at {i}')
            result.append(vals); i = stop + 1
        else: i += 1
    if not result: raise ValueError('empty playmods')
    return result


def extract_switch(src: str, mask: str) -> list[dict]:
    case = re.search(r'\bcase\s+BlockTypes\s*::\s*CONSUMABLE\s*:', mask)
    if not case: raise ValueError('case BlockTypes::CONSUMABLE not found')
    sw = re.search(r'\bswitch\s*\(\s*p_\s*\)\s*\{', mask[case.end():])
    if not sw: raise ValueError('consumable item switch not found')
    begin = case.end() + sw.end() - 1; end = close_brace(mask, begin)
    labels = []; i = begin + 1; depth = 1
    pat = re.compile(r'\b(case\s+([^:]+)|default)\s*:')
    while i < end:
        c = mask[i]
        if c == '{': depth += 1; i += 1; continue
        if c == '}': depth -= 1; i += 1; continue
        if depth == 1:
            m = pat.match(mask, i)
            if m:
                labels.append((i, m.end(), None if m.group(1) == 'default' else m.group(2).strip()))
                i = m.end(); continue
        i += 1
    if not labels: raise ValueError('no switch labels found')
    result = []
    for k, (pos, after, label) in enumerate(labels):
        stop = labels[k + 1][0] if k + 1 < len(labels) else end
        body = src[after:stop]
        result.append({'label': label, 'line': src.count('\n', 0, pos) + 1,
                       'body': body, 'body_bytes': len(body.encode()),
                       'body_sha256': hashlib.sha256(body.encode()).hexdigest(),
                       'falls_through': not mask[after:stop].strip()})
    return result


def generate(world: Path, base: Path, outdir: Path) -> dict:
    src = world.read_text(encoding='utf-8-sig'); mask = mask_cpp(src)
    table = extract_table(src, mask); cases = extract_switch(src, mask)
    base_src = base.read_text(encoding='utf-8-sig')
    recipes = [(int(a), int(b), int(c)) for a,b,c in re.findall(
        r'if\s*\(\s*i\s*==\s*(\d+)\s*\)\s*\{[^}]*?consume_needed\s*=\s*(\d+)\s*;[^}]*?consume_prize\s*=\s*(\d+)\s*;', base_src)]
    labels = {int(x['label']) for x in cases if x['label'] and x['label'].isdigit()}
    recipes = [x for x in recipes if x[0] in labels]
    if not recipes: raise ValueError('no recipes matched switch labels')
    sound = {}; seen = set()
    for row in table:
        if not re.fullmatch(r'\d+_\d+', row[1]): continue
        item = int(row[1].split('_')[0])
        if item in seen: continue # C++ first matching row returns immediately
        seen.add(item)
        val = 'eat.wav' if row[9] in ('consume', 'cutewords') else row[7]
        if val: sound[item] = 'audio/' + val
    outdir.mkdir(parents=True, exist_ok=True)
    generated = '// Generated by tools/generate-gtps3-consumables.py; do not edit.\n'
    generated += '// Source GTPS3 World.h; metadata does not execute C++ branches.\n'
    generated += 'export const GTPS3_PLAYMOD_ROWS: readonly (readonly string[])[] = ' + json.dumps(table, ensure_ascii=False, indent=2) + ';\n'
    generated += 'export const GTPS3_CONSUMABLE_CASES = ' + json.dumps(cases, ensure_ascii=False, indent=2) + ' as const;\n'
    (outdir/'gtps3-source.generated.ts').write_text(generated,encoding='utf-8')
    sound_text = '/** Generated from GTPS3 World.h; no implicit sounds for absent entries. */\n'
    sound_text += 'const GTPS3_SOUNDS: Readonly<Record<number,string>> = {\n'
    sound_text += ''.join(f'  {k}: {json.dumps(v)},\n' for k,v in sorted(sound.items()))
    sound_text += '};\nexport function consumableAudio(itemId: number): string | undefined {\n  return GTPS3_SOUNDS[itemId];\n}\n'
    (outdir/'consume-audio.ts').write_text(sound_text,encoding='utf-8')
    recipe_text = '/** Generated from GTPS3 Base.h and World.h; do not edit. */\n'
    recipe_text += 'export const GTPS3_CONSUME_RECIPES: Readonly<Record<number,readonly [number,number]>> = {\n'
    recipe_text += ''.join(f'  {a}: [{b}, {c}],\n' for a,b,c in recipes)
    recipe_text += '};\n'
    (outdir/'gtps3-recipes.ts').write_text(recipe_text,encoding='utf-8')
    return {'playmod_rows':len(table),'switch_labels':len(cases),'numeric_case_ids':len(labels),'sound_ids':len(sound),'recipe_ids':len(recipes),
            'world_sha256':hashlib.sha256(world.read_bytes()).hexdigest(),'base_sha256':hashlib.sha256(base.read_bytes()).hexdigest()}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--world', type=Path, required=True);p.add_argument('--base',type=Path,required=True)
    p.add_argument('--outdir',type=Path,default=Path('server/playmods'))
    args=p.parse_args();print(json.dumps(generate(args.world,args.base,args.outdir),indent=2))
if __name__=='__main__':main()
