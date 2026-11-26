// Starts from a clean document to exercise the real native RmlUi renderer
// without a full game login. Requires a running server and Playwright.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:3000';
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    for (const mobile of [false, true]) {
      const page = await browser.newPage({ viewport: mobile ? {width:800,height:450} : {width:1280,height:720}, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (/Error mounting RmlUi popup|Failed to mount WorldUI/.test(m.text())) errors.push(m.text()); });
      await page.goto(base + '/manifest.json');
      await page.setContent('<!doctype html><body style="background:#24728d"></body>');
      await page.addScriptTag({url:base + '/WebLoaderData/RmlUiEngine.js'});
      await page.addScriptTag({url:base + '/WebLoaderData/ModernDialogUI.js'});
      await page.evaluate(() => ModernDialogUI.install());
      await page.evaluate(() => ModernDialogUI.open({dialogName:'sidebar_dungeon',blocks:[{type:'challenges',items:[{id:'test',title:'Test challenge',description:'Test',iconItemId:14734,progress:2,target:8,points:20000,rewards:[{itemId:112,count:1000},{itemId:242,count:1}]}]}]}));
      const check = await page.evaluate(() => {
        const n = __rmluiNative;
        const text = new TextDecoder().decode(n.virtualFiles.get('GameData/UI/Windows/Dungeon/DungeonStartUi.rml'));
        return {open:ModernDialogUI.isOpen(),native:n.modalDocs.size, dpr:n.dpr, text,
          icons:[112,242,14730,14734].map(id => n._fetchCache.get('api/item-icon/'+id+'.png')?.length || 0)};
      });
      assert.equal(check.open, true);
      assert.equal(check.native, 1);
      assert(check.text.includes('Go on an adventure') && !check.text.includes("Localize('[dungeon_start_ui_desc]')"));
      assert(check.text.includes('Buy Dungeon Pass'));
      assert(check.icons.every(size => size > 68), 'all reward/icon PNGs must be preloaded and non-placeholder');
      if (mobile) assert.equal(check.dpr, 1);
      await page.evaluate(() => ModernDialogUI.open({dialogName:'sidebar_dungeon_league',blocks:[]}));
      const board = await page.evaluate(() => new TextDecoder().decode(__rmluiNative.virtualFiles.get('GameData/UI/Windows/Dungeon/Leaderboard.rml')));
      assert(!board.includes('[DUNGEON_LEADERBOARD_'));
      assert(board.includes('League Information') && board.includes('Rewards'));
      await page.evaluate(() => ModernDialogUI.close());
      assert.equal(await page.evaluate(() => __rmluiNative.modalDocs.size), 0, 'closing a dialog must be immediate');
      // A new dialog opening during close must survive the old close timer.
      await page.evaluate(async () => { await ModernDialogUI.open({dialogName:'sidebar_dungeon',blocks:[]}); ModernDialogUI.close(); await ModernDialogUI.open({dialogName:'sidebar_dungeon_league',blocks:[]}); });
      await page.waitForTimeout(300);
      assert.deepEqual(await page.evaluate(() => [ModernDialogUI.isOpen(), ModernDialogUI.getActiveDialogName(), __rmluiNative.modalDocs.size]), [true,'sidebar_dungeon_league',1]);
      assert.deepEqual(errors, []);
      await page.close();
      console.log('PASS dungeon + leaderboard + icon preload + instant dialog lifecycle:', mobile ? 'mobile viewport' : 'desktop viewport');
    }
  } finally { await browser.close(); }
})().catch(err => {console.error(err); process.exitCode=1;});
