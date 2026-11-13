import { SPRITE_SHAPES } from './collision-shapes.mjs?v=v3-nov13-2';

export const ROUND_SECONDS = 60;
export const TUTORIAL_SECONDS = 10;
// A short input gap distinguishes a held, stationary finger from continuous dragging.
export const MOTION_SETTLE_SECONDS = 0.04;
export const POSE_DEADZONE_PIXELS = 8;
const MOTION_REFRESH_PIXELS = 1;
export const LANES = [78.5, 187.5, 296.5];
export const ITEM_TYPES = ['coffee', 'sandwich', 'hotdog'];
export const ITEM_SIZES = {
  coffee: [128, 128], sandwich: [100, 100], hotdog: [100, 100], red: [60, 60],
};
const LANE_SEQUENCE = [1, 0, 1, 2, 1, 0, 1, 2, 1, 2, 1, 0];
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
// Sweep the visible sprite contours over the complete relative movement path.
// A held pose, lateral pass or a frame arriving after first contact cannot miss a catch.
function pathIntersects(xBefore, yBefore, xAfter, yAfter, minX, minY, maxX, maxY) {
  let enter = 0, leave = 1;
  const dx = xAfter - xBefore, dy = yAfter - yBefore;
  if (dx === 0) {
    if (xBefore < minX || xBefore > maxX) return false;
  } else {
    const a = (minX - xBefore) / dx, b = (maxX - xBefore) / dx;
    enter = Math.max(enter, Math.min(a, b));
    leave = Math.min(leave, Math.max(a, b));
    if (enter > leave) return false;
  }
  if (dy === 0) return yBefore >= minY && yBefore <= maxY;
  const a = (minY - yBefore) / dy, b = (maxY - yBefore) / dy;
  enter = Math.max(enter, Math.min(a, b));
  leave = Math.min(leave, Math.max(a, b));
  return enter <= leave;
}
export function touchesCharacter(kind, objectX, yBefore, yAfter, capyBefore, capyAfter, characterY, pose = 'open') {
  const item = SPRITE_SHAPES.items[kind], character = SPRITE_SHAPES.character[pose] || SPRITE_SHAPES.character.open;
  if (!item) return false;
  const x0 = objectX - capyBefore, x1 = objectX - capyAfter;
  const y0 = yBefore - characterY, y1 = yAfter - characterY;
  const overlaps = (c, i) => pathIntersects(x0, y0, x1, y1, c[0] - i[2], c[1] - i[3], c[2] - i[0], c[3] - i[1]);
  if (!overlaps(character.bounds, item.bounds)) return false;
  for (const c of character.bands) {
    if (!overlaps(c, item.bounds)) continue;
    for (const i of item.bands) if (overlaps(c, i)) return true;
  }
  return false;
}

export function rewardProgress(coins) {
  const rewards = Math.min(3, Math.floor(Math.max(0, coins) / 10));
  const start = rewards * 10;
  const target = Math.min(30, start + 10);
  return { rewards, start, target, earned: coins - start,
    remaining: Math.max(0, target - coins),
    fraction: rewards === 3 ? 1 : (coins - start) / (target - start) };
}

export class CatchGame {
  constructor(height = 672) { this.height = height; this.variant = 1; this.reset(); }
  reset() {
    this.status = 'idle'; this.elapsed = 0; this.coins = 0; this.baseCoins = 0;
    this.characterX = 187.5; this.objects = []; this.pointerId = null;
    this.catchSampleX = this.characterX;
    this.catchSamplePose = 'open';
    this.grabOffset = 0; this.serial = 0; this.nextSpawn = 0.4;
    this.spawnCount = 0; this.tutorialComplete = false; this.bonusSpawned = 0;
    this.motionDirection = 'open'; this.lastMovedAt = -Infinity;
    this.motionAnchorX = this.characterX; this.motionSampleX = this.characterX;
  }
  start(baseCoins = 0) { this.reset(); this.baseCoins = baseCoins; this.status = 'running'; }
  get characterY() { return this.height - 236; }
  get catchY() { return this.characterY + 112; }
  get remaining() { return Math.max(0, Math.ceil(ROUND_SECONDS - this.elapsed)); }
  get progress() { return rewardProgress(this.baseCoins + this.coins); }
  canCatchAt() { return true; }
  get bagOpen() { return true; }
  get pose() {
    return this.pointerId === null || this.elapsed >= this.lastMovedAt + MOTION_SETTLE_SECONDS ? 'open' : this.motionDirection;
  }
  stopMotion() {
    this.motionDirection = 'open'; this.lastMovedAt = -Infinity;
    this.motionAnchorX = this.characterX; this.motionSampleX = this.characterX;
  }
  settleMotion() {
    if (this.motionDirection !== 'open' && this.pose === 'open') this.stopMotion();
  }
  movePose(direction) {
    this.motionDirection = direction; this.lastMovedAt = this.elapsed;
    this.motionAnchorX = this.characterX; this.motionSampleX = this.characterX;
  }
  get stage() { return Math.min(5, Math.floor(this.elapsed / 10)); }
  get speed() {
    return (this.catchY - 125) * [0.165, 0.28, 0.34, 0.40, 0.46, 0.51][this.stage];
  }
  get spawnInterval() { return [0.8, 1.05, 0.87, 0.73, 0.63, 0.55][this.stage]; }
  setHeight(height) {
    const oldTravel = this.catchY - 125;
    this.height = Math.max(500, height);
    const ratio = (this.catchY - 125) / oldTravel;
    this.objects.forEach(o => { o.y = 125 + (o.y - 125) * ratio; });
  }
  containsCharacter(x, y) {
    const dx = x - this.characterX;
    const ry = y - this.characterY;
    return (dx / 48) ** 2 + ((ry - 66) / 48) ** 2 <= 1 ||
      (dx / 72) ** 2 + ((ry - 144) / 54) ** 2 <= 1 ||
      (dx / 55) ** 2 + ((ry - 202) / 14) ** 2 <= 1;
  }
  beginDrag(pointerId, x, y) {
    if (this.status !== 'running' || this.pointerId !== null || !this.containsCharacter(x, y)) return false;
    this.pointerId = pointerId;
    this.grabOffset = x - this.characterX;
    this.stopMotion();
    return true;
  }
  drag(pointerId, x) {
    if (this.status !== 'running' || this.pointerId !== pointerId) return false;
    this.settleMotion();
    const nextX = clamp(x - this.grabOffset, 66, 309);
    const delta = nextX - this.characterX;
    this.characterX = nextX;
    if (delta === 0) {
      this.stopMotion();
      return true;
    }
    const offset = nextX - this.motionAnchorX;
    if (this.motionDirection === 'open') {
      // Small aiming corrections do not change the head direction.
      if (Math.abs(offset) >= POSE_DEADZONE_PIXELS) this.movePose(offset < 0 ? 'left' : 'right');
    } else {
      const direction = this.motionDirection === 'right' ? 1 : -1;
      if (direction * offset <= -POSE_DEADZONE_PIXELS) {
        this.movePose(direction === 1 ? 'left' : 'right');
      } else if (direction * offset >= 0) {
        // Keep the direction's furthest point as the reversal threshold.
        this.motionAnchorX = nextX;
        if (Math.abs(nextX - this.motionSampleX) >= MOTION_REFRESH_PIXELS) {
          this.motionSampleX = nextX;
          this.lastMovedAt = this.elapsed;
        }
      }
    }
    return true;
  }
  release(pointerId = this.pointerId) {
    if (pointerId === this.pointerId) {
      this.pointerId = null;
      this.stopMotion();
    }
  }
  pause() { if (this.status === 'running') { this.status = 'paused'; this.release(); this.catchSampleX = this.characterX; this.catchSamplePose = 'open'; } }
  resume() { if (this.status === 'paused') { this.status = 'running'; this.catchSampleX = this.characterX; this.catchSamplePose = 'open'; } }
  spawn() {
    const n = this.spawnCount++;
    // Exactly two bonus tokens: the very first object and one at 52 active seconds.
    const bonus = this.bonusSpawned === 0 || (this.elapsed >= 52 && this.bonusSpawned === 1);
    if (bonus) this.bonusSpawned++;
    const kind = bonus ? 'red' : ITEM_TYPES[(n - 1) % ITEM_TYPES.length];
    const object = { id: ++this.serial, kind, value: bonus ? 2 : 1, x: LANES[LANE_SEQUENCE[n % LANE_SEQUENCE.length]], y: 125 };
    this.objects.push(object);
    return object;
  }
  // Elapsed time is supplied by the clock, so background tabs cannot extend a round.
  advanceTo(elapsed) {
    if (this.status !== 'running') return [];
    const next = clamp(elapsed, this.elapsed, ROUND_SECONDS);
    const delta = next - this.elapsed;
    const previousX = this.catchSampleX;
    const previousPose = this.catchSamplePose;
    this.catchSampleX = this.characterX;
    const events = [];
    this.elapsed = next;
    this.catchSamplePose = this.pose;
    if (next >= ROUND_SECONDS) {
      this.status = 'finished'; this.release(); this.objects = [];
      return [{ type: 'finish', coins: this.coins, rewards: this.progress.rewards }];
    }
    if (next >= TUTORIAL_SECONDS && !this.tutorialComplete) {
      this.tutorialComplete = true;
      this.nextSpawn = Math.min(this.nextSpawn, next);
      events.push({ type: 'tutorial-complete' });
    }
    // Skip suspended-tab travel and spawning instead of awarding invisible catches.
    if (delta > 0.5) {
      this.objects = [];
      this.nextSpawn = next + 0.2;
      this.settleMotion();
      return events;
    }
    const survivors = [];
    for (const object of this.objects) {
      const previousY = object.y;
      object.y += this.speed * delta;
      if (touchesCharacter(object.kind, object.x, previousY, object.y, previousX, this.characterX, this.characterY, this.catchSamplePose) ||
          (previousPose !== this.catchSamplePose && touchesCharacter(object.kind, object.x, previousY, object.y, previousX, this.characterX, this.characterY, previousPose))) {
        const before = this.progress.rewards;
        this.coins += object.value;
        events.push({ type: 'catch', object: { ...object }, value: object.value, coins: this.coins });
        if (this.progress.rewards > before) events.push({ type: 'reward', rewards: this.progress.rewards });
      } else if (object.y < this.height + 75) survivors.push(object);
    }
    this.objects = survivors;
    // Head direction settles independently from the always-open sack.
    this.settleMotion();
    if (next >= this.nextSpawn && (next >= TUTORIAL_SECONDS || this.objects.length === 0)) {
      events.push({ type: 'spawn', object: this.spawn() });
      this.nextSpawn = next + this.spawnInterval;
    }
    return events;
  }
}
