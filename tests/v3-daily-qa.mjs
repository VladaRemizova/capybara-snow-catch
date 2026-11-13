import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PrizeLedger, STORAGE_KEY, SPIN_MS } from '../dist/v3/prizes.mjs';
import { ITEM_CONTACTS } from '../dist/v3/collision-shapes.mjs';
import { BAG_OPENING } from '../dist/v3/game-core.mjs';

const now = Date.parse('2026-11-13T12:00:00Z'), seed = new PrizeLedger(null, now, () => .25);
seed.commitRound('yesterday', 29, now);
let time = now;
for (let n = 0; n < 2; n++) { seed.startSpin(time); time += SPIN_MS; seed.finishSpin(time); seed.acknowledgeWin(); }
const prizes = structuredClone(seed.state.prizes), legacy = JSON.parse(seed.serialize());
delete legacy.dayCoins;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CAPY_CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 375, height: 672 } }), errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(({ key, saved }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, saved); }, { key: STORAGE_KEY, saved: JSON.stringify(legacy) });
await page.route('**/v3/main.mjs*', async route => route.fulfill({ contentType: 'application/javascript', body: await readFile(new URL('../dist/v3/main.mjs', import.meta.url), 'utf8') + '\nwindow.qa={game,render,async finish(){await finishRound();}};' }));
await page.clock.install({ time: new Date(now) }); await page.clock.pauseAt(new Date(now + 1000));
const tick = ms => page.clock.runFor(ms);
const state = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
const nextDay = async () => { await page.click('#admin-toggle'); await page.click('#admin-next-day'); await page.locator('#entry-screen').waitFor({ state: 'visible' }); };
const play = async () => { await page.click('#play-button'); await page.click('#teaching-dismiss'); await tick(500); await page.evaluate(() => { qa.game.nextSpawn = 100; qa.game.objects = []; qa.render(); }); };
let serial = 200;
const catchOne = async () => {
  await page.evaluate(({ tip, mouth, id }) => { qa.game.objects = [{ id, kind: 'coffee', value: 1, x: qa.game.characterX + mouth.x - tip.x, y: qa.game.catchY - tip.y - .5 }]; qa.render(); }, { tip: ITEM_CONTACTS.coffee, mouth: BAG_OPENING, id: serial++ });
  await tick(32);
};
try {
  await page.goto('http://127.0.0.1:8080/v3/');
  assert.equal((await state()).coins, 29); assert.equal((await state()).dayCoins, 29);
  await nextDay();
  assert.equal((await state()).coins, 29); assert.equal((await state()).dayCoins, 0); assert.equal((await state()).earned, 0);
  assert.deepEqual((await state()).prizes, prizes);
  await play(); assert.equal(await page.locator('#coin-value').textContent(), '29'); assert.equal(await page.locator('#prize-value').textContent(), '0/3');
  for (let n = 1; n <= 31; n++) {
    await catchOne(); assert.equal(await page.locator('#coin-value').textContent(), String(29 + n));
    assert.equal(await page.locator('#prize-value').textContent(), `${Math.min(3, Math.floor(n / 10))}/3`);
    if (n === 1) { assert.equal(await page.locator('#progress-fill').evaluate(node => node.style.width), '10%'); assert.equal(await page.locator('#prize-progress').getAttribute('aria-valuenow'), '1'); }
    if (n % 10 === 0) {
      await tick(500); await page.locator('#reward-layer').waitFor({ state: 'visible' });
      if (n === 30) await page.click('#reward-continue');
      else { await page.click('#reward-layer', { position: { x: 10, y: 200 } }); await tick(250); }
    }
  }
  await page.evaluate(() => qa.finish()); await tick(600);
  assert.equal(await page.locator('#result-coins').textContent(), '60');
  const completed = await state();
  assert.equal(completed.coins, 60); assert.equal(completed.dayCoins, 31); assert.equal(completed.earned, 3); assert.equal(completed.pending.length, 3);
  assert.deepEqual(completed.prizes, prizes);
  await page.reload(); await page.locator('#entry-screen').waitFor({ state: 'visible' });
  assert.equal((await state()).dayCoins, 31);
  await nextDay(); await play(); await catchOne();
  assert.equal(await page.locator('#coin-value').textContent(), '61'); assert.equal(await page.locator('#prize-value').textContent(), '0/3');
  assert.equal((await state()).coins, 60); assert.equal((await state()).dayCoins, 0); assert.equal((await state()).earned, 0);
  assert.deepEqual((await state()).prizes, prizes); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ legacySaveMigrated: true, bankPreservedAcrossDays: true, previousDay29Plus1AwardsZero: true, dailyThresholds: [10, 20, 30], threePerDay: true, previousPrizesPreserved: true, errors }, null, 2));
} finally { await browser.close(); }
