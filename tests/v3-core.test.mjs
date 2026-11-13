import test from 'node:test';
import assert from 'node:assert/strict';
import { CatchGame, BAG_OPENING, bagEntry } from '../dist/v3/game-core.mjs';
import { ITEM_CONTACTS } from '../dist/v3/collision-shapes.mjs';
import { PrizeLedger, SPIN_MS } from '../dist/v3/prizes.mjs';

const x = 187.5, y = 436, rim = y + BAG_OPENING.y;
const setup = () => { const g = new CatchGame(); g.start(); g.nextSpawn = 100; return g; };
function atOpening(g, kind = 'coffee', offset = 0, distance = .5) {
 const tip = ITEM_CONTACTS[kind];
 return { id: 91, kind, value: kind === 'red' ? 2 : 1,
  x: g.characterX + BAG_OPENING.x - tip.x + offset, y: g.catchY - tip.y - distance };
}

test('v3 every item reaches the actual sack opening before being collected once', () => {
 for (const kind of Object.keys(ITEM_CONTACTS)) {
  const g = setup(); g.objects = [atOpening(g, kind, 0, 5)];
  assert.equal(g.advanceTo(.016).some(e => e.type === 'catch'), false);
  const caught = g.advanceTo(.1).filter(e => e.type === 'catch');
  assert.equal(caught.length, 1); assert.equal(g.coins, kind === 'red' ? 2 : 1);
  assert.equal(caught[0].object.y + ITEM_CONTACTS[kind].y, g.catchY);
  assert.equal(g.objects.length, 0); assert.equal(g.advanceTo(.2).some(e => e.type === 'catch'), false);
 }
});
test('v3 visible item edges touching either edge of the opening are caught', () => {
 for (const kind of Object.keys(ITEM_CONTACTS)) {
  const item = ITEM_CONTACTS[kind], bottom = item.bands.at(-1);
  for (const [side, edge, tipEdge] of [['left', BAG_OPENING.x - BAG_OPENING.halfWidth, bottom[2]], ['right', BAG_OPENING.x + BAG_OPENING.halfWidth, bottom[0]]]) {
   const itemX = x + edge - tipEdge;
   const hit = bagEntry(kind, itemX, rim - item.y - 1, rim - item.y + 1, x, x, y);
   assert.notEqual(hit, null, `${kind}: ${side} edge touch`);
  }
  for (const itemX of [x + BAG_OPENING.x - BAG_OPENING.halfWidth - item.bounds[2] - 1, x + BAG_OPENING.x + BAG_OPENING.halfWidth - item.bounds[0] + 1]) {
   assert.equal(bagEntry(kind, itemX, rim - 80, rim + 80, x, x, y), null, `${kind}: clear space beside the opening`);
  }
 }
});
test('v3 a wider part of the silhouette can graze the rim after its lower tip misses', () => {
 assert.notEqual(bagEntry('coffee', x + 69, rim - 60, rim + 50, x, x, y), null);
 assert.equal(bagEntry('coffee', x + 71, rim - 60, rim + 50, x, x, y), null);
});
test('v3 head, body, and sideways contacts below the hole do not award coins', () => {
 for (const [dx, dy] of [[0, 10], [-90, 150], [90, 150], [0, 170]]) {
  const g = setup(); g.objects = [{ id: 92, kind: 'coffee', value: 1, x: x + dx, y: y + dy }];
  assert.equal(g.advanceTo(.016).some(e => e.type === 'catch'), false);
  assert.equal(g.coins, 0); assert.equal(g.objects.length, 1);
 }
});
test('v3 a missed item keeps falling and cannot be recovered from below the opening', () => {
 for (const direction of [-1, 1]) {
  const g = setup(); const item = atOpening(g, 'coffee', direction * 100);
  g.objects = [item]; const before = item.y;
  g.advanceTo(.016); assert.equal(g.coins, 0); assert.ok(item.y > before);
  for (const t of [.4, .8, 1.2, 1.6]) g.advanceTo(t);
  assert.ok(item.y + ITEM_CONTACTS.coffee.bounds[1] > g.catchY);
  g.beginDrag(1, x, y + 60); g.drag(1, x + direction * 100);
  assert.equal(g.advanceTo(1.616).some(e => e.type === 'catch'), false);
  assert.equal(g.coins, 0); assert.equal(g.objects[0].x, item.x);
  for (let t = 2; t < 6; t += .5) g.advanceTo(t);
  assert.equal(g.objects.length, 0); assert.equal(g.coins, 0);
 }
});
test('v3 catches use the moving sack position at the instant of downward entry', () => {
 const g = setup(); g.characterX = g.catchSampleX = 66;
 const tip = ITEM_CONTACTS.coffee;
 g.beginDrag(1, 66, y + 60);
 g.objects = [{ id: 93, kind: 'coffee', value: 1,
  x: x + BAG_OPENING.x - tip.x, y: g.catchY - tip.y - g.speed * .008 }];
 g.drag(1, 309); assert.equal(g.advanceTo(.016).some(e => e.type === 'catch'), true);
 assert.equal(g.coins, 1);
 // Arriving after the entire visible sprite passed below the hole is too late.
 assert.equal(bagEntry('coffee', x + BAG_OPENING.x - tip.x, rim + 44, rim + 46, 66, x, y), null);
});
test('v3 the sack catches in both moving poses, including two-point red tokens and reward thresholds', () => {
 for (const direction of [-1, 1]) {
  const g = setup(); g.baseCoins = 9;
  g.beginDrag(1, x, y + 60); g.drag(1, x + direction * 16);
  g.objects = [atOpening(g, 'red')]; const events = g.advanceTo(.016);
  assert.equal(g.pose, direction < 0 ? 'left' : 'right'); assert.equal(g.coins, 2);
  assert.equal(events.filter(e => e.type === 'catch').length, 1);
  assert.equal(events.find(e => e.type === 'reward').rewards, 1);
 }
});
test('v3 a fast frame still catches at the opening without overshooting the entry animation', () => {
 const g = setup(); g.objects = [atOpening(g, 'coffee', 0, 20)];
 const caught = g.advanceTo(.5).find(e => e.type === 'catch');
 assert.ok(caught); assert.equal(caught.object.y + ITEM_CONTACTS.coffee.y, g.catchY);
});
test('v3 paused and suspended-tab frames cannot collect objects', () => {
 const g = setup(); g.objects = [atOpening(g)];
 g.pause(); assert.deepEqual(g.advanceTo(.2), []); assert.equal(g.coins, 0);
 g.resume(); g.advanceTo(2); assert.equal(g.coins, 0); assert.equal(g.objects.length, 0);
});
test('v3 ranking rounds accumulate coins while keeping the three already claimed daily prizes',()=>{
 const now=Date.parse('2026-11-13T12:00:00Z'),l=new PrizeLedger(null,now,()=>.25);l.commitRound('first',30,now);
 let time=now;for(let n=0;n<3;n++){l.startSpin(time);time+=SPIN_MS;l.finishSpin(time);l.acknowledgeWin();}
 const prizes=structuredClone(l.state.prizes);
 l.commitRound('ranking-1',24,time);assert.equal(l.state.coins,54);assert.equal(l.state.pending.length,0);
 const g=new CatchGame();g.start(l.state.coins);assert.equal(g.baseCoins,54);assert.equal(g.progress.rewards,3);
 l.commitRound('ranking-2',7,time);assert.equal(l.state.coins,61);assert.equal(l.state.earned,3);assert.equal(l.state.pending.length,0);assert.deepEqual(l.state.prizes,prizes);
});
