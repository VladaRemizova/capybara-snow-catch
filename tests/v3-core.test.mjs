import test from 'node:test';
import assert from 'node:assert/strict';
import { CatchGame, touchesCharacter } from '../dist/v3/game-core.mjs';
import { PrizeLedger, SPIN_MS } from '../dist/v3/prizes.mjs';

const x=187.5,y=436;
test('v3 contacts at either side of the visible body and at the hat are collected in every pose',()=>{
 for(const pose of ['open','left','right']){
  for(const dx of [-90,90])assert.equal(touchesCharacter('coffee',x+dx,y+150,y+150,x,x,y,pose),true);
  assert.equal(touchesCharacter('sandwich',x,y,y,x,x,y,pose),true);
 }
});
test('v3 transparent item corners and clear space beside or below the character do not count',()=>{
 assert.equal(touchesCharacter('coffee',x+120,y+150,y+150,x,x,y),false);
 assert.equal(touchesCharacter('coffee',x,y+270,y+270,x,x,y),false);
 assert.equal(touchesCharacter('red',x+170,y+120,y+120,x,x,y),false);
});
test('v3 a grazing body contact awards once without waiting for the sack rim',()=>{
 const g=new CatchGame();g.start();g.nextSpawn=100;
 g.objects=[{id:91,kind:'coffee',value:1,x:g.characterX+90,y:g.characterY+150}];
 assert.equal(g.advanceTo(.016).filter(e=>e.type==='catch').length,1);
 assert.equal(g.coins,1);assert.equal(g.objects.length,0);
 assert.equal(g.advanceTo(.032).filter(e=>e.type==='catch').length,0);
});
test('v3 a fast lateral pass collects an object between the two rendered positions',()=>{
 const g=new CatchGame();g.start();g.nextSpawn=100;g.characterX=g.catchSampleX=66;
 assert.equal(g.beginDrag(1,66,g.characterY+60),true);
 g.objects=[{id:92,kind:'coffee',value:1,x:187.5,y:g.characterY+120}];
 g.drag(1,309);assert.equal(g.advanceTo(.016).filter(e=>e.type==='catch').length,1);assert.equal(g.coins,1);
});
test('v3 head-direction changes keep body contacts active, including red-token value and reward threshold',()=>{
 for(const direction of [-1,1]){
  const g=new CatchGame();g.start(9);g.nextSpawn=100;
  g.beginDrag(1,g.characterX,g.characterY+60);g.drag(1,g.characterX+direction*16);
  g.objects=[{id:93,kind:'red',value:2,x:g.characterX,y:g.characterY+10}];
  const events=g.advanceTo(.016);assert.equal(g.pose,direction<0?'left':'right');assert.equal(g.coins,2);
  assert.equal(events.filter(e=>e.type==='catch').length,1);assert.equal(events.find(e=>e.type==='reward').rewards,1);
 }
});
test('v3 paused and suspended-tab frames cannot collect objects',()=>{
 const g=new CatchGame();g.start();g.objects=[{id:94,kind:'coffee',value:1,x:g.characterX,y:g.characterY+150}];
 g.pause();assert.deepEqual(g.advanceTo(.2),[]);assert.equal(g.coins,0);
 g.resume();g.advanceTo(2);assert.equal(g.coins,0);assert.equal(g.objects.length,0);
});
test('v3 ranking rounds accumulate coins while keeping the three already claimed daily prizes',()=>{
 const now=Date.parse('2026-11-13T12:00:00Z'),l=new PrizeLedger(null,now,()=>.25);l.commitRound('first',30,now);
 let time=now;for(let n=0;n<3;n++){l.startSpin(time);time+=SPIN_MS;l.finishSpin(time);l.acknowledgeWin();}
 const prizes=structuredClone(l.state.prizes);
 l.commitRound('ranking-1',24,time);assert.equal(l.state.coins,54);assert.equal(l.state.pending.length,0);
 const g=new CatchGame();g.start(l.state.coins);assert.equal(g.baseCoins,54);assert.equal(g.progress.rewards,3);
 l.commitRound('ranking-2',7,time);assert.equal(l.state.coins,61);assert.equal(l.state.earned,3);assert.equal(l.state.pending.length,0);assert.deepEqual(l.state.prizes,prizes);
});
