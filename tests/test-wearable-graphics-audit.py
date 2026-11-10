import base64, csv, re, subprocess, sys, tempfile, unittest
from pathlib import Path
root = Path(__file__).resolve().parents[1]

class AuditTests(unittest.TestCase):
    def test_self_comparison_and_known_coordinates(self):
        source=(root/'server/database/original-item-data.ts').read_text()
        data=base64.b64decode(re.search(r'"([A-Za-z0-9+/=]+)"',source).group(1))
        with tempfile.TemporaryDirectory() as tmp:
            inp=Path(tmp)/'items.dat'; out=Path(tmp)/'report.csv'; inp.write_bytes(data)
            subprocess.run([sys.executable,str(root/'tools/audit-wearable-graphics.py'),str(inp),str(out)],check=True,capture_output=True,text=True)
            with out.open(encoding='utf-8',newline='') as f:
                rows={int(r['id']):r for r in csv.DictReader(f)}
        self.assertGreater(len(rows),3000)
        self.assertFalse(any(r['differing_fields'] for r in rows.values()))
        self.assertEqual((rows[4590]['baseline_visual'],rows[4590]['baseline_x'],rows[4590]['baseline_y']),('24','0','7'))
        self.assertEqual((rows[6008]['baseline_visual'],rows[6008]['baseline_x'],rows[6008]['baseline_y']),('4','6','6'))

if __name__=='__main__': unittest.main()
