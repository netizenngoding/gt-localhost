// Optional end-to-end smoke test. Start a server with a disposable DATA_STORE_DIR,
// install Playwright separately, and run BASE_URL=http://127.0.0.1:3000 node tests/modern-ui-browser.cjs
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:3000';
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.setDefaultTimeout(25000);
    const errors = [];
    console.log('Loading client...');
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (/Failed to mount WorldUI|Error mounting RmlUi popup|tick failed/.test(m.text())) errors.push(m.text()); });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__clientFirstFrame, { timeout: 150000 });
    await page.waitForTimeout(1000);
    console.log('Client ready');
    assert.equal(await page.evaluate(() => window.__rmluiNative?._fetchCache.has('fonts/CenturyGothicBold.ttf')), true);
    await page.mouse.click(640, 435); // Play Online
    await page.waitForTimeout(1200);
    await page.mouse.click(850, 630); // Connect as guest
    await page.waitForFunction(() => window.RmlUiEngine.wasm.isInWorld(), { timeout: 45000 });
    console.log('World entered');
    await page.waitForTimeout(3000);
    await page.mouse.click(1148, 120); // close Gazette
    await page.waitForFunction(() => window.__rmluiNative?.hudDocs.size === 1, { timeout: 15000 });
    const chat = () => page.evaluate(() => GameSDK.listEntities().find(e => e.name === 'ConsoleLogParent'));
    let c = await chat();
    assert(c && c.visible && Math.abs(c.y) < 2000, 'chat should be visible in world');
    console.log('HUD and chat visible');
    await page.evaluate(() => RmlUiEngine.wasm.sendPacket(2, 'action|sidebar_hud\nbutton|mailbox\n'));
    await page.waitForFunction(() => ModernDialogUI.getActiveDialogName() === 'sidebar_mailbox' && ModernDialogUI.isOpen(), { timeout: 15000 });
    assert.equal(await page.evaluate(() => __rmluiNative.modalDocs.size), 1);
    assert.equal(await page.evaluate(() => __rmluiNative._fetchCache.has('GameData/sprites/interface/cross.png')), true);
    await page.evaluate(() => ModernDialogUI.close());
    await page.waitForFunction(() => __rmluiNative.modalDocs.size === 0, { timeout: 5000 });
    console.log('Mailbox opened and closed');
    // Reproduce the observed corrupted y coordinate after a console recreation.
    await page.evaluate(() => { const c = GameSDK.listEntities().find(e => e.name === 'ConsoleLogParent'); new GameSDK.Entity(c.ptr).position = { x: c.x, y: 1e25 }; });
    await page.waitForFunction(() => { const c = GameSDK.listEntities().find(e => e.name === 'ConsoleLogParent'); return c && Number.isFinite(c.y) && Math.abs(c.y) < 2000; }, { timeout: 10000 });
    console.log('Corrupted chat position repaired');
    // Test actual world exit and re-entry, waiting for each transition.
    for (let i = 0; i < 2; i++) {
      console.log('World cycle', i + 1);
      await page.evaluate(() => RmlUiEngine.wasm.sendPacket(2, 'action|quit_to_exit\n'));
      await page.waitForFunction(() => !RmlUiEngine.wasm.isInWorld(), { timeout: 20000 });
      await page.waitForTimeout(1200);
      await page.evaluate(() => RmlUiEngine.wasm.sendPacket(2, 'action|join_request\nname|START\ninvitedWorld|0\n'));
      await page.waitForFunction(() => RmlUiEngine.wasm.isInWorld(), { timeout: 20000 });
      try { await page.waitForFunction(() => __rmluiNative.hudDocs.size === 1, { timeout: 15000 }); }
      catch (err) {
        console.log('Transition diagnostics:', await page.evaluate(() => ({world:RmlUiEngine.wasm.isInWorld(), hud:__rmluiNative.hudDocs.size, menus:GameSDK.listEntities().filter(e => /Menu|Dialog/.test(e.name)).map(e => e.name), chat:GameSDK.listEntities().find(e => e.name === 'ConsoleLogParent')})));
        throw err;
      }
      await page.waitForTimeout(1500);
      c = await chat();
      assert(c && c.visible && Number.isFinite(c.y) && Math.abs(c.y) < 2000, `chat after world cycle ${i + 1}`);
    }
    assert.deepEqual(errors, []);
    console.log('PASS: startup, font, HUD, mailbox, chat corruption recovery, 2 world exit/re-entry cycles');
  } finally { await browser.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
