import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ headless: true, ...(process.env.CAPY_CHROMIUM_PATH ? { executablePath: process.env.CAPY_CHROMIUM_PATH } : {}), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 375, height: 672 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.clock.install({ time: new Date('2026-10-28T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-28T12:00:01Z'));
  await page.goto('http://127.0.0.1:8080', { waitUntil: 'networkidle' });
  assert.equal(await page.locator('#teaching-layer').isVisible(), true);
  assert.equal(await page.locator('#modal-layer').isHidden(), true);
  assert.equal(await page.locator('#start-button, #tutorial, #toast').count(), 0);
  const fingerX = () => page.locator('.gesture-finger').evaluate(n => n.getBoundingClientRect().x);
  await page.locator('.gesture-finger').evaluate(n => { const a=n.getAnimations()[0]; a.pause(); a.currentTime=0; });
  const initialFinger = await fingerX();
  await page.locator('.gesture-finger').evaluate(n => { n.getAnimations()[0].currentTime=1050; });
  await page.clock.runFor(1050);
  assert.ok(await fingerX() > initialFinger + 75, 'teaching finger should travel inside the track');
  assert.equal(await page.locator('#timer').textContent(), '01:00');
  await page.screenshot({ path: 'preview-new-teaching.png' });
  await page.clock.runFor(3500);
  assert.equal(await page.locator('#teaching-layer').isVisible(), true);
  assert.equal(await page.locator('#scene').getAttribute('data-state'), 'idle');
  assert.equal(await page.locator('#timer').textContent(), '01:00');
  await page.locator('#teaching-layer').tap({ position: { x: 20, y: 200 } });
  await page.clock.runFor(260);
  assert.equal(await page.locator('#teaching-layer').isHidden(), true);
  assert.equal(await page.locator('#scene').getAttribute('data-state'), 'running');
  assert.equal(await page.locator('#timer').textContent(), '01:00');
  const cdp = await context.newCDPSession(page);
  const touch = async (type, x, y = 580) => {
    await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    await new Promise(r => setTimeout(r, 20));
  };
  const characterX = () => page.locator('#character').evaluate(n => { const r = n.getBoundingClientRect(); return r.x + r.width / 2; });
  await touch('touchStart', 207.5); await touch('touchMove', 260); await page.clock.runFor(16);
  assert.equal(await characterX(), 240); await touch('touchEnd');
  await touch('touchStart', 40, 220); await touch('touchMove', 100, 220); await touch('touchEnd');
  assert.equal(await characterX(), 240);
  await touch('touchStart', 260); await touch('touchMove', 207.5); await touch('touchEnd');
  assert.equal(await characterX(), 187.5);
  await page.locator('#help-button').click();
  const pausedTimer = await page.locator('#timer').textContent();
  await page.clock.runFor(4000);
  assert.equal(await page.locator('#timer').textContent(), pausedTimer);
  await page.clock.runFor(500);
  assert.equal(await page.locator('#teaching-layer').isVisible(), true);
  await page.locator('#teaching-layer').tap();
  await page.clock.runFor(260);
  assert.equal(await page.locator('#teaching-layer').isHidden(), true);

  let rewardPauses = 0, switched = false;
  for (let step = 0; step < 650; step++) {
    if (!await page.locator('#prize-layer').isHidden()) {
      rewardPauses++;
      assert.equal(await page.locator('#prize-message').textContent(), `${rewardPauses} из 3 получена!`);
      assert.equal(await page.locator('#coins').textContent(), String([20,30,40][rewardPauses-1]));
      const frozenTimer = await page.locator('#timer').textContent();
      const frozenItems = await page.locator('#falling-field').innerHTML();
      await page.clock.runFor(1000);
      assert.equal(await page.locator('#timer').textContent(), frozenTimer);
      assert.equal(await page.locator('#falling-field').innerHTML(), frozenItems);
      assert.equal(await page.locator('#prize-layer').isVisible(), true);
      if (rewardPauses === 1) await page.screenshot({ path: 'preview-new-prize.png', animations: 'disabled' });
      await page.clock.runFor(1500);
      assert.equal(await page.locator('#prize-layer').isVisible(), true);
      await page.clock.runFor(650);
      assert.equal(await page.locator('#prize-layer').isHidden(), true);
      assert.equal(await page.locator('#scene').getAttribute('data-state'), 'running');
    }
    if (!await page.locator('#modal-layer').isHidden()) break;
    if (step > 200 && !switched) {
      const x = await characterX(); await page.locator('#variant-button').click(); switched = true;
      assert.equal(await characterX(), x);
      assert.equal(await page.locator('#scene').getAttribute('data-variant'), '2');
      await page.screenshot({ path: 'preview-new-variant2.png' });
    }
    const target = await page.locator('#falling-field img').evaluateAll(ns => ns.map(n => {
      const r = n.getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2 };
    }).filter(p=>p.y<550).sort((a,b)=>b.y-a.y)[0]?.x);
    if (target !== undefined) {
      await touch('touchStart', await characterX()); await touch('touchMove', target); await touch('touchEnd');
    }
    await page.clock.runFor(100);
    if (step===145) await page.screenshot({ path: 'preview-new-game.png' });
  }
  assert.equal(rewardPauses, 3);
  assert.equal(await page.locator('#timer').textContent(), '00:00');
  const finalCoins = Number(await page.locator('#coins').textContent());
  assert.ok(finalCoins>40, `expected more than 40 coins, got ${finalCoins}`);
  assert.equal(await page.locator('#rewards').textContent(), '3/3');
  assert.ok((await page.locator('#modal-title').textContent()).includes(String(finalCoins)));
  await page.clock.runFor(300);
  await page.screenshot({ path: 'preview-new-result.png', animations: 'disabled' });
  await page.getByRole('button', {name:'Открыть (3)',exact:true}).click();
  assert.equal(await page.locator('.reward-card.earned').count(),3);
  await page.getByRole('button',{name:'Понятно',exact:true}).click();
  await page.getByRole('button',{name:'Сыграть еще',exact:true}).click();
  assert.equal(await page.locator('#timer').textContent(),'01:00');
  assert.equal(await page.locator('#coins').textContent(),'0');
  assert.equal(await page.locator('#scene').getAttribute('data-variant'),'2');
  const viewportChecks=[];
  for(const [width,height] of [[320,568],[390,844],[430,932],[1440,900]]) {
    const p=await browser.newPage({viewport:{width,height}});p.on('pageerror',e=>errors.push(e.message));
    await p.clock.install();await p.goto('http://127.0.0.1:8080',{waitUntil:'networkidle'});
    await p.locator('#teaching-layer').click();await p.clock.runFor(260);await p.clock.fastForward(61000);await p.clock.runFor(350);
    const layout=await p.locator('#modal').evaluate(n=>{
      const r=n.getBoundingClientRect(),art=n.querySelector('.modal-art').getBoundingClientRect();
      const badge=document.getElementById('total-rewards').getBoundingClientRect(),parent=document.getElementById('rewards-button').getBoundingClientRect();
      return {top:r.top,bottom:r.bottom,artTop:art.top,overflow:document.documentElement.scrollWidth>innerWidth,badgeTop:badge.top-parent.top,badgeRight:parent.right-badge.right,badgeBottom:parent.bottom-badge.bottom};
    });
    assert.ok(!layout.overflow&&layout.artTop>=0&&layout.bottom<=height,`popup overflow at ${width}x${height}`);
    assert.ok(Math.abs(layout.badgeTop-layout.badgeBottom)<.1 && Math.abs(layout.badgeTop-layout.badgeRight)<.1);
    viewportChecks.push({width,height,...layout});await p.close();
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({onboarding:'passed',rewardPauses,finalCoins,switching:'passed',regrab:'passed',viewportChecks,errors},null,2));
}finally{await browser.close();}
