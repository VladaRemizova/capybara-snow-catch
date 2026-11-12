import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, executablePath: process.env.CAPY_CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
const output = process.env.CAPY_QA_DIR || '/tmp/capy-v2-qa';
await mkdir(output, { recursive: true });
const context = await browser.newContext({ viewport: { width: 375, height: 672 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors = []; page.on('pageerror', error => errors.push(error.message));
const url = process.env.CAPY_URL || 'http://127.0.0.1:8080/v2/';
await page.clock.install({ time: new Date('2026-11-12T12:00:00Z') });
await page.clock.pauseAt(new Date('2026-11-12T12:00:01Z'));
const tick = async ms => { await page.clock.runFor(ms); };
const visible = id => page.locator(id).isVisible();
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('capybara-snow-catch-v2')));
const shot = name => page.screenshot({ path: `${output}/${name}.png`, animations: 'disabled' });
await page.goto(url);
await page.evaluate(() => Promise.all([...document.images].map(img => img.decode().catch(() => {}))));
assert.equal(await page.locator('.character img').evaluateAll(images => images.every(img => getComputedStyle(img).transitionProperty === 'none')), true);
await shot('entry');
await page.click('#entry-prizes'); assert.equal(await page.locator('.prize-ticket').count(), 0);
assert.equal(await page.locator('.empty-ticket').count(), 1); await shot('empty');
await page.click('#cabinet-play');
await tick(6000); assert.equal(await visible('#teaching-layer'), true);
assert.equal(await page.locator('#time-value').textContent(), '01:00');
assert.equal(await page.locator('#falling-field img').count(), 0);
await shot('teaching');
await page.click('#teaching-dismiss'); await tick(250);
await page.click('#help-button');
const pausedTime = await page.locator('#time-value').textContent();
await tick(4000); assert.equal(await page.locator('#time-value').textContent(), pausedTime);
await shot('help'); await page.click('#help-close');

let held = false, thirdSeen = false, rewardsSeen = 0, lastReward = '', bonusSeen = new Set();
for (let n = 0; n < 760; n++) {
  if (await visible('#result-layer')) break;
  if (await visible('#reward-layer')) {
    const message = await page.locator('#reward-message').innerText();
    if (message !== lastReward) { rewardsSeen++; lastReward = message; }
    assert.equal(await page.locator('#character').getAttribute('data-pose'), 'smile');
    await page.mouse.up(); held = false;
    if (await visible('#all-prizes-actions')) {
      thirdSeen = true; await shot('three-prizes');
      await page.click('#reward-continue');
    } else {
      const time = await page.locator('#time-value').textContent();
      const positions = await page.locator('#falling-field').innerHTML();
      await tick(2000);
      assert.equal(await page.locator('#time-value').textContent(), time);
      assert.equal(await page.locator('#falling-field').innerHTML(), positions);
      await tick(1100);
    }
    continue;
  }
  const snapshot = await page.evaluate(() => {
    const c = document.querySelector('#character');
    const x = parseFloat(c.style.left) + 74, y = parseFloat(c.style.top);
    const objects = [...document.querySelectorAll('#falling-field img')].map(img => {
      const matches = img.style.transform.match(/translate\(([-.\d]+)px,\s*([-.\d]+)px\)/);
      return { x: Number(matches[1]) + parseFloat(img.style.width) / 2,
        bottom: Number(matches[2]) + parseFloat(img.style.height) * .83,
        kind: img.dataset.kind, id: img.src + ':' + matches[1] + ':' + img.dataset.kind };
    }).filter(o => o.bottom < y + 113).sort((a, b) => b.bottom - a.bottom);
    return { x, y, target: objects[0] || null, bonus: objects.filter(o => o.kind === 'red') };
  });
  if (snapshot.bonus.length) bonusSeen.add(await page.locator('#time-value').textContent() > '00:40' ? 'early' : 'late');
  if (!held) { await page.mouse.move(snapshot.x, snapshot.y + 65); await page.mouse.down(); held = true; }
  if (snapshot.target) await page.mouse.move(snapshot.target.x, snapshot.y + 65);
  await tick(100);
}
await page.mouse.up();
await page.waitForFunction(() => !document.querySelector('#result-layer').hidden);
assert.ok(thirdSeen); assert.equal(rewardsSeen, 3); assert.ok(Number(await page.locator('#result-coins').textContent()) >= 30);
assert.equal((await state()).pending.length, 3); assert.equal(await page.locator('#result-replay').isDisabled(), true);
await shot('result');
await page.click('#result-claim'); await shot('roulette');
const expected = (await state()).pending[0].prizeId;
await page.click('#spin-button'); await tick(2500); await shot('spinning');
assert.equal(await page.locator('#spin-button').isDisabled(), true);
await page.reload(); await tick(7100);
await page.waitForFunction(() => !document.querySelector('#win-screen').hidden);
assert.equal((await state()).prizes[0].prizeId, expected); await shot('won');
for (let i = 0; i < 2; i++) {
  await page.click('#win-next'); await page.locator('#roulette-screen').waitFor({ state: 'visible' });
  await page.click('#spin-button'); await tick(9600);
  await page.waitForFunction(() => !document.querySelector('#win-screen').hidden);
}
const completed = await state();
assert.equal(completed.pending.length, 0); assert.equal(new Set(completed.prizes.map(p => p.prizeId)).size, 3);
assert.equal(await page.locator('#win-next').textContent(), 'Перейти в Мои призы');
await page.click('#win-next'); await page.locator('#cabinet-screen').waitFor({ state: 'visible' }); assert.equal(await page.locator('.prize-ticket').count(), 3); await shot('cabinet');
await page.locator('.ticket-activate').first().click();
assert.equal(await visible('#coupon-screen'), true); assert.equal(await page.locator('#activate-button').isDisabled(), true);
const initialButton = await page.locator('#activate-button').boundingBox();
await page.evaluate(() => document.querySelector('#coupon-scroll').scrollTop = 99999);
const finalButton = await page.locator('#activate-button').boundingBox();
assert.equal(Math.round(initialButton.y), Math.round(finalButton.y));
await shot('coupon-bottom');
await page.evaluate(() => document.querySelector('#coupon-scroll').scrollTop = 0); await shot('coupon');
await page.reload(); await page.click('#entry-prizes');
assert.equal(await page.locator('.prize-ticket').count(), 3);
assert.equal((await state()).earned, 3);

// Leaving through Home discards only this round's coins.
const banked = (await state()).coins;
await page.click('#cabinet-play'); await page.click('#teaching-dismiss'); await tick(250);
await tick(7000);
assert.ok(Number(await page.locator('#coin-value').textContent()) > banked);
await page.click('#game-home'); assert.equal(await visible('#entry-screen'), true);
assert.equal((await state()).coins, banked);

// An empty cabinet pauses the game, and a truly missed round has a disabled claim.
await page.evaluate(() => localStorage.removeItem('capybara-snow-catch-v2')); await page.reload();
await page.click('#play-button'); await page.click('#teaching-dismiss'); await tick(250);
await page.click('#game-prizes');
const cabinetTime = await page.locator('#time-value').textContent(); await tick(5000);
assert.equal(await page.locator('#time-value').textContent(), cabinetTime);
assert.equal(await page.locator('#cabinet-play').textContent(), 'Продолжить игру');
await page.click('#cabinet-play');
let char = await page.locator('#character').boundingBox();
await page.mouse.move(char.x + 74, char.y + 65); await page.mouse.down();
await page.mouse.move(130, char.y + 65); await page.mouse.up();
await tick(60100); await page.locator('#result-layer').waitFor({ state: 'visible' });
assert.equal(await page.locator('#result-coins').textContent(), '0');
assert.equal(await page.locator('#result-claim').isDisabled(), true);
assert.equal(await page.locator('#result-replay').isEnabled(), true); await shot('zero-result');

// A carried 9 coins plus the red token unlocks the first prize in the next round.
await page.evaluate(async () => {
  const { PrizeLedger } = await import('./prizes.mjs');
  const l = new PrizeLedger(null); l.commitRound('seed-completed-round', 9);
  localStorage.setItem('capybara-snow-catch-v2', l.serialize());
});
await page.reload(); await page.click('#play-button'); await page.click('#teaching-dismiss'); await tick(250);
await tick(7100); await page.locator('#reward-layer').waitFor({ state: 'visible' });
assert.equal(await page.locator('#coin-value').textContent(), '11');
await tick(3100);
char = await page.locator('#character').boundingBox();
await page.mouse.move(char.x + 74, char.y + 65); await page.mouse.down(); await page.mouse.move(130, char.y + 65); await page.mouse.up();
await tick(60000); await page.locator('#result-layer').waitFor({ state: 'visible' });
assert.equal((await state()).coins, 11); assert.equal((await state()).pending.length, 1);

for (const [width, height] of [[320, 568], [390, 844], [430, 932], [1440, 900]]) {
  await page.setViewportSize({ width, height });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const windowSize = await page.locator('#phone').boundingBox();
  assert.ok(Math.abs(windowSize.width - Math.min(width, 375)) < 1);
  assert.ok(Math.abs(windowSize.height - windowSize.width * 672 / 375) < 1);
  assert.equal(await page.locator('#scene').evaluate(n => n.style.height), '672px');
}

// Admin day travel resets only the daily limit; a full reset removes the whole v2 run.
await page.evaluate(winners => {
  const key = 'capybara-snow-catch-v2', saved = JSON.parse(localStorage.getItem(key));
  const yesterday = new Date(Date.parse(saved.day + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
  saved.prizes = winners.map(prize => ({ ...prize, id: 'previous-' + prize.id, day: yesterday }));
  localStorage.setItem(key, JSON.stringify(saved));
  localStorage.setItem('capybara-qa-unrelated', 'keep');
}, completed.prizes);
await page.reload(); await page.setViewportSize({ width: 375, height: 672 });
const beforeAdmin = await state();
await page.click('#admin-toggle');
await shot('admin');
await Promise.all([page.waitForEvent('load'), page.click('#admin-next-day')]);
const advanced = await state();
assert.equal(advanced.day, new Date(Date.parse(beforeAdmin.day + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10));
assert.equal(advanced.coins, 0); assert.equal(advanced.earned, 0);
assert.equal(advanced.prizes.length, 3); assert.equal(advanced.pending.length, 1);
assert.equal(await visible('#roulette-screen'), true);
await page.click('#admin-toggle');
await Promise.all([page.waitForEvent('load'), page.click('#admin-reset')]);
const reset = await state();
assert.equal(reset.coins, 0); assert.equal(reset.earned, 0); assert.equal(reset.pending.length, 0);
assert.equal(reset.prizes.length, 0); assert.equal(reset.spin, null); assert.equal(reset.lastWin, null);
assert.equal(reset.day, beforeAdmin.day); assert.equal(await visible('#entry-screen'), true);
assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('capybara-snow-catch-v2-demo-clock')).days), 0);
assert.equal(await page.evaluate(() => localStorage.getItem('capybara-qa-unrelated')), 'keep');
assert.deepEqual(errors, []);
console.log(JSON.stringify({ coins: completed.coins, rewardsSeen, prizes: completed.prizes.map(p => p.prizeId), resumedSpin: true, bonusSeen: [...bonusSeen], admin: ['next day preserves prizes and rotations', 'complete reset returns to entry'], viewports: 4, errors }, null, 2));
await browser.close();
