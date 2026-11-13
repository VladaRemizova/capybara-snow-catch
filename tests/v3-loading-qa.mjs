import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { WIN_LIGHTS } from '../dist/v3/promo-art.mjs';
import { STORAGE_KEY } from '../dist/v3/prizes.mjs';

const browser = await chromium.launch({ headless: true, executablePath: process.env.CAPY_CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 375, height: 672 }, deviceScaleFactor: 2 });
const page = await context.newPage(), errors = [], delayed = [];
const output = '/workspace/scratch/v3-loading-qa';
await mkdir(output, { recursive: true });
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
let release;
const gate = new Promise(resolve => { release = resolve; });
await page.route(/\/v3\/assets\/pixel\/(roulette-bg|reel-(coffee|hotdog|points)-composite)\.webp/, async route => {
  delayed.push(route.request().url());
  await gate;
  await route.continue();
});
await page.route('**/v3/main.mjs*', async route => route.fulfill({ contentType: 'application/javascript', body: await readFile(new URL('../dist/v3/main.mjs', import.meta.url), 'utf8') + '\nwindow.qa={game,async settle(coins){game.coins=coins;await finishRound();}};' }));
await page.addInitScript(() => {
  window.reelEntries = [];
  new MutationObserver(records => {
    if (!records.some(record => record.target.id === 'roulette-screen' && record.attributeName === 'hidden')) return;
    const screen = document.querySelector('#roulette-screen');
    if (!screen || screen.hidden) return;
    window.reelEntries.push({ decoded: [...screen.querySelectorAll('img')].every(img => img.complete && img.naturalWidth > 0), count: screen.querySelectorAll('.reel-prize').length });
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
});
await page.clock.install({ time: new Date('2026-11-13T12:00:00Z') });
await page.clock.pauseAt(new Date('2026-11-13T12:00:01Z'));
const tick = ms => page.clock.runFor(ms);
try {
  await page.goto('http://127.0.0.1:8080/v3/', { waitUntil: 'domcontentloaded' });
  await page.click('#play-button'); await page.click('#teaching-dismiss'); await tick(500);
  await page.evaluate(() => qa.settle(30)); await tick(600);
  await page.click('#result-claim'); await tick(200);
  assert.ok(delayed.length >= 4);
  assert.equal(await page.locator('#result-layer').isVisible(), true);
  assert.equal(await page.locator('#roulette-screen').isVisible(), false);
  assert.deepEqual(await page.evaluate(() => window.reelEntries), []);
  release();
  await page.locator('#roulette-screen').waitFor({ state: 'visible' });
  assert.deepEqual(await page.evaluate(() => window.reelEntries), [{ decoded: true, count: 39 }]);
  await page.screenshot({ path: `${output}/roulette-first-frame.png` });
  await page.click('#spin-button'); await tick(9600);
  await page.locator('#win-art.layers-ready').waitFor({ state: 'visible' });
  const id = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).lastWin.prizeId, STORAGE_KEY);
  assert.deepEqual(await page.locator('.win-prize-glow').evaluateAll(imgs => imgs.map(img => img.dataset.nodeId)), WIN_LIGHTS[id].map(light => light.id));
  assert.equal(await page.locator('.win-native-art').count(), 0);
  for (const time of [80, 220, 450, 1000]) {
    await page.locator('#win-art').evaluate((art, time) => {
      for (const animation of art.getAnimations({ subtree: true })) { animation.pause(); animation.currentTime = time; }
    }, time);
    for (const selector of ['#win-art', '#win-layers']) {
      assert.deepEqual(await page.locator(selector).evaluate(node => { const s = getComputedStyle(node); return [s.transform, s.scale, s.opacity, s.isolation]; }), ['none', 'none', '1', 'auto']);
    }
    await page.screenshot({ path: `${output}/win-${time}.png` });
  }
  await page.click('#win-next'); await page.locator('#roulette-screen').waitFor({ state: 'visible' });
  const entries = await page.evaluate(() => window.reelEntries);
  assert.equal(entries.length, 2); assert.ok(entries.every(entry => entry.decoded && entry.count === 39));
  assert.equal(await page.locator('.reel-prize[data-index="0"]').getAttribute('data-prize'), id);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ delayedAssets: delayed.length, previousResultStaysVisible: true, decodedReelOnEveryEntry: true, nativeFrame97Lights: id, noIsolatedWhiteFlash: true, errors }, null, 2));
} finally { release(); await browser.close(); }
