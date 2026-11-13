import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PrizeLedger, STORAGE_KEY, PRIZES } from '../dist/v3/prizes.mjs';
import { PrizeLedger as OldLedger, STORAGE_KEY as OLD_KEY } from '../dist/v2/prizes.mjs';
import { REEL_ART, PROMO_ART } from '../dist/v3/promo-art.mjs';

const now=Date.parse('2026-11-13T12:00:00Z');
const seed=new PrizeLedger(null,now,()=>.25);seed.commitRound('new-qa',30,now);
const old=new OldLedger(null,now,()=>.25);old.commitRound('old-qa',30,now);
const browser=await chromium.launch({headless:true,executablePath:process.env.CAPY_CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:375,height:672},deviceScaleFactor:2});
const page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
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
 await page.goto(process.env.CAPY_URL||'http://127.0.0.1:8080/v3/');await page.locator('#roulette-screen').waitFor({state:'visible'});await loaded();
 assert.equal(await page.locator('#spin-count').textContent(),'1/3');
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
  assert.equal(await page.locator('#spin-counter').evaluate(n=>getComputedStyle(n).opacity),'0');
  assert.ok(await page.locator('#reel-track').evaluate(n=>parseFloat(n.style.top))<0);
  await tick(500);assert.ok(await page.locator('#reel-track').evaluate(n=>parseFloat(n.style.top))>0);
  if(!n)await shot('roulette-spinning');
  await tick(9000);await page.locator('#win-screen').waitFor({state:'visible'});
  const s=await state(),id=s.lastWin.prizeId;won.push(id);
  await page.waitForFunction(()=>document.querySelector('#win-art').classList.contains('layers-ready'));await loaded();await animations('#win-art');await animations('.win-description');
  assert.equal(await page.locator('#win-art').evaluate(n=>getComputedStyle(n).transform),'none');
  assert.equal(await page.locator('#won-title').textContent(),PRIZES[id].title);
  assert.match(await page.locator('.win-prize-layer').last().getAttribute('src'),new RegExp(`win-${id}-art.webp$`));
  assert.equal(await page.locator('#win-saved-note').isVisible(),n<2);
  if(n<2){assert.equal(await page.locator('#win-saved-note').textContent(),'Приз сохранен в разделе Мои призы');const note=await page.locator('#win-saved-note').boundingBox();assert.equal(note.y,635);assert.equal(note.height,13);}
  await shot(`win-${id}`);await page.click('#win-next');
  if(n<2){await page.locator('#roulette-screen').waitFor({state:'visible'});await loaded();assert.equal(await page.locator('#spin-counter').evaluate(n=>getComputedStyle(n).opacity),'1');}
 }
 assert.equal(new Set(won).size,3);await page.locator('#cabinet-screen').waitFor({state:'visible'});await loaded();await shot('cabinet');
 for(const id of Object.keys(PRIZES)){
  const card=page.locator(`.prize-ticket[data-prize="${id}"]`),a=PROMO_ART[`ticket-${id}-art`];
  assert.equal(await card.locator('h2').textContent(),PRIZES[id].cardTitle);
  assert.equal(await card.locator('.ticket-meta>span').first().textContent(),PRIZES[id].category);
  assert.equal(await card.locator('.prize-illustration img').getAttribute('src'),a.src);
  assert.equal(await card.locator('.code-copy').getAttribute('data-code'),PRIZES[id].code);
 }
 const header=await page.locator('.cabinet-header').boundingBox();await page.locator('#cabinet-scroll').evaluate(n=>n.scrollTop=200);
 assert.equal((await page.locator('.cabinet-header').boundingBox()).y,header.y);
 await page.locator('.ticket-activate').first().click();await page.locator('#coupon-screen').waitFor({state:'visible'});await loaded();await shot('coupon-top');
 assert.equal(await page.locator('.coupon-hero h2').textContent(),'«Золото» на 20 днейи 300 баллов');
 assert.match(await page.locator('.coupon-hero>img:not(.coupon-glow-art)').getAttribute('src'),/coupon-points-art.webp$/);
 const footer=await page.locator('.coupon-footer').boundingBox();await page.locator('#coupon-scroll').evaluate(n=>n.scrollTop=n.scrollHeight);await tick(100);
 assert.deepEqual(await page.locator('.coupon-footer').boundingBox(),footer);await shot('coupon-bottom');
 assert.equal(await page.evaluate(key=>localStorage.getItem(key),OLD_KEY),old.serialize());
 // The existing version receives the same small note, with its old prize catalog intact.
 await page.goto('http://127.0.0.1:8080/v2/');await page.locator('#roulette-screen').waitFor({state:'visible'});
 for(let n=0;n<3;n++){
  await page.click('#spin-button');await tick(9600);await page.locator('#win-screen').waitFor({state:'visible'});await loaded();
  assert.equal(await page.locator('#win-saved-note').isVisible(),n<2);
  if(!n){await animations('#win-art');await animations('.win-description');await shot('v2-win-note');}
  await page.click('#win-next');
 }
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({won,newCatalog:true,oldVersionNote:true,independentStorage:true,footerFixed:true,errors},null,2));
}finally{await browser.close();}
