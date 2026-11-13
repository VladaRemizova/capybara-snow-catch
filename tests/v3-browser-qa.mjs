import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PrizeLedger, STORAGE_KEY, PRIZES } from '../dist/v3/prizes.mjs';
import { PrizeLedger as OldLedger, STORAGE_KEY as OLD_KEY } from '../dist/v2/prizes.mjs';
import { ITEM_CONTACTS } from '../dist/v3/collision-shapes.mjs';
import { BAG_OPENING } from '../dist/v3/game-core.mjs';
import { REEL_ART, PROMO_ART, WIN_LIGHTS } from '../dist/v3/promo-art.mjs';

const now=Date.parse('2026-11-13T12:00:00Z');
const seed=new PrizeLedger(null,now,()=>.25);seed.commitRound('new-qa',30,now);
const old=new OldLedger(null,now,()=>.25);old.commitRound('old-qa',30,now);
const browser=await chromium.launch({headless:true,executablePath:process.env.CAPY_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:375,height:672},deviceScaleFactor:2});
const page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
page.on('request',r=>{if(r.url().includes('/v3/assets/pixel/win-overlay-glow.webp'))errors.push('Legacy win glow requested');});
// Fixtures are injected into this test response only, never into published code.
await page.route('**/v3/main.mjs*',async route=>route.fulfill({contentType:'application/javascript',body:await readFile(new URL('../dist/v3/main.mjs',import.meta.url),'utf8')+'\nwindow.qa={game,render,async settle(coins){game.coins=coins;await finishRound();}};'}));
const output=process.env.CAPY_QA_DIR||'/workspace/scratch/v3-qa';await mkdir(output,{recursive:true});
await page.addInitScript(({key,saved,oldKey,oldSaved})=>{
 if(!localStorage.getItem(key))localStorage.setItem(key,saved);
 if(!localStorage.getItem(oldKey))localStorage.setItem(oldKey,oldSaved);
},{key:STORAGE_KEY,saved:seed.serialize(),oldKey:OLD_KEY,oldSaved:old.serialize()});
await page.clock.install({time:new Date(now)});await page.clock.pauseAt(new Date(now+1000));
const tick=ms=>page.clock.runFor(ms);
const state=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),STORAGE_KEY);
const loaded=()=>page.locator('img').evaluateAll(imgs=>Promise.all(imgs.filter(n=>n.getBoundingClientRect().width>0).map(n=>n.decode())));
const animations=selector=>page.locator(selector).evaluate(n=>Promise.all(n.getAnimations({subtree:true}).filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));
const shot=name=>page.screenshot({path:`${output}/${name}.png`,animations:'allow'});
try{
 await page.goto(process.env.CAPY_URL||'http://127.0.0.1:8080/v3/');await page.locator('#entry-screen').waitFor({state:'visible'});
 await page.click('#play-button');await page.click('#teaching-dismiss');await tick(500);await page.evaluate(()=>qa.settle(0));await tick(600);await page.click('#result-claim');
 await page.locator('#roulette-screen:not(.win-underlay)').waitFor({state:'visible'});await loaded();
 assert.equal(await page.locator('#spin-count').textContent(),'1/3');
 assert.equal(await page.locator('.reel-light').count(),0);
 assert.equal(await page.locator('.reel-prize[data-index="0"] img').count(),1);
 assert.equal((await page.locator('.reel-window').boundingBox()).height,672);
 const center=await page.locator('.reel-prize[data-index="0"]').boundingBox();assert.equal(center.x,103);assert.equal(center.y,225);
 for(const id of Object.keys(PRIZES)){
  const item=page.locator(`.reel-prize[data-prize="${id}"]`).first();
  const layers=await item.locator('img').evaluateAll(imgs=>imgs.map(n=>({src:n.getAttribute('src'),x:parseFloat(n.style.left),y:parseFloat(n.style.top),w:parseFloat(n.style.width),h:parseFloat(n.style.height),blend:n.style.mixBlendMode})));
  assert.deepEqual(layers.map(n=>n.src),REEL_ART[id].map(n=>n.src));
  for(let i=0;i<layers.length;i++){const actual=layers[i],expected=REEL_ART[id][i];for(const [a,b] of [['x','x'],['y','y'],['w','width'],['h','height']])assert.ok(Math.abs(actual[a]-expected[b])<.001);if(expected.kind==='light')assert.equal(actual.blend,expected.blend);}
 }
 await shot('roulette-initial');
 const won=[];
 for(let n=0;n<3;n++){
  assert.equal(await page.locator('#spin-count').textContent(),`${n+1}/3`);
  if(n)assert.equal(await page.locator('.reel-prize[data-index="0"]').getAttribute('data-prize'),won.at(-1));
  await page.click('#spin-button');await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)).spin,STORAGE_KEY);await tick(100);
  await animations('#spin-counter');
  assert.equal((await page.locator('.reel-window').boundingBox()).height,672);
  assert.equal(await page.locator('#spin-counter').evaluate(n=>getComputedStyle(n).opacity),'0');
  assert.ok(await page.locator('#reel-track').evaluate(n=>parseFloat(n.style.top))<0);
  await tick(500);assert.ok(await page.locator('#reel-track').evaluate(n=>parseFloat(n.style.top))>0);
  if(!n)await shot('roulette-spinning');
  await tick(9000);await page.locator('#win-screen').waitFor({state:'visible'});
  const s=await state(),id=s.lastWin.prizeId;won.push(id);
  await page.waitForFunction(()=>document.querySelector('#win-art').classList.contains('layers-ready'));await loaded();await animations('#win-art');await animations('.win-description');
  assert.equal(await page.locator('#win-art').evaluate(n=>getComputedStyle(n).transform),'none');
  assert.equal(await page.locator('.win-overlay-art').count(),0);
  assert.equal(await page.locator('.win-native-art').count(),0);
  const winLights=await page.locator('.win-prize-glow').evaluateAll(imgs=>imgs.map(n=>({id:n.dataset.nodeId,src:n.getAttribute('src'),x:parseFloat(n.style.left),y:parseFloat(n.style.top),width:parseFloat(n.style.width),height:parseFloat(n.style.height),blend:getComputedStyle(n).mixBlendMode,loaded:n.complete&&n.naturalWidth>0})));
  assert.equal(winLights.length,WIN_LIGHTS[id].length);
  for(let i=0;i<winLights.length;i++){const actual=winLights[i],expected=WIN_LIGHTS[id][i];for(const key of ['id','src','blend'])assert.equal(actual[key],expected[key]);for(const key of ['x','y','width','height'])assert.ok(Math.abs(actual[key]-expected[key])<.001);assert.equal(actual.loaded,true);}
  assert.equal(await page.locator('#won-title').textContent(),PRIZES[id].title);
  assert.match(await page.locator('.win-prize-layer').last().getAttribute('src'),new RegExp(`win-${id}-art.webp$`));
  assert.equal(await page.locator('#win-saved-note').isVisible(),n<2);
  if(n<2){assert.equal(await page.locator('#win-saved-note').textContent(),'Приз сохранен в разделе Мои призы');const note=await page.locator('#win-saved-note').boundingBox();assert.equal(note.y,635);assert.equal(note.height,13);}
  await shot(`win-${id}`);await page.click('#win-next');
  if(n<2){await page.locator('#roulette-screen:not(.win-underlay)').waitFor({state:'visible'});await loaded();await animations('#spin-counter');assert.equal(await page.locator('#spin-counter').evaluate(n=>getComputedStyle(n).opacity),'1');}
 }
 assert.equal(new Set(won).size,3);await page.locator('#cabinet-screen').waitFor({state:'visible'});await loaded();await shot('cabinet');
 for(const id of Object.keys(PRIZES)){
  const card=page.locator(`.prize-ticket[data-prize="${id}"]`),a=PROMO_ART[`ticket-${id}-art`];
  assert.equal(await card.locator('h2').textContent(),PRIZES[id].cardTitle);
  assert.equal(await card.locator('.ticket-meta>span').first().textContent(),PRIZES[id].category);
  assert.equal(await card.locator('.prize-illustration img').getAttribute('src'),a.src);
  assert.equal(await card.locator('.code-copy').getAttribute('data-code'),PRIZES[id].code);
  assert.equal(await card.locator('.prize-illustration').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(255, 240, 242)');
  assert.equal((await card.locator('.prize-illustration').boundingBox()).width,86);
 }
 const header=await page.locator('.cabinet-header').boundingBox();await page.locator('#cabinet-scroll').evaluate(n=>n.scrollTop=200);
 assert.equal((await page.locator('.cabinet-header').boundingBox()).y,header.y);
 await page.locator('.ticket-activate').first().click();await page.locator('#coupon-screen').waitFor({state:'visible'});await loaded();await shot('coupon-top');
 assert.equal(await page.locator('.coupon-hero h2').textContent(),'«Золото» на 20 днейи 300 баллов');
 assert.match(await page.locator('.coupon-hero>img:not(.coupon-glow-art)').getAttribute('src'),/coupon-points-art.webp$/);
 assert.equal(await page.locator('.coupon-hero').evaluate(n=>getComputedStyle(n).overflow),'visible');
 const footer=await page.locator('.coupon-footer').boundingBox();await page.locator('#coupon-scroll').evaluate(n=>n.scrollTop=n.scrollHeight);await tick(100);
 assert.deepEqual(await page.locator('.coupon-footer').boundingBox(),footer);await shot('coupon-bottom');
 // Ranking replay keeps all claimed prizes and accumulates the next round's coins.
 await page.click('#coupon-back');await page.click('#cabinet-play');await page.click('#teaching-dismiss');await tick(500);
 await page.evaluate(()=>{qa.game.nextSpawn=100;qa.game.objects=[{id:901,kind:'coffee',value:1,x:qa.game.characterX+60,y:qa.game.characterY+150}];qa.render();});
 await tick(16);assert.equal(await page.locator('#coin-value').textContent(),'30');
 assert.equal(await page.locator('#falling-field img').count(),1);
 assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#falling-field')).zIndex > getComputedStyle(document.querySelector('#character-front')).zIndex),true);
 await shot('miss-in-front-of-body');
 await page.evaluate(({tip,mouth})=>{qa.game.objects=[{id:902,kind:'coffee',value:1,x:qa.game.characterX+mouth.x-tip.x,y:qa.game.catchY-tip.y-5}];qa.render();},{tip:ITEM_CONTACTS.coffee,mouth:BAG_OPENING});
 await tick(16);assert.equal(await page.locator('#coin-value').textContent(),'30');
 await shot('approaching-sack-opening');
 await tick(80);assert.equal(await page.locator('#coin-value').textContent(),'31');
 assert.equal(await page.locator('.caught-item').evaluate(n=>getComputedStyle(n).zIndex),'22');
 assert.equal(await page.locator('#falling-field img').count(),0);await shot('entering-sack-opening');
 await page.evaluate(()=>qa.settle(24));await tick(600);await animations('.result-card');
 assert.equal(await page.locator('.result-card').getAttribute('data-state'),'rating');
 assert.equal(await page.locator('#result-coins').textContent(),'54');
 assert.equal(await page.locator('#rating-replay').isVisible(),true);
 assert.equal(await page.locator('#rating-replay').textContent(),'Сыграть еще раз');
 assert.match(await page.locator('#rating-replay').evaluate(n=>n.style.backgroundImage),/button-rating-play-figma.webp/);
 await shot('rating-replay');const banked=await state();await page.click('#rating-replay');
 await page.locator('#teaching-layer').waitFor({state:'visible'});assert.equal((await state()).coins,54);assert.deepEqual((await state()).prizes,banked.prizes);
 await page.click('#teaching-dismiss');await tick(500);assert.equal(await page.locator('#coin-value').textContent(),'54');
 await page.evaluate(()=>qa.settle(7));await tick(600);assert.equal((await state()).coins,61);assert.equal((await state()).earned,3);assert.equal((await state()).pending.length,0);assert.deepEqual((await state()).prizes,banked.prizes);
 // A normal retry still discards the current attempt before the daily limit.
 await page.click('#admin-toggle');await page.click('#admin-next-day');await page.locator('#entry-screen').waitFor({state:'visible'});
 await page.click('#play-button');await page.click('#teaching-dismiss');await tick(500);await page.evaluate(()=>qa.settle(20));await tick(600);await animations('.result-card');
 assert.match(await page.locator('#result-replay').evaluate(n=>n.style.backgroundImage),/button-result-retry-figma.webp/);
 assert.equal(await page.locator('#result-replay').textContent(),'Попробовать еще раз');await shot('native-retry-button');
 await page.click('#result-replay');await page.locator('#teaching-layer').waitFor({state:'visible'});
 assert.equal((await state()).coins,61);assert.equal((await state()).dayCoins,0);assert.equal((await state()).earned,0);assert.equal((await state()).pending.length,0);assert.deepEqual((await state()).prizes,banked.prizes);
 assert.equal(await page.evaluate(key=>localStorage.getItem(key),OLD_KEY),old.serialize());
 // The existing version receives the same small note, with its old prize catalog intact.
 await page.goto('http://127.0.0.1:8080/v2/');await page.locator('#roulette-screen:not(.win-underlay)').waitFor({state:'visible'});
 for(let n=0;n<3;n++){
  await page.click('#spin-button');await tick(9600);await page.locator('#win-screen').waitFor({state:'visible'});await loaded();
  assert.equal(await page.locator('#win-saved-note').isVisible(),n<2);
  if(!n){await animations('#win-art');await animations('.win-description');await shot('v2-win-note');}
  await page.click('#win-next');
 }
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({won,combinedReelImages:true,legacyGlowRemoved:true,pinkCards:true,holeEntryOnly:true,missesInFront:true,cumulativeRankingCoins:61,nativeButtons:true,oldVersionNote:true,independentStorage:true,footerFixed:true,errors},null,2));
}finally{await browser.close();}
