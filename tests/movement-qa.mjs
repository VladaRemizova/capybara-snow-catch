import { chromium } from '/opt/codex/cua_node/lib/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true, executablePath: '/usr/lib/chromium/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const context = await browser.newContext({ viewport: { width: 375, height: 672 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.clock.install({ time: new Date('2026-10-28T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-28T00:00:01Z'));
  await page.goto('http://127.0.0.1:8080', { waitUntil: 'networkidle' });
  await page.locator('#start-button').dispatchEvent('click');
  await page.clock.runFor(450);
  const cdp = await context.newCDPSession(page);
  const touch = async (type, x, y = 580) => {
    await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    // Touchmove delivery also waits on the browser compositor, which uses real time.
    await new Promise(resolve => setTimeout(resolve, 40));
    await page.clock.runFor(16);
  };
  const pose = () => page.locator('#character').getAttribute('data-pose');
  const bag = () => page.locator('#scene').getAttribute('data-bag-open');
  const charX = () => page.locator('#character').evaluate(n => { const r = n.getBoundingClientRect(); return r.x + r.width / 2; });

  await touch('touchStart', 187.5);
  for (const x of [190, 184, 193, 181]) {
    await touch('touchMove', x);
    assert.equal(await pose(), 'open', 'small aiming corrections must keep the sack open');
    assert.equal(await charX(), x);
  }
  await touch('touchMove', 150);
  assert.equal(await pose(), 'left'); assert.equal(await bag(), 'false');
  assert.equal(await page.locator('#character-front').evaluate(n => getComputedStyle(n).visibility), 'hidden');
  await page.screenshot({ path: '/workspace/sites/capybara-winter-demo/preview-pose-left.png', animations: 'disabled' });
  await touch('touchMove', 250);
  assert.equal(await pose(), 'right');
  await touch('touchMove', 246);
  assert.equal(await pose(), 'right', 'a small reversal must not flip the pose');
  await page.screenshot({ path: '/workspace/sites/capybara-winter-demo/preview-pose-right.png', animations: 'disabled' });
  await page.clock.runFor(50);
  assert.equal(await pose(), 'open'); assert.equal(await bag(), 'true');
  assert.equal(await page.locator('#character .capy-image[data-pose="open"]').evaluate(n => getComputedStyle(n).transitionDuration), '0s');
  assert.ok(await page.locator('#scene').evaluate(n => n.classList.contains('dragging')));
  await touch('touchMove', 187.5);
  assert.equal(await pose(), 'left');
  await touch('touchEnd');
  assert.equal(await pose(), 'open');

  // The first tutorial item reaches the sack at about six seconds. Keep moving
  // throughout that crossing, with the finger and item inside the catching lane.
  await page.clock.runFor(4700);
  await touch('touchStart', 187.5);
  for (let i = 0; i < 70; i++) {
    await touch('touchMove', 187.5 + (i % 2 ? -14 : 14));
    await page.clock.runFor(16);
  }
  assert.equal(await page.locator('#coins').textContent(), '0', 'the closed sack must miss the first item');
  assert.equal(await bag(), 'false');
  await touch('touchEnd');
  assert.equal(await pose(), 'open');

  // Move to the next lane and stop without lifting the finger. The next item
  // must be caught with the held finger and open sack.
  const currentX = await charX();
  await touch('touchStart', currentX);
  await touch('touchMove', 78.5);
  assert.equal(await pose(), 'left');
  await page.clock.runFor(120);
  assert.equal(await pose(), 'open');
  for (let i = 0; i < 140 && await page.locator('#coins').textContent() === '0'; i++) await page.clock.runFor(100);
  assert.equal(await page.locator('#coins').textContent(), '1', 'stopping with a held finger must allow catching');
  assert.ok(await page.locator('#scene').evaluate(n => n.classList.contains('dragging')));
  assert.equal(await bag(), 'true');
  await page.screenshot({ path: '/workspace/sites/capybara-winter-demo/preview-pose-open.png', animations: 'disabled' });
  await touch('touchEnd');
  await touch('touchStart', 330, 280);
  await touch('touchMove', 280, 280);
  assert.equal(await charX(), 78.5, 'touching outside the character must not re-grab it');
  await touch('touchEnd');

  const assets = await page.locator('#character .capy-image').evaluateAll(images => images.map(n => {
    const r = n.getBoundingClientRect();
    return { pose: n.dataset.pose, loaded: n.complete && n.naturalWidth > 0, width: r.width, height: r.height, source: n.getAttribute('src') };
  }));
  assert.ok(assets.every(a => a.loaded && a.width === 185 && a.height === 222));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ left: 'passed', right: 'passed', aimingSafeZone: 'passed', reversalSafeZone: 'passed', fastOpenWhileHeld: 'passed', immediateOpenVisual: 'passed', release: 'passed', closedSackMiss: 'passed', openSackCatch: 'passed', regrab: 'passed', assets, errors }, null, 2));
} finally { await browser.close(); }
