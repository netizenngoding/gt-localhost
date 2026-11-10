import importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('gp',Path(__file__).resolve().parents[1]/'tools/generate-gtps3-punch.py');g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
class TestPunchGenerator(unittest.TestCase):
 def test_cases_comments_and_fallthrough(self):
  self.assertEqual(g.extract('int get_punch_id(const int id_) { switch(id_) { /* case 999: return 7; */ case 1: case 2: return 80; case 3: return 9; } return 0;}'),{1:80,2:80,3:9})
 def test_fail_closed(self):
  for bad in ['case 1: return x;', 'case 1: return 300;', 'case 1: case 1: return 2;', 'case 1: return 2; break;']:
   with self.assertRaises(ValueError):g.extract('int get_punch_id(const int id_) { switch(id_) { '+bad+' } return 0;}')
if __name__=='__main__':unittest.main()
