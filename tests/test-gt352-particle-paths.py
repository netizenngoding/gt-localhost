#!/usr/bin/env python3
import importlib.util
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('audit', ROOT / 'tools/audit-gt352-particle-paths.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

class ParticleAuditTests(unittest.TestCase):
    def test_rejects_wrong_binary(self):
        with self.assertRaisesRegex(ValueError, 'Unsupported executable SHA-256'):
            audit.verify(b'wrong client')

    def test_extracts_calls_without_claiming_item_mapping(self):
        text = '''
  4a2a9f: b9 78 17 00 00       mov    ecx,0x1778
  4a2aa4: 66 39 4e 0e          cmp    WORD PTR [esi+0xe],cx
  4a2b12: e8 e9 b6 17 00       call   0x61e200
  4a2b17: 8d 45 a4             lea    eax,[ebp-0x5c]
  4a330f: e8 4c e5 17 00       call   0x621860
'''
        calls = audit.call_sites(text)
        self.assertEqual([x['address'] for x in calls], ['0x4a2b12', '0x4a330f'])
        self.assertIn('0x4a2a9f: mov    ecx,0x1778', calls[0]['preceding_instructions'])
        self.assertNotIn('item_id', calls[0])
        self.assertNotIn('effect_id', calls[0])

    def test_report_does_not_count_partial_address(self):
        text = '  4a2b12: e8 00 00 00 00       call   0x61e2000\n'
        self.assertEqual(audit.call_sites(text), [])

if __name__ == '__main__':
    unittest.main()
