const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtps3-extended-'));

function load(src) {
  const o = path.join(dir, path.basename(src) + Math.random() + '.cjs');
  esbuild.buildSync({ entryPoints: [src], outfile: o, bundle: true, platform: 'node' });
  return require(o);
}

try {
  const { ItemDatabase } = load('server/database/items.ts');
  const { ServerContext } = load('server/database/context.ts');
  const { normalizeAccount, buildCharacterStateForSession } = load('server/database/peer.ts');
  const { makeSetCharacterStatePacket, parseTankPacket } = load('server/proton/packet.ts');
  const { handleTelephoneLockeDialogReturn, getDailyQuestForDate } = load('server/action/dialog_return/telephone_locke.ts');
  const { handleItemActivateRequest } = load('server/gamePacket/item_activate.ts');

  const db = new ItemDatabase();
  const ctx = new ServerContext(db, dir);
  const acct = normalizeAccount({ userId: 1, name: 'Developer' });
  const packets = [];
  const session = {
    account: acct,
    netId: 1,
    x: 32,
    y: 32,
    world: null,
    cheats: {},
    peer: {
      packets,
      sendPacket(chan, p) {
        packets.push(p);
      },
    },
  };
  ctx.accounts.set('developer', acct);
  ctx.sessions.add(session);
  ctx.joinWorld(session, 'FEATURE_TEST');

  console.log('[TEST 1] Telephone & Crazy Jim Daily Quest');
  // 1. Dial 12345
  packets.length = 0;
  let handled = handleTelephoneLockeDialogReturn(ctx, session, '3898', { buttonClicked: '12345' });
  assert.equal(handled, true);
  assert.ok(packets.length > 0, 'Must send dialog for 12345');

  // 2. Click chc1_1 (Daily Quest details)
  packets.length = 0;
  handled = handleTelephoneLockeDialogReturn(ctx, session, '3898', { buttonClicked: 'chc1_1' });
  assert.equal(handled, true);

  // 3. Turn in items for Daily Quest
  const quest = getDailyQuestForDate(new Date());
  acct.inventory = [
    { itemId: quest.item1, count: quest.count1, equipped: false },
    { itemId: quest.item2, count: quest.count2, equipped: false },
  ];
  packets.length = 0;
  handled = handleTelephoneLockeDialogReturn(ctx, session, '3898', { buttonClicked: 'turnin' });
  assert.equal(handled, true);
  const tokenSlot = acct.inventory.find(s => s.itemId === 1486);
  assert.ok(tokenSlot && tokenSlot.count >= 1, 'Must award at least 1 Growtoken');
  assert.equal(acct.lastDailyQuestDay, quest.dayKey, 'Must mark daily quest completed');

  console.log('[TEST 2] Telephone Sales-Man & Blue Gem Lock Exchange');
  // Dial 53785
  packets.length = 0;
  handled = handleTelephoneLockeDialogReturn(ctx, session, '3898', { buttonClicked: '53785' });
  assert.equal(handled, true);

  // Click chc2_1 (BGL offer)
  handled = handleTelephoneLockeDialogReturn(ctx, session, '3898', { buttonClicked: 'chc2_1' });
  assert.equal(handled, true);

  // Exchange 100 DL for 1 BGL
  acct.inventory = [{ itemId: 1796, count: 100, equipped: false }];
  handled = handleTelephoneLockeDialogReturn(ctx, session, '3898', { buttonClicked: 'chc2_2_1' });
  assert.equal(handled, true);
  assert.equal(acct.inventory.find(s => s.itemId === 1796)?.count || 0, 0, '100 DL must be consumed');
  assert.equal(acct.inventory.find(s => s.itemId === 7188)?.count, 1, '1 BGL must be granted');

  console.log('[TEST 3] Locke Store Purchase');
  // Locke item 1210 costs 10 WL
  acct.inventory = [{ itemId: 242, count: 50, equipped: false }];
  session.lastLockeItem = 1210;
  handled = handleTelephoneLockeDialogReturn(ctx, session, 'locke_purchase', { buttonClicked: 'lock_item_', howmuch: '2' });
  assert.equal(handled, true);
  assert.equal(acct.inventory.find(s => s.itemId === 242)?.count, 30, '20 WL must be deducted');
  assert.equal(acct.inventory.find(s => s.itemId === 1210)?.count, 2, '2 of item 1210 must be granted');

  console.log('[TEST 4] Lock Shatter & Compression (100 WL <-> 1 DL, 100 DL <-> 1 BGL)');
  // 100 WL -> 1 DL
  acct.inventory = [{ itemId: 242, count: 100, equipped: false }];
  handleItemActivateRequest(ctx, session, 242);
  assert.equal(acct.inventory.find(s => s.itemId === 242)?.count || 0, 0);
  assert.equal(acct.inventory.find(s => s.itemId === 1796)?.count, 1);

  // 1 DL -> 100 WL
  handleItemActivateRequest(ctx, session, 1796);
  assert.equal(acct.inventory.find(s => s.itemId === 1796)?.count || 0, 0);
  assert.equal(acct.inventory.find(s => s.itemId === 242)?.count, 100);

  // 100 DL -> 1 BGL
  acct.inventory = [{ itemId: 1796, count: 100, equipped: false }];
  handleItemActivateRequest(ctx, session, 1796);
  assert.equal(acct.inventory.find(s => s.itemId === 1796)?.count || 0, 0);
  assert.equal(acct.inventory.find(s => s.itemId === 7188)?.count, 1);

  // 1 BGL -> 100 DL
  handleItemActivateRequest(ctx, session, 7188);
  assert.equal(acct.inventory.find(s => s.itemId === 7188)?.count || 0, 0);
  assert.equal(acct.inventory.find(s => s.itemId === 1796)?.count, 100);

  console.log('[TEST 5] Hair Color & Eye Drop Character State Packet');
  acct.hairColor = 0xFF112233;
  acct.eyeColor = 0xFF445566;
  acct.pupilColor = 0xFF778899;

  const charState = buildCharacterStateForSession(session, db);
  assert.equal(charState.hairColor, 0xFF112233);
  assert.equal(charState.eyeDrop, 0xFF445566);
  assert.equal(charState.eyeLenses, 0xFF778899);

  const rawPkt = makeSetCharacterStatePacket(charState);
  const parsed = parseTankPacket(rawPkt);
  assert.ok(parsed);
  assert.equal(parsed.punchX >>> 0, 0xFF112233 >>> 0, 'punchX (+44) must match hairColor');
  assert.equal(parsed.punchY >>> 0, 0xFF445566 >>> 0, 'punchY (+48) must match eyeDrop');
  assert.equal(parsed.targetNetId >>> 0, 0xFF778899 >>> 0, 'targetNetId (+8) must match eyeLenses');

  console.log('PASS: All Telephone, Locke, Lock Compression, and Hair/Eye character state tests succeeded!');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
