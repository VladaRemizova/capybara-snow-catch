import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PrizeLedger, STORAGE_KEY, SPIN_MS } from '../dist/v3/prizes.mjs';

const now = Date.parse('2026-11-13T12:00:00Z');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CAPY_CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
const errors = [];
try {
  for (const fixture of ['pending', 'spinning', 'won']) {
    const ledger = new PrizeLedger(null, now, () => .25);
    ledger.commitRound('navigation-qa', 20, now);
    if (fixture !== 'pending') ledger.startSpin(now);
    if (fixture === 'won') ledger.finishSpin(now + SPIN_MS);
    const saved = structuredClone(ledger.state);
    const context = await browser.newContext({ viewport: { width: 375, height: 672 } });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ key, saved }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, saved);
      window.drawVisits = [];
      new MutationObserver(records => {
        for (const record of records) if (['roulette-screen', 'win-screen'].includes(record.target.id) && !record.target.hidden) window.drawVisits.push(record.target.id);
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
    }, { key: STORAGE_KEY, saved: ledger.serialize() });
    await page.route('**/v3/main.mjs*', async route => route.fulfill({ contentType: 'application/javascript', body: await readFile(new URL('../dist/v3/main.mjs', import.meta.url), 'utf8') + '\nwindow.qa={game,async settle(){game.coins=0;await finishRound();}};' }));
    await page.clock.install({ time: new Date(now + SPIN_MS + 1000) });
    await page.clock.pauseAt(new Date(now + SPIN_MS + 2000));
    const state = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
    const entry = async () => { await page.locator('#entry-screen').waitFor({ state: 'visible' }); assert.deepEqual(await page.evaluate(() => window.drawVisits), []); };
    const play = async () => { await page.click('#play-button'); await page.click('#teaching-dismiss'); await page.clock.runFor(500); await page.locator('#game-screen').waitFor({ state: 'visible' }); };
    const tapTrophy = async selector => { const box = await page.locator(selector).boundingBox(); await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); };
    await page.goto('http://127.0.0.1:8080/v3/'); await entry();
    // Both entry and game prize links open the cabinet even with unclaimed draws.
    await page.click('#entry-prizes'); await page.locator('#cabinet-screen').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.prize-ticket').count(), saved.prizes.length);
    await tapTrophy('.cabinet-header .trophy'); assert.deepEqual(await page.evaluate(() => window.drawVisits), []);
    if (fixture === 'won') {
      await page.click('.ticket-activate'); await page.locator('#coupon-screen').waitFor({ state: 'visible' });
      await page.click('#coupon-back'); await page.locator('#cabinet-screen').waitFor({ state: 'visible' });
    }
    await page.click('#cabinet-home'); await entry();
    await play(); await page.click('#game-prizes'); await page.locator('#cabinet-screen').waitFor({ state: 'visible' });
    await page.click('#cabinet-home'); await entry();
    await play(); await tapTrophy('.game-header .trophy'); assert.deepEqual(await page.evaluate(() => window.drawVisits), []);
    await page.click('#game-home'); await entry();
    // Reload keeps entry visible; navigation never consumes a pending draw.
    await page.reload(); await entry();
    for (const key of ['coins', 'earned', 'pending', 'prizes', 'spin', 'lastWin']) assert.deepEqual((await state())[key], saved[key]);
    // Only the result's explicit claim action enters the saved draw flow.
    await play(); await page.evaluate(() => qa.settle()); await page.clock.runFor(600);
    await page.locator('#result-layer').waitFor({ state: 'visible' });
    assert.deepEqual(await page.evaluate(() => window.drawVisits), []);
    await page.click('#result-claim');
    await page.locator(fixture === 'won' ? '#win-screen' : '#roulette-screen').waitFor({ state: 'visible' });
    assert.ok((await page.evaluate(() => window.drawVisits)).length > 0);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ fixtures: ['pending', 'spinning', 'won'], homeAlwaysEntry: true, menuNeverOpensDraw: true, claimOpensDraw: true, storedPrizesPreserved: true, errors }, null, 2));
} finally { await browser.close(); }
