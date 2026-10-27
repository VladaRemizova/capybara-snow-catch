// Uses the Chromium and Playwright installation supplied by the execution environment.
import { chromium } from '/opt/codex/cua_node/lib/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true, executablePath: '/usr/lib/chromium/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 375, height: 672 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install();
  await page.goto('http://127.0.0.1:8080', { waitUntil: 'networkidle' });
  await page.locator('#start-button').click();
  await page.clock.runFor(400);
  const cdp = await context.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  const characterX = () => page.locator('#character').evaluate(n => { const r = n.getBoundingClientRect(); return r.x + r.width / 2; });

  await touch('touchStart', 207.5, 580);
  assert.equal(await characterX(), 187.5, 'touching off-center must not move the character');
  await touch('touchMove', 260, 580);
  assert.equal(await characterX(), 240);
  await touch('touchEnd');
  await touch('touchStart', 40, 220);
  await touch('touchMove', 100, 220);
  await touch('touchEnd');
  assert.equal(await characterX(), 240, 'a touch away from the character must not re-grab it');
  await touch('touchStart', 260, 580);
  await touch('touchMove', 207.5, 580);
  await touch('touchEnd');
  assert.equal(await characterX(), 187.5);

  // Pause via rules and verify the visible timer does not lose game time.
  await page.locator('#help-button').click();
  const pausedTimer = await page.locator('#timer').textContent();
  await page.clock.runFor(2500);
  assert.equal(await page.locator('#timer').textContent(), pausedTimer);
  await page.getByRole('button', { name: 'Продолжить игру', exact: true }).click();

  await touch('touchStart', 187.5, 580);
  for (let step = 0; step < 615; step++) {
    if (!await page.locator('#modal-layer').isHidden()) break;
    const nextX = await page.locator('.falling-field img').evaluateAll(nodes => nodes
      .map(n => { const r = n.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })
      .filter(p => p.y < 550).sort((a, b) => b.y - a.y)[0]?.x);
    if (nextX !== undefined) await touch('touchMove', nextX, 580);
    await page.clock.runFor(100);
    if (step === 145) await page.screenshot({ path: '/workspace/sites/capybara-winter-demo/preview-game.png' });
  }
  assert.equal(await page.locator('#timer').textContent(), '00:00');
  const finalCoins = Number(await page.locator('#coins').textContent());
  assert.ok(finalCoins > 40, `expected a perfect play round above 40 coins, got ${finalCoins}`);
  assert.equal(await page.locator('#rewards').textContent(), '3/3');
  assert.equal(await page.locator('#total-rewards').textContent(), '3');
  assert.ok((await page.locator('#modal-title').textContent()).includes(String(finalCoins)));
  await page.screenshot({ path: '/workspace/sites/capybara-winter-demo/preview-result.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Мои награды (3)', exact: true }).click();
  assert.equal(await page.locator('.reward-card.earned').count(), 3);
  await page.getByRole('button', { name: 'Понятно', exact: true }).click();
  await page.getByRole('button', { name: 'Сыграть ещё', exact: true }).click();
  assert.equal(await page.locator('#timer').textContent(), '01:00');
  assert.equal(await page.locator('#coins').textContent(), '0');
  assert.equal(await page.locator('#rewards').textContent(), '0/3');
  await page.locator('#sound-button').click();
  assert.equal(await page.locator('#sound-button').getAttribute('aria-pressed'), 'true');
  await page.locator('#sound-button').click();
  assert.equal(await page.locator('#sound-button').getAttribute('aria-pressed'), 'false');
  assert.deepEqual(errors, []);

  const viewportChecks = [];
  for (const [width, height] of [[320, 568], [390, 844], [430, 932], [1440, 900]]) {
    const viewport = await browser.newPage({ viewport: { width, height } });
    viewport.on('pageerror', error => errors.push(error.message));
    await viewport.clock.install();
    await viewport.goto('http://127.0.0.1:8080', { waitUntil: 'networkidle' });
    const layout = await viewport.evaluate(() => {
      const modal = document.getElementById('modal').getBoundingClientRect();
      return { width: document.documentElement.scrollWidth, modalTop: modal.top, modalBottom: modal.bottom, height: innerHeight };
    });
    assert.ok(layout.width <= width, `horizontal overflow at ${width}`);
    assert.ok(layout.modalTop >= 0 && layout.modalBottom <= layout.height, `modal overflow at ${width}x${height}`);
    await viewport.locator('#start-button').click();
    await viewport.clock.fastForward(61000);
    const resultLayout = await viewport.locator('#modal').evaluate(node => {
      const r = node.getBoundingClientRect(), art = node.querySelector('.modal-art').getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, artTop: art.top };
    });
    assert.ok(resultLayout.top >= 0 && resultLayout.bottom <= height && resultLayout.artTop >= 0, `result popup overflow at ${width}x${height}`);
    viewportChecks.push({ width, height, ...layout, result: resultLayout });
    if (width === 390) await viewport.screenshot({ path: '/workspace/sites/capybara-winter-demo/preview-holiday-result.png', animations: 'disabled' });
    await viewport.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ touchRegrab: 'passed', fullRound: 'passed', finalCoins, rewards: 3, restart: 'passed', pause: 'passed', sound: 'passed', errors, viewportChecks }, null, 2));
} finally { await browser.close(); }
