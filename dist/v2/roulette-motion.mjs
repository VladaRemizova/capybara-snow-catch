import { SPIN_MS } from './prizes.mjs?v=nov13-8';

// The integral of a smooth velocity curve: short anticipation, acceleration,
// steady travel, then continuous braking. No stop between forward segments.
export function reelMotion(elapsed, targetDistance) {
  const reverseMs = 160, reversePx = 13;
  const t = Math.max(0, Math.min(SPIN_MS, elapsed));
  if (t < reverseMs) {
    return { offset: -reversePx * Math.sin(t / reverseMs * Math.PI / 2) || 0, gap: 176 };
  }
  const duration = SPIN_MS - reverseMs, accelerate = 600, cruise = 2800;
  const brake = duration - accelerate - cruise, forward = t - reverseMs;
  const totalArea = accelerate / 2 + cruise + brake / 2;
  let area;
  if (forward < accelerate) {
    area = (forward - accelerate / Math.PI * Math.sin(Math.PI * forward / accelerate)) / 2;
  } else if (forward < accelerate + cruise) {
    area = accelerate / 2 + forward - accelerate;
  } else {
    const u = forward - accelerate - cruise;
    area = accelerate / 2 + cruise + (u + brake / Math.PI * Math.sin(Math.PI * u / brake)) / 2;
  }
  const spread = Math.min(1, forward / 400);
  return {
    offset: -reversePx + (targetDistance + reversePx) * area / totalArea,
    gap: 176 + 35 * (1 - (1 - spread) ** 3),
  };
}
