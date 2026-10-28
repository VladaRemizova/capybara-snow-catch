import test from 'node:test';
import assert from 'node:assert/strict';
import { CatchGame, LANES, MOTION_SETTLE_SECONDS, POSE_DEADZONE_PIXELS, rewardProgress } from '../dist/game-core.mjs';

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

test('head poses follow movement while the sack stays open', () => {
  const game = new CatchGame(); game.start();
  assert.equal(game.pose, 'open');
  game.beginDrag(1, game.characterX, game.characterY + 70);
  assert.equal(game.pose, 'open');
  game.drag(1, 170);
  assert.equal(game.pose, 'left'); assert.equal(game.bagOpen, true);
  game.advanceTo(.02); game.drag(1, 190);
  assert.equal(game.pose, 'right');
  game.advanceTo(.02 + MOTION_SETTLE_SECONDS - .001);
  assert.equal(game.pose, 'right');
  game.advanceTo(.02 + MOTION_SETTLE_SECONDS + .001);
  assert.equal(game.pose, 'open'); assert.equal(game.pointerId, 1);
  game.drag(1, 150); assert.equal(game.pose, 'left');
  game.release(2); assert.equal(game.pose, 'left');
  game.release(1); assert.equal(game.pose, 'open');
});

test('stationary jitter and a stopped edge keep the forward head pose', () => {
  const game = new CatchGame(); game.start();
  game.beginDrag(1, game.characterX, game.characterY + 70);
  game.drag(1, 187.6);
  assert.equal(game.characterX, 187.6); assert.equal(game.pose, 'open');
  game.drag(1, 1000); assert.equal(game.pose, 'right');
  game.drag(1, 1100); assert.equal(game.characterX, 309); assert.equal(game.pose, 'open');
  game.drag(1, 200); assert.equal(game.pose, 'left');
  game.drag(1, 200); assert.equal(game.pose, 'open');
});

test('both characters catch during deliberate left and right movement', () => {
  for (const variant of [1, 2]) for (const x of [175, 200]) {
    const game = new CatchGame(); game.variant = variant; game.start(); game.nextSpawn = 100;
    game.beginDrag(1, game.characterX, game.characterY + 70); game.drag(1, x);
    assert.equal(game.pose, x < 187.5 ? 'left' : 'right');
    assert.equal(game.bagOpen, true);
    game.objects = [{ id: 1, kind: 'hotdog', x, y: game.catchY - 59.5 * .33 - 1 }];
    assert.equal(game.advanceTo(.03).filter(e => e.type === 'catch').length, 1);
    assert.equal(game.coins, 1);
    assert.equal(game.advanceTo(.06).filter(e => e.type === 'catch').length, 0);
  }
});

test('pausing on a reward freezes falling items, time and coins until resumed', () => {
  const game = new CatchGame(); game.start(); game.coins = 19; game.nextSpawn = 100;
  game.objects = [
    { id: 1, kind: 'hotdog', x: game.characterX, y: game.catchY - 59.5 * .33 - 1 },
    { id: 2, kind: 'oil', x: 78.5, y: 200 },
  ];
  const events = game.advanceTo(.03);
  assert.equal(events.filter(e => e.type === 'reward').length, 1);
  game.pause(); const objects = structuredClone(game.objects);
  assert.deepEqual(game.advanceTo(3.03), []);
  assert.deepEqual(game.objects, objects); assert.equal(game.elapsed, .03); assert.equal(game.coins, 20);
  game.resume(); game.advanceTo(.06);
  assert.ok(game.objects[0].y > objects[0].y);
  assert.equal(game.coins, 20);
});

test('aiming corrections inside the safe zone follow the finger and keep the sack open', () => {
  const game = new CatchGame(); game.start();
  game.beginDrag(1, game.characterX, game.characterY + 70);
  for (const x of [190, 184, 193, 181, 189]) {
    game.drag(1, x);
    assert.equal(game.characterX, x); assert.equal(game.pose, 'open');
  }
  game.drag(1, 187.5 + POSE_DEADZONE_PIXELS);
  assert.equal(game.pose, 'right');
});

test('direction changes require a deliberate reversal from the furthest position', () => {
  const game = new CatchGame(); game.start();
  game.beginDrag(1, game.characterX, game.characterY + 70);
  game.drag(1, 200); assert.equal(game.pose, 'right');
  for (const x of [197, 203, 198, 196]) {
    game.drag(1, x); assert.equal(game.pose, 'right');
  }
  game.drag(1, 194); assert.equal(game.pose, 'left');
  game.advanceTo(MOTION_SETTLE_SECONDS + .001);
  for (const x of [198, 191, 197]) {
    game.drag(1, x); assert.equal(game.pose, 'open');
  }
});

test('an item arriving fifty milliseconds after stopping is caught with a held finger', () => {
  const game = new CatchGame(); game.start(); game.nextSpawn = 100;
  game.beginDrag(1, game.characterX, game.characterY + 70); game.drag(1, 175);
  game.objects = [{ id: 1, kind: 'hotdog', x: 175, y: game.catchY - 59.5 * .33 - game.speed * .05 }];
  assert.equal(game.advanceTo(.06).filter(e => e.type === 'catch').length, 1);
  assert.equal(game.coins, 1); assert.equal(game.pose, 'open'); assert.equal(game.pointerId, 1);
});
