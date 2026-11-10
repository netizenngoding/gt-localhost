#!/usr/bin/env python3
import importlib.util, json, tempfile, unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('generator',Path(__file__).resolve().parents[1]/'tools/generate-gtps3-consumables.py')
gen=importlib.util.module_from_spec(spec);spec.loader.exec_module(gen)
class GeneratorTests(unittest.TestCase):
 def test_switch_ignores_strings_comments_and_nested_cases(self):
  cpp='''vector<vector<string>> info_about_playmods{
    {"1", "12_5", "x", "on", "off", "12", "2", "spray.wav", "", "", "", "", ""},
    {"2", "13_0", ":D YUM!", "", "", "", "", "", "", "consume", "", "", ""},
    {"3", "12_0", "duplicate", "", "", "", "", "eat.wav", "", "consume", "", "", ""},
  }; switch (kind) { case BlockTypes::CONSUMABLE: {
    /* switch(p_) { case 999: } */ switch (p_) {
      case 12: case 13: {const char* s="case 42: { not a branch }"; switch(x) {case 19: break;} break;}
      case 20: do_something(); break; default: break;
    } break;
  } }'''
  base='if (i == 12) { items[i].consume_needed = 5; items[i].consume_prize = 14; } if (i == 999) { items[i].consume_needed = 9; items[i].consume_prize = 99; }'
  with tempfile.TemporaryDirectory() as d:
   p=Path(d);(p/'World.h').write_text(cpp);(p/'Base.h').write_text(base)
   stats=gen.generate(p/'World.h',p/'Base.h',p/'output')
   self.assertEqual(stats['playmod_rows'],3);self.assertEqual(stats['switch_labels'],4);self.assertEqual(stats['numeric_case_ids'],3);self.assertEqual(stats['recipe_ids'],1)
   result=(p/'output/gtps3-source.generated.ts').read_text();self.assertNotIn('"label": "19"',result);self.assertNotIn('"label": "42"',result);self.assertIn('"falls_through": true',result)
   sounds=(p/'output/consume-audio.ts').read_text();self.assertIn('12: "audio/spray.wav"',sounds);self.assertIn('13: "audio/eat.wav"',sounds)
   recipes=(p/'output/gtps3-recipes.ts').read_text();self.assertIn('12: [5, 14]',recipes);self.assertNotIn('999:',recipes)
 def test_invalid_input_fails_closed(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d);(p/'World.h').write_text('no source');(p/'Base.h').write_text('')
   with self.assertRaises(ValueError):gen.generate(p/'World.h',p/'Base.h',p/'out')
   self.assertFalse((p/'out').exists())
if __name__=='__main__':unittest.main()
