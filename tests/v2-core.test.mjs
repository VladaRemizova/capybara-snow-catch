import test from 'node:test';
import assert from 'node:assert/strict';
import { CatchGame, rewardProgress, ITEM_SIZES } from '../dist/v2/game-core.mjs';
import { PrizeLedger, moscowDay, SPIN_MS } from '../dist/v2/prizes.mjs';
import { reelMotion } from '../dist/v2/roulette-motion.mjs';

const noon = Date.parse('2026-11-12T12:00:00Z');
const makeLedger = () => new PrizeLedger(null, noon, () => .25);

test('v2 prizes unlock at 10/20/30 with a new progress segment each time', () => {
  for (const [coins, rewards, fraction] of [[9, 0, .9], [10, 1, 0], [11, 1, .1], [20, 2, 0], [29, 2, .9], [30, 3, 1], [83, 3, 1]]) {
    const p = rewardProgress(coins); assert.equal(p.rewards, rewards); assert.equal(p.fraction, fraction);
  }
});
test('v2 paused rounds freeze time and objects', () => {
  const g = new CatchGame(); g.start(); g.advanceTo(.4); const objects = structuredClone(g.objects);
  g.pause(); assert.deepEqual(g.advanceTo(42), []); assert.equal(g.elapsed, .4); assert.deepEqual(g.objects, objects);
});
test('v2 a red token crossing the bag gives two coins, including while moving', () => {
  const g = new CatchGame(); g.start(9); g.beginDrag(1, g.characterX, g.characterY + 60); g.drag(1, g.characterX + 12);
  g.objects = [{ id: 20, kind: 'red', value: 2, x: g.characterX, y: g.catchY - ITEM_SIZES.red[1] * .33 - .1 }];
  const events = g.advanceTo(.02);
  assert.equal(g.coins, 2); assert.equal(g.bagOpen, true); assert.equal(events.find(e => e.type === 'reward').rewards, 1);
});
test('v2 only two red tokens spawn in a complete round, one early and one late', () => {
  const g = new CatchGame(); g.start(); const bonuses = [];
  for (let time = .02; time < 60; time += .02) {
    for (const event of g.advanceTo(time)) if (event.type === 'spawn' && event.object.kind === 'red') bonuses.push(g.elapsed);
  }
  assert.equal(bonuses.length, 2); assert.ok(bonuses[0] < 1); assert.ok(bonuses[1] >= 52 && bonuses[1] < 54);
});
test('v2 head deadzone and re-grabbing retain the original touch behavior', () => {
  const g = new CatchGame(); g.start(); assert.equal(g.beginDrag(1, 10, 300), false);
  assert.equal(g.beginDrag(1, g.characterX, g.characterY + 60), true);
  const x = g.characterX; g.drag(1, x + 5); assert.equal(g.pose, 'open');
  g.drag(1, x - 12); assert.equal(g.pose, 'left');
  g.release(); assert.equal(g.pose, 'open'); assert.equal(g.drag(1, 300), false);
});
test('v2 completed rounds accumulate coins and never grant more than three daily prizes', () => {
  const l = makeLedger(); assert.equal(l.commitRound('a', 9, noon).length, 0);
  assert.equal(l.commitRound('b', 1, noon).length, 1);
  assert.equal(l.commitRound('c', 100, noon).length, 2);
  l.commitRound('d', 100, noon); assert.equal(l.state.earned, 3); assert.equal(l.state.pending.length, 3);
  assert.equal(l.state.coins, 210);
});
test('v2 committing the same round twice cannot duplicate coins or prizes', () => {
  const l = makeLedger(); l.commitRound('same', 22, noon); l.commitRound('same', 22, noon);
  assert.equal(l.state.coins, 22); assert.equal(l.state.pending.length, 2);
});
test('v2 every daily prize is different across separate round settlements', () => {
  const l = makeLedger(); l.commitRound('a', 10, noon); l.commitRound('b', 10, noon); l.commitRound('c', 10, noon);
  assert.equal(new Set(l.state.pending.map(p => p.prizeId)).size, 3);
});
test('v2 the daily reset happens at midnight Moscow, preserving previous prizes', () => {
  const before = Date.parse('2026-11-12T20:59:59Z'), after = before + 1000;
  assert.equal(moscowDay(before), '2026-11-12'); assert.equal(moscowDay(after), '2026-11-13');
  const l = new PrizeLedger(null, before); l.commitRound('a', 30, before);
  l.startSpin(before); l.finishSpin(before + SPIN_MS); l.acknowledgeWin();
  l.refreshDay(after + SPIN_MS);
  assert.equal(l.state.coins, 0); assert.equal(l.state.earned, 0);
  assert.equal(l.state.prizes.length, 1); assert.equal(l.state.pending.length, 2);
});
test('v2 a spin is reserved once, completes after 9.5 seconds, and awards exactly once', () => {
  const l = makeLedger(); l.commitRound('a', 10, noon);
  const spin = l.startSpin(noon); assert.deepEqual(l.startSpin(noon + 100), spin);
  assert.equal(l.finishSpin(noon + SPIN_MS - 1), null); assert.equal(l.state.prizes.length, 0);
  const prize = l.finishSpin(noon + SPIN_MS); assert.ok(prize);
  assert.equal(l.finishSpin(noon + SPIN_MS + 1), null); assert.equal(l.state.prizes.length, 1);
});
test('v2 reload resumes the same spin without changing its chosen prize', () => {
  const first = makeLedger(); first.commitRound('a', 20, noon); first.startSpin(noon);
  const second = new PrizeLedger(JSON.parse(first.serialize()), noon + 2000);
  const expected = first.state.pending[0].prizeId;
  assert.equal(second.finishSpin(noon + SPIN_MS).prizeId, expected);
  assert.equal(second.state.pending.length, 1); assert.ok(second.locked);
  const third = new PrizeLedger(JSON.parse(second.serialize()), noon + SPIN_MS + 1);
  assert.equal(third.state.lastWin.prizeId, expected); assert.equal(third.state.prizes.length, 1);
});
test('v2 all won prizes are retained across a new day and another three draws', () => {
  const l = makeLedger(); l.commitRound('a', 30, noon);
  let time = noon;
  for (let i = 0; i < 3; i++) { l.startSpin(time); time += SPIN_MS; l.finishSpin(time); l.acknowledgeWin(); }
  assert.equal(l.locked, false);
  time = noon + 24 * 3600_000; l.commitRound('b', 30, time);
  assert.equal(l.state.pending.length, 3); assert.equal(l.state.prizes.length, 3);
});

test('v2 moving either way catches a token that has just passed the rim', () => {
  for (const direction of [-1, 1]) {
    const g = new CatchGame(); g.start();
    g.beginDrag(1, g.characterX, g.characterY + 60);
    const target = g.characterX + direction * 90;
    g.objects = [{ id: 90, kind: 'red', value: 2, x: target, y: g.catchY + 8 - ITEM_SIZES.red[1] * .33 }];
    g.drag(1, target);
    const events = g.advanceTo(.02);
    assert.equal(g.pose, direction < 0 ? 'left' : 'right');
    assert.equal(events.filter(e => e.type === 'catch').length, 1);
    assert.equal(g.coins, 2);
    assert.equal(g.advanceTo(.04).filter(e => e.type === 'catch').length, 0);
  }
});

test('v2 a fast lateral pass sweeps the open bag across the falling object', () => {
  const g = new CatchGame(); g.start(); g.characterX = 70; g.catchSampleX = 70;
  g.beginDrag(1, 70, g.characterY + 60);
  g.objects = [{ id: 90, kind: 'sandwich', value: 1, x: 187.5, y: g.catchY - ITEM_SIZES.sandwich[1] * .33 - .1 }];
  g.drag(1, 305);
  assert.equal(g.advanceTo(.02).filter(e => e.type === 'catch').length, 1);
});

test('v2 objects below the sack opening cannot be recovered by moving underneath', () => {
  const g = new CatchGame(); g.start(); g.beginDrag(1, g.characterX, g.characterY + 60);
  g.objects = [{ id: 90, kind: 'red', value: 2, x: 270, y: g.catchY + 40 - ITEM_SIZES.red[1] * .33 }];
  g.drag(1, 270); g.advanceTo(.02); assert.equal(g.coins, 0);
});

test('v2 replay discards the attempt coins and unclaimed prizes, including after storage reload', () => {
  for (const coins of [9, 10, 19, 20, 29]) {
    let l = makeLedger(); l.commitRound('first', coins, noon);
    const pending = l.state.pending.map(p => p.id);
    l = new PrizeLedger(JSON.parse(l.serialize()), noon);
    assert.equal(l.discardRound('first', noon), true);
    assert.equal(l.state.coins, 0); assert.equal(l.state.earned, 0); assert.deepEqual(l.state.pending, []);
    assert.equal(l.discardRound('first', noon), false);
    assert.deepEqual(l.commitRound('first', coins, noon), []);
    l.commitRound('second', 30, noon);
    assert.equal(l.state.coins, 30); assert.equal(l.state.earned, 3);
    assert.equal(l.state.pending.some(p => pending.includes(p.id)), false);
    assert.equal(new Set(l.state.pending.map(p => p.prizeId)).size, 3);
  }
});

test('v2 replay preserves earlier won prizes and their daily limit', () => {
  const l = makeLedger(); l.commitRound('won', 10, noon);
  l.startSpin(noon); l.finishSpin(noon + SPIN_MS); l.acknowledgeWin();
  const won = structuredClone(l.state.prizes);
  l.commitRound('retry', 15, noon);
  assert.equal(l.discardRound('retry', noon), true);
  assert.deepEqual(l.state.prizes, won); assert.equal(l.state.coins, 10);
  assert.equal(l.state.earned, 1); assert.equal(l.state.pending.length, 0);
  l.commitRound('next', 30, noon);
  assert.equal(l.state.pending.length, 2); assert.equal(l.state.earned, 3);
  assert.equal(new Set([...l.state.prizes, ...l.state.pending].map(p => p.prizeId)).size, 3);
});

test('v2 replay cannot undo a claimed or spinning prize or another completed round', () => {
  const l = makeLedger(); l.commitRound('first', 10, noon);
  l.commitRound('second', 10, noon);
  assert.equal(l.discardRound('first', noon), false);
  l.startSpin(noon); assert.equal(l.discardRound('second', noon), false);
  l.finishSpin(noon + SPIN_MS); l.acknowledgeWin();
  l.startSpin(noon + SPIN_MS); l.finishSpin(noon + SPIN_MS * 2); l.acknowledgeWin();
  assert.equal(l.discardRound('second', noon), false);
  assert.equal(l.state.prizes.length, 2); assert.equal(l.state.earned, 2);
});

test('v2 replay after claiming two prizes keeps them and unlocks only the last daily prize', () => {
  const l = makeLedger(); l.commitRound('first', 20, noon);
  let time = noon;
  for (let n = 0; n < 2; n++) { l.startSpin(time); time += SPIN_MS; l.finishSpin(time); l.acknowledgeWin(); }
  const won = structuredClone(l.state.prizes);
  l.commitRound('second', 20, time);
  assert.deepEqual(l.state.prizes, won); assert.equal(l.state.pending.length, 1);
  assert.equal(l.state.earned, 3); assert.equal(l.state.coins, 40);
});

test('v2 the reel reverses briefly then travels continuously to the selected prize', () => {
  const target = 32 * 211;
  assert.equal(reelMotion(0, target).offset, 0);
  assert.ok(reelMotion(100, target).offset < 0);
  let previous = reelMotion(160, target).offset;
  for (let ms = 170; ms <= SPIN_MS; ms += 10) {
    const current = reelMotion(ms, target).offset;
    assert.ok(current > previous, `No pause or reversal at ${ms} ms`);
    previous = current;
  }
  assert.ok(Math.abs(reelMotion(SPIN_MS, target).offset - target) < 1e-8);
  // No jump at the boundaries between acceleration, cruise and braking.
  for (const ms of [760, 3560]) assert.ok(Math.abs(reelMotion(ms + .01, target).offset - reelMotion(ms - .01, target).offset) < .1);
});
