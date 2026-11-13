import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PrizeLedger } from '../dist/v2/prizes.mjs';

const now = Date.parse('2026-11-13T12:00:00Z');
const ledger = new PrizeLedger(null, now);
ledger.state.order = ['rossko10', 'rossko5', 'hoff'];
ledger.commitRound('roulette-regression', 30, now);
const browser = await chromium.launch({ headless: true, executablePath: process.env.CAPY_CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 375, height: 672 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()}: ${r.url()}`); });
await page.addInitScript(saved => { if (!localStorage.getItem('capybara-snow-catch-v2')) localStorage.setItem('capybara-snow-catch-v2', saved); }, ledger.serialize());
await page.clock.install({ time: new Date(now) }); await page.clock.pauseAt(new Date(now + 1000));
const url = process.env.CAPY_URL || 'http://127.0.0.1:8080/v2/';
await page.goto(url);
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('capybara-snow-catch-v2')));
const output = process.env.CAPY_QA_DIR || '/tmp/capy-roulette-qa'; await mkdir(output, { recursive: true });
async function checkIdle(center, counter) {
  await page.locator('#roulette-screen').waitFor({ state: 'visible' });
  await page.locator('#reel-track img').evaluateAll(imgs => Promise.all(imgs.map(img => img.decode())));
  const snapshot = await page.evaluate(() => {
    const viewport = document.querySelector('.reel-window').getBoundingClientRect();
    const slots = [...document.querySelectorAll('.reel-prize:not(.extra)')].map(node => {
      const b = node.getBoundingClientRect();
      return { id: node.dataset.prize, visible: b.top >= viewport.top - 1 && b.bottom <= viewport.bottom + 1 };
    });
    const css = getComputedStyle(document.querySelector('.reel-window'));
    return { slots, center: document.querySelector('.reel-prize[data-index="0"]').dataset.prize,
      mask: css.maskImage, webkitMask: css.webkitMaskImage, filter: css.filter };
  });
  assert.equal(snapshot.slots.length, 3);
  assert.equal(snapshot.slots.every(slot => slot.visible), true, 'Every idle prize must intersect the visible reel, including after a previous spin');
  assert.equal(new Set(snapshot.slots.map(s => s.id)).size, 3);
  assert.equal(snapshot.center, center);
  assert.equal(snapshot.mask, 'none'); assert.equal(snapshot.webkitMask, 'none'); assert.equal(snapshot.filter, 'none');
  await page.locator('#spin-counter').evaluate(node => Promise.all(node.getAnimations().map(a => a.finished)));
  assert.equal(await page.locator('#spin-counter').evaluate(n => getComputedStyle(n).opacity), '1');
  assert.equal(await page.locator('#spin-count').textContent(), counter);
}
let previous = 'hoff';
for (let spin = 0; spin < 3; spin++) {
  await checkIdle(previous, `${spin + 1}/3`);
  await page.screenshot({ path: `${output}/idle-${spin + 1}.png`, animations: 'disabled' });
  const expected = (await state()).pending[0].prizeId;
  await page.click('#spin-button'); await page.waitForFunction(() => JSON.parse(localStorage.getItem('capybara-snow-catch-v2')).spin);
  await page.clock.runFor(1000);
  await page.locator('#spin-counter').evaluate(n => Promise.all(n.getAnimations().map(a => a.finished)));
  assert.equal(await page.locator('#spin-counter').evaluate(n => getComputedStyle(n).opacity), '0');
  assert.equal(await page.locator('.reel-light').first().evaluate(n => getComputedStyle(n).mixBlendMode), 'overlay');
  assert.equal(await page.locator('#reel-track').evaluate(n => getComputedStyle(n).transform), 'none');
  await page.clock.runFor(8600); await page.locator('#win-screen').waitFor({ state: 'visible' });
  const won = (await state()).prizes.at(-1).prizeId;
  assert.equal(won, expected); previous = won;
  await page.clock.runFor(1200);
  await page.click('#win-next');
}
await page.locator('#cabinet-screen').waitFor({ state: 'visible' });
assert.equal(new Set((await state()).prizes.map(p => p.prizeId)).size, 3);

const rewardPage = await browser.newPage({ viewport: { width: 375, height: 672 }, deviceScaleFactor: 2 });
rewardPage.on('pageerror', e => errors.push(e.message));
await rewardPage.route('**/v2/main.mjs*', async route => route.fulfill({ contentType: 'application/javascript', body: await readFile(new URL('../dist/v2/main.mjs', import.meta.url), 'utf8') + `\nwindow.rewardFixture = count => { clearRewardTimers(); game.start((count-1)*10); game.coins=10; game.pause(); rewardBusy=true; smile=true; showScreen('game'); showReward(count); };` }));
await rewardPage.clock.install({ time: new Date(now) }); await rewardPage.clock.pauseAt(new Date(now + 1000));
await rewardPage.goto(url); await rewardPage.waitForFunction(() => window.rewardFixture);
await rewardPage.evaluate(() => rewardFixture(1));
await rewardPage.locator('.reward-composition').evaluate(n => Promise.all(n.getAnimations().map(a => a.finished)));
const particle = rewardPage.locator('#reward-confetti img[src$="confetti-12.svg"]');
const yAt = t => particle.evaluate((n, t) => { const a = n.getAnimations()[0]; a.pause(); a.currentTime = t; return n.getBoundingClientRect().y; }, t);
const apex = await yAt(550), fallen = await yAt(1200);
assert.ok(fallen > apex + 50, 'The burst must fall after spreading outward');
assert.ok(Math.abs(await yAt(1600) - await yAt(2600)) < .1, 'Confetti must stop after landing');
await rewardPage.clock.runFor(500);
assert.equal(await rewardPage.locator('#time-value').textContent(), '01:00');
await rewardPage.locator('#reward-layer').click({ position: { x: 20, y: 350 } }); await rewardPage.clock.runFor(250);
assert.equal(await rewardPage.locator('#reward-layer').isVisible(), false);
for (const count of [2, 3]) {
  await rewardPage.evaluate(n => rewardFixture(n), count); await rewardPage.clock.runFor(500);
  await rewardPage.locator('#reward-layer').click({ position: { x: 20, y: 350 } }); await rewardPage.clock.runFor(250);
  assert.equal(await rewardPage.locator('#reward-layer').isVisible(), false);
}
assert.deepEqual(errors, []);
console.log(JSON.stringify({ spins: 3, idleCenters: ['hoff','rossko10','rossko5'], visiblePrizesAfterEachReturn: 3, masks: 'none', nativeOverlayLights: true, counter: 'visible only while idle', earlyRewardDismiss: [1,2,3], finiteConfettiFall: true, errors }, null, 2));
await browser.close();
