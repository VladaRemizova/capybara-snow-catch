import test from 'node:test';
import assert from 'node:assert/strict';
import { CatchGame, LANES, rewardProgress } from '../dist/game-core.mjs';

function tick(game, until, onFrame = () => {}) {
  const events = [];
  for (let t = game.elapsed + 1 / 60; t < until; t += 1 / 60) {
    onFrame(game); events.push(...game.advanceTo(t));
  }
  onFrame(game); events.push(...game.advanceTo(until));
  return events;
}

test('only touching the character starts a drag; re-grabbing preserves the finger offset', () => {
  const game = new CatchGame(); game.start();
  assert.equal(game.beginDrag(1, 30, 200), false);
  assert.equal(game.beginDrag(1, game.characterX + 25, game.characterY + 130), true);
  assert.equal(game.beginDrag(2, game.characterX, game.characterY + 80), false);
  game.drag(1, 250);
  assert.equal(game.characterX, 225);
  game.release(2);
  assert.equal(game.pointerId, 1);
  game.release(1);
  assert.equal(game.drag(1, 40), false);
  assert.equal(game.beginDrag(2, 70, game.characterY + 60), false);
  assert.equal(game.characterX, 225);
  assert.equal(game.beginDrag(3, 245, game.characterY + 140), true);
  game.drag(3, 245);
  assert.equal(game.characterX, 225);
  game.drag(3, -1000); assert.equal(game.characterX, 66);
  game.drag(3, 1000); assert.equal(game.characterX, 309);
});

test('tutorial has at most one falling item and speed changes at exactly ten seconds', () => {
  const game = new CatchGame(); game.start();
  const slow = game.speed;
  tick(game, 9.99, g => assert.ok(g.objects.length <= 1));
  assert.equal(game.speed, slow);
  const events = game.advanceTo(10);
  assert.ok(game.speed > slow);
  assert.equal(events.filter(e => e.type === 'tutorial-complete').length, 1);
  assert.equal(game.advanceTo(10.01).filter(e => e.type === 'tutorial-complete').length, 0);
  tick(game, 12);
  assert.ok(game.objects.length > 1);
});

test('items remain in their grid columns and missing items costs no coins', () => {
  const game = new CatchGame(); game.start();
  game.characterX = 66;
  const originalX = new Map();
  tick(game, 20, g => {
    for (const item of g.objects) {
      assert.ok(LANES.includes(item.x));
      if (originalX.has(item.id)) assert.equal(item.x, originalX.get(item.id));
      originalX.set(item.id, item.x);
    }
  });
  assert.ok(game.coins >= 0);
  const coins = game.coins;
  game.characterX = 240;
  tick(game, 25);
  assert.ok(game.coins >= coins);
});

test('reward thresholds reset only the stage progress and cap rewards at three', () => {
  const expected = [
    [0, 0, 0, 20], [19, 0, .95, 1], [20, 1, 0, 10],
    [25, 1, .5, 5], [30, 2, 0, 10], [39, 2, .9, 1],
    [40, 3, 1, 0], [75, 3, 1, 0],
  ];
  for (const [coins, rewards, fraction, remaining] of expected) {
    const actual = rewardProgress(coins);
    assert.equal(actual.rewards, rewards); assert.equal(actual.fraction, fraction);
    assert.equal(actual.remaining, remaining);
  }
});

test('a full round can earn all rewards, continues counting beyond forty, and finishes once', () => {
  const game = new CatchGame(); game.start();
  const events = tick(game, 60, g => {
    const next = [...g.objects].sort((a, b) => b.y - a.y).find(o => o.y < g.catchY - 8);
    if (next) g.characterX = next.x;
  });
  assert.ok(game.coins > 40, `perfect play should exceed 40, got ${game.coins}`);
  assert.equal(game.progress.rewards, 3);
  assert.equal(events.filter(e => e.type === 'reward').length, 3);
  assert.equal(events.filter(e => e.type === 'catch').length, game.coins);
  assert.equal(events.filter(e => e.type === 'finish').length, 1);
  assert.equal(game.remaining, 0); assert.equal(game.status, 'finished');
  assert.deepEqual(game.advanceTo(61), []);
  const total = game.coins;
  assert.equal(game.beginDrag(8, game.characterX, game.characterY + 70), false);
  assert.equal(game.coins, total);
});

test('crossing the mouth between frames awards exactly one coin', () => {
  const game = new CatchGame(); game.start();
  game.elapsed = 40; game.nextSpawn = 100; game.tutorialComplete = true;
  game.objects = [{ id: 1, kind: 'hotdog', x: game.characterX, y: game.catchY - 59.5 * .33 - 1 }];
  const events = game.advanceTo(40.03);
  assert.equal(events.filter(e => e.type === 'catch').length, 1);
  assert.equal(game.coins, 1); assert.equal(game.objects.length, 0);
  assert.equal(game.advanceTo(40.06).filter(e => e.type === 'catch').length, 0);
});

test('a suspended tab cannot prolong the clock or collect invisible objects', () => {
  const game = new CatchGame(); game.start(); tick(game, 2);
  assert.ok(game.objects.length > 0);
  game.advanceTo(32);
  assert.equal(game.coins, 0); assert.equal(game.objects.length, 0); assert.equal(game.remaining, 28);
  const events = game.advanceTo(65);
  assert.equal(game.status, 'finished'); assert.equal(game.remaining, 0);
  assert.equal(events[0].type, 'finish');
});

test('rules pause releases the finger and restart resets the entire round', () => {
  const game = new CatchGame(); game.start(); tick(game, 4);
  game.beginDrag(1, game.characterX, game.characterY + 70);
  game.pause(); assert.equal(game.pointerId, null);
  assert.deepEqual(game.advanceTo(30), []); assert.equal(game.elapsed, 4);
  game.resume(); assert.equal(game.status, 'running');
  game.coins = 45; game.start();
  assert.equal(game.remaining, 60); assert.equal(game.coins, 0);
  assert.equal(game.progress.rewards, 0); assert.equal(game.objects.length, 0);
  assert.equal(game.characterX, 187.5); assert.equal(game.pointerId, null);
});
