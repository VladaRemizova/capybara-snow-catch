export const ROUND_SECONDS = 60;
export const TUTORIAL_SECONDS = 10;
// A short input gap distinguishes a held, stationary finger from continuous dragging.
export const MOTION_SETTLE_SECONDS = 0.09;
export const LANES = [78.5, 187.5, 296.5];
export const ITEM_TYPES = ['oil', 'coffee-lid', 'sandwich', 'coffee', 'hotdog'];
export const ITEM_SIZES = {
  oil: [69, 105.5], 'coffee-lid': [63, 89], sandwich: [85.5, 78.5],
  coffee: [60, 83.5], hotdog: [73.5, 59.5],
};
const LANE_SEQUENCE = [1, 0, 1, 2, 1, 0, 1, 2, 1, 2, 1, 0];
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

export function rewardProgress(coins) {
  const rewards = coins >= 40 ? 3 : coins >= 30 ? 2 : coins >= 20 ? 1 : 0;
  const start = [0, 20, 30, 40][rewards];
  const target = [20, 30, 40, 40][rewards];
  return { rewards, start, target, earned: coins - start,
    remaining: Math.max(0, target - coins),
    fraction: rewards === 3 ? 1 : (coins - start) / (target - start) };
}

export class CatchGame {
  constructor(height = 672) { this.height = height; this.reset(); }
  reset() {
    this.status = 'idle'; this.elapsed = 0; this.coins = 0;
    this.characterX = 187.5; this.objects = []; this.pointerId = null;
    this.grabOffset = 0; this.serial = 0; this.nextSpawn = 0.4;
    this.spawnCount = 0; this.tutorialComplete = false;
    this.motionDirection = 'open'; this.lastMovedAt = -Infinity;
  }
  start() { this.reset(); this.status = 'running'; }
  get characterY() { return this.height - 228; }
  get catchY() { return this.characterY + 109; }
  get remaining() { return Math.max(0, Math.ceil(ROUND_SECONDS - this.elapsed)); }
  get progress() { return rewardProgress(this.coins); }
  canCatchAt(time) {
    return this.pointerId === null || this.motionDirection === 'open' ||
      time >= this.lastMovedAt + MOTION_SETTLE_SECONDS;
  }
  get bagOpen() { return this.canCatchAt(this.elapsed); }
  get pose() { return this.bagOpen ? 'open' : this.motionDirection; }
  get stage() { return Math.min(5, Math.floor(this.elapsed / 10)); }
  get speed() {
    return (this.catchY - 105) * [0.165, 0.28, 0.34, 0.40, 0.46, 0.51][this.stage];
  }
  get spawnInterval() { return [0.8, 1.05, 0.87, 0.73, 0.63, 0.55][this.stage]; }
  setHeight(height) {
    const oldTravel = this.catchY - 105;
    this.height = Math.max(500, height);
    const ratio = (this.catchY - 105) / oldTravel;
    this.objects.forEach(o => { o.y = 105 + (o.y - 105) * ratio; });
  }
  containsCharacter(x, y) {
    const dx = x - this.characterX;
    const ry = y - this.characterY;
    return (dx / 51) ** 2 + ((ry - 67) / 49) ** 2 <= 1 ||
      (dx / 76) ** 2 + ((ry - 147) / 55) ** 2 <= 1 ||
      (dx / 55) ** 2 + ((ry - 195) / 12) ** 2 <= 1;
  }
  beginDrag(pointerId, x, y) {
    if (this.status !== 'running' || this.pointerId !== null || !this.containsCharacter(x, y)) return false;
    this.pointerId = pointerId;
    this.grabOffset = x - this.characterX;
    return true;
  }
  drag(pointerId, x) {
    if (this.status !== 'running' || this.pointerId !== pointerId) return false;
    const nextX = clamp(x - this.grabOffset, 66, 309);
    const delta = nextX - this.characterX;
    if (Math.abs(delta) >= 0.35) {
      this.characterX = nextX;
      this.motionDirection = delta < 0 ? 'left' : 'right';
      this.lastMovedAt = this.elapsed;
    } else if (delta === 0) {
      this.motionDirection = 'open';
      this.lastMovedAt = -Infinity;
    }
    return true;
  }
  release(pointerId = this.pointerId) {
    if (pointerId === this.pointerId) {
      this.pointerId = null;
      this.motionDirection = 'open';
      this.lastMovedAt = -Infinity;
    }
  }
  pause() { if (this.status === 'running') { this.status = 'paused'; this.release(); } }
  resume() { if (this.status === 'paused') this.status = 'running'; }
  spawn() {
    const n = this.spawnCount++;
    const kind = ITEM_TYPES[n % ITEM_TYPES.length];
    const object = { id: ++this.serial, kind, x: LANES[LANE_SEQUENCE[n % LANE_SEQUENCE.length]], y: 105 };
    this.objects.push(object);
    return object;
  }
  // Elapsed time is supplied by the clock, so background tabs cannot extend a round.
  advanceTo(elapsed) {
    if (this.status !== 'running') return [];
    const next = clamp(elapsed, this.elapsed, ROUND_SECONDS);
    const previousTime = this.elapsed;
    const delta = next - this.elapsed;
    const events = [];
    this.elapsed = next;
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
      return events;
    }
    const survivors = [];
    for (const object of this.objects) {
      const bottomOffset = ITEM_SIZES[object.kind][1] * 0.33;
      const previousBottom = object.y + bottomOffset;
      object.y += this.speed * delta;
      const crossesMouth = previousBottom <= this.catchY && object.y + bottomOffset >= this.catchY;
      const crossingTime = previousTime + Math.max(0, this.catchY - previousBottom) / this.speed;
      if (crossesMouth && this.canCatchAt(crossingTime) && Math.abs(object.x - this.characterX) <= 45) {
        const before = this.progress.rewards;
        this.coins++;
        events.push({ type: 'catch', object: { ...object }, coins: this.coins });
        if (this.progress.rewards > before) events.push({ type: 'reward', rewards: this.progress.rewards });
      } else if (object.y < this.height + 75) survivors.push(object);
    }
    this.objects = survivors;
    if (next >= this.nextSpawn && (next >= TUTORIAL_SECONDS || this.objects.length === 0)) {
      events.push({ type: 'spawn', object: this.spawn() });
      this.nextSpawn = next + this.spawnInterval;
    }
    return events;
  }
}
