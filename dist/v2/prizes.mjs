export const PRIZES = {
  hoff: { id: 'hoff', title: 'Скидка 15% на первый заказ в HOFF', code: 'LUKOIL15', image: 'prize-hoff.webp', category: 'КОФЕ' },
  rossko10: { id: 'rossko10', title: 'Скидка 10% на первый заказ автозапчастей ROSSKO', code: 'LUKOIL10', image: 'prize-rossko10.webp', category: 'КОФЕ' },
  rossko5: { id: 'rossko5', title: 'Скидка 5% на первый заказ автозапчастей ROSSKO', code: 'LUKOIL5', image: 'prize-rossko5.webp', category: 'БАЛЛЫ' },
};
export const PRIZE_IDS = Object.keys(PRIZES);
export const SPIN_MS = 9500;
export const STORAGE_KEY = 'capybara-snow-catch-v2';

export function moscowDay(time = Date.now()) {
  return new Date(time + 3 * 3600_000).toISOString().slice(0, 10);
}
export function shuffled(ids, random = Math.random) {
  const result = [...ids];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Local demo ledger. Pending results are selected and saved BEFORE a spin starts.
// Round receipts and token IDs make all completion operations idempotent.
export class PrizeLedger {
  constructor(saved, now = Date.now(), random = Math.random) {
    this.random = random;
    const fresh = { version: 2, day: moscowDay(now), coins: 0, earned: 0,
      order: shuffled(PRIZE_IDS, random), pending: [], prizes: [], receipts: [], spin: null, lastWin: null, serial: 0 };
    this.state = saved?.version === 2 ? structuredClone(saved) : fresh;
    const s = this.state;
    s.pending = (s.pending || []).filter(p => PRIZES[p.prizeId]);
    s.prizes = (s.prizes || []).filter(p => PRIZES[p.prizeId]);
    s.receipts ||= [];
    if (!Array.isArray(s.order) || new Set(s.order).size !== 3 || s.order.some(id => !PRIZES[id])) s.order = shuffled(PRIZE_IDS, random);
    s.earned = Math.min(3, Math.max(0, Number(s.earned) || 0));
    s.coins = Math.max(0, Number(s.coins) || 0);
    s.serial = Number(s.serial) || 0;
    if (s.spin && !s.pending.some(p => p.id === s.spin.pendingId)) s.spin = null;
    if (s.lastWin && !s.prizes.some(p => p.id === s.lastWin.id)) s.lastWin = null;
    this.refreshDay(now);
  }
  refreshDay(now = Date.now()) {
    const day = moscowDay(now), s = this.state;
    if (s.day === day) return false;
    // Past prizes and already earned rotations survive midnight.
    s.day = day; s.coins = 0; s.earned = 0; s.order = shuffled(PRIZE_IDS, this.random);
    return true;
  }
  get locked() { return this.state.pending.length > 0 || this.state.spin !== null || this.state.lastWin !== null; }
  commitRound(id, coins, now = Date.now()) {
    this.refreshDay(now);
    const s = this.state;
    if (s.receipts.includes(id)) return [];
    const amount = Math.max(0, Math.floor(Number(coins) || 0));
    s.receipts = [...s.receipts.slice(-99), id];
    s.coins += amount;
    const next = Math.min(3, Math.floor(s.coins / 10));
    const added = [];
    for (let n = s.earned; n < next; n++) {
      const token = { id: `${s.day}-${++s.serial}`, day: s.day, prizeId: s.order[n] };
      s.pending.push(token); added.push(token);
    }
    s.earned = next;
    return added;
  }
  startSpin(now = Date.now()) {
    const s = this.state;
    if (s.spin) return s.spin;
    if (!s.pending.length || s.lastWin) return null;
    s.spin = { pendingId: s.pending[0].id, startedAt: now, duration: SPIN_MS };
    return s.spin;
  }
  finishSpin(now = Date.now()) {
    const s = this.state, spin = s.spin;
    if (!spin || now < spin.startedAt + spin.duration) return null;
    const index = s.pending.findIndex(p => p.id === spin.pendingId);
    if (index < 0) { s.spin = null; return null; }
    const [token] = s.pending.splice(index, 1);
    const result = { ...token, receivedAt: now };
    if (!s.prizes.some(p => p.id === token.id)) s.prizes.push(result);
    s.lastWin = result; s.spin = null;
    return result;
  }
  acknowledgeWin() { this.state.lastWin = null; }
  serialize() { return JSON.stringify(this.state); }
}
