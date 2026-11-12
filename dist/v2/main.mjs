import { CatchGame, ITEM_SIZES } from './game-core.mjs';
import { PrizeLedger, PRIZES, SPIN_MS, STORAGE_KEY } from './prizes.mjs';
import { CONFETTI } from './confetti.mjs';
import { initUI, refreshUI, setCounter, prizeGeometry, paintReward, paintResult, paintWin, paintPrizeCard, paintEmpty } from './ui.mjs';

const $ = id => document.getElementById(id);
const scene = $('scene'), phone = $('phone'), field = $('falling-field');
const game = new CatchGame();
const nodes = new Map();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const screenNames = ['entry', 'game', 'roulette', 'win', 'cabinet', 'coupon'];
let scale = 1, screenName = 'entry', origin = 0, roundId = null;
let soundOn = false, audio = null, modal = null, modalFocus = null;
let rewardBusy = false, smile = false, cabinetReturn = false, finishing = false;
let rewardTimers = [], rewardQueue = [], toastTimer, reel = null;
let adminBusy = false;
const DEMO_CLOCK_KEY = `${STORAGE_KEY}-demo-clock`;
function readDemoDays() {
  try {
    const saved = JSON.parse(localStorage.getItem(DEMO_CLOCK_KEY));
    return Math.max(0, Math.min(10000, Math.floor(Number(saved?.days) || 0)));
  } catch { return 0; }
}
let demoDays = readDemoDays();
// The administrative day offset applies to prize accounting, not the game or reel clocks.
const prizeNow = () => Date.now() + demoDays * 86400_000;

function readSaved() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; }
}
let ledger = new PrizeLedger(readSaved(), prizeNow());
function persist() {
  try { localStorage.setItem(STORAGE_KEY, ledger.serialize()); } catch { /* Private browser storage may be unavailable. */ }
  renderAdmin();
}
persist();
async function transaction(action) {
  const perform = () => {
    ledger = new PrizeLedger(readSaved() || ledger.state, prizeNow());
    const result = action(ledger);
    persist(); return result;
  };
  return navigator.locks ? navigator.locks.request(STORAGE_KEY, perform) : perform();
}

function sizeScene() {
  scale = phone.clientWidth / 375;
  const height = 672;
  scene.style.height = `${height}px`;
  scene.style.transform = `scale(${scale})`;
  game.setHeight(height);
  render();
  if (reel) layoutReel(reel.gap);
}
new ResizeObserver(sizeScene).observe(phone);

function showScreen(name) {
  screenName = name;
  for (const key of screenNames) $(key + '-screen').hidden = key !== name;
  if (name !== 'game') scene.classList.remove('dragging', 'ready-to-grab');
  render();
}
function setModal(name) {
  const ids = ['teaching', 'help', 'reward', 'result'];
  if (name && !modal) modalFocus = document.activeElement;
  modal = name;
  for (const id of ids) $(id + '-layer').hidden = id !== name;
  for (const node of $('game-screen').children) {
    if (!node.classList.contains('overlay')) node.inert = Boolean(name || rewardBusy);
  }
  if (name) {
    const layer = $(name + '-layer');
    layer.classList.remove('leaving');
    const focus = layer.querySelector('button:not(:disabled)') || layer;
    if (!focus.hasAttribute('tabindex') && focus === layer) focus.tabIndex = -1;
    focus.focus({ preventScroll: true });
  } else if (modalFocus?.isConnected && !modalFocus.closest('[hidden]')) modalFocus.focus({ preventScroll: true });
}
document.addEventListener('keydown', event => {
  if (!modal || screenName !== 'game' || event.key !== 'Tab') return;
  const layer = $(modal + '-layer');
  const buttons = [...layer.querySelectorAll('button:not(:disabled)')].filter(n => !n.closest('[hidden]'));
  if (!buttons.length) { event.preventDefault(); return; }
  const first = buttons[0], last = buttons.at(-1);
  if (event.shiftKey && document.activeElement === first) { last.focus(); event.preventDefault(); }
  else if (!event.shiftKey && document.activeElement === last) { first.focus(); event.preventDefault(); }
});

function clearRewardTimers() { rewardTimers.forEach(clearTimeout); rewardTimers = []; }
function resume() {
  if (game.status !== 'paused' || modal || screenName !== 'game') return;
  origin = performance.now() - game.elapsed * 1000;
  game.resume(); render();
}
function pause() { syncClock(); game.pause(); scene.classList.remove('dragging', 'ready-to-grab'); render(); }
function startRound() {
  ledger = new PrizeLedger(readSaved() || ledger.state, prizeNow()); persist();
  if (ledger.locked) { restoreDraw(); return; }
  clearRewardTimers(); rewardQueue = []; rewardBusy = false; smile = false; finishing = false;
  game.start(ledger.state.coins); game.pause();
  roundId = crypto.randomUUID(); cabinetReturn = false;
  field.replaceChildren(); nodes.clear(); $('effects').replaceChildren();
  showScreen('game'); setModal('teaching');
}
function home() {
  if (ledger.locked) { restoreDraw(); return; }
  clearRewardTimers(); rewardQueue = []; rewardBusy = false; smile = false;
  // Only completed rounds enter the ledger. Discarding this round cannot spend or add coins.
  game.reset(); roundId = null; cabinetReturn = false;
  setModal(null); showScreen('entry');
}
function openCabinet() {
  if (ledger.locked) { restoreDraw(); return; }
  if (game.status === 'running') pause();
  cabinetReturn = Boolean(roundId && game.status === 'paused' && !finishing);
  renderCabinet(); showScreen('cabinet');
}

function point(event) {
  const rect = scene.getBoundingClientRect();
  return { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale };
}
function syncClock() {
  if (screenName === 'game' && game.status === 'running') processEvents(game.advanceTo((performance.now() - origin) / 1000));
}
$('game-screen').addEventListener('pointerdown', event => {
  if (modal || rewardBusy || event.target.closest('button, .stats, header') || (event.pointerType === 'mouse' && event.button !== 0)) return;
  syncClock();
  const { x, y } = point(event);
  if (!game.beginDrag(event.pointerId, x, y)) return;
  $('game-screen').setPointerCapture(event.pointerId);
  scene.classList.add('dragging'); event.preventDefault();
});
$('game-screen').addEventListener('pointermove', event => {
  if (modal || rewardBusy) return;
  syncClock();
  const { x, y } = point(event);
  if (game.drag(event.pointerId, x)) { renderCharacter(); event.preventDefault(); }
  scene.classList.toggle('ready-to-grab', game.status === 'running' && game.containsCharacter(x, y));
});
function release(event) {
  syncClock(); game.release(event?.pointerId);
  scene.classList.toggle('dragging', game.pointerId !== null); renderCharacter();
}
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) $('game-screen').addEventListener(name, release);
window.addEventListener('blur', () => release());
document.addEventListener('visibilitychange', () => { if (document.hidden) game.release(); else { syncClock(); render(); } });

const poseReady = new Set();
let renderedPose = 'open';
for (const target of ['character', 'character-front']) {
  for (const pose of ['open', 'left', 'right', 'smile']) {
    const img = document.createElement('img'); img.src = `assets/capy-${pose}.webp?v=581-4131`; img.alt = ''; img.dataset.pose = pose;
    $(target).append(img);
  }
}
for (const pose of ['open', 'left', 'right', 'smile']) {
  const images = [...document.querySelectorAll(`.character img[data-pose="${pose}"]`)];
  Promise.all(images.map(img => img.decode().catch(() => {}))).then(() => {
    if (images.every(img => img.complete && img.naturalWidth > 0)) poseReady.add(pose);
    renderCharacter();
  });
}
function renderCharacter() {
  const requestedPose = smile ? 'smile' : game.pose;
  // Swap decoded images in one paint; keep the previous pose until the new one is ready.
  if (poseReady.has(requestedPose)) renderedPose = requestedPose;
  else if (!poseReady.has(renderedPose)) renderedPose = poseReady.has('open') ? 'open' : poseReady.values().next().value || 'open';
  const pose = renderedPose;
  for (const target of ['character', 'character-front']) {
    $(target).style.left = `${game.characterX - 74}px`;
    $(target).style.top = `${game.characterY}px`;
    for (const img of $(target).children) img.classList.toggle('visible', img.dataset.pose === pose);
  }
  $('character').dataset.pose = pose;
}
function render() {
  renderCharacter();
  const coins = game.baseCoins + game.coins, progress = game.progress;
  setCounter('time-value', game.remaining === 60 ? '01:00' : `00:${String(game.remaining).padStart(2, '0')}`);
  setCounter('coin-value', coins);
  setCounter('prize-value', `${progress.rewards}/3`, 'bold18', 21);
  setCounter('owned-count', ledger.state.prizes.length, 'roboto13', 16);
  refreshUI();
  $('progress-fill').style.width = `${Math.max(0, Math.min(1, progress.fraction)) * 100}%`;
  $('prize-progress').setAttribute('aria-valuenow', progress.rewards === 3 ? '10' : String(coins % 10));
  $('prize-progress').setAttribute('aria-valuetext', progress.rewards === 3 ? 'Все три приза доступны' : `Ещё ${progress.remaining} монет до следующего приза`);
  $('time-stat').classList.toggle('urgent', game.remaining <= 10 && game.remaining > 0 && !modal);
  $('time-stat').classList.toggle('last-seconds', game.remaining <= 5);
  const alive = new Set(game.objects.map(o => o.id));
  for (const [id, node] of nodes) if (!alive.has(id)) { node.remove(); nodes.delete(id); }
  for (const object of game.objects) {
    let node = nodes.get(object.id);
    if (!node) {
      node = document.createElement('img'); node.src = `assets/item-${object.kind}.webp`; node.alt = '';
      node.className = 'falling-item' + (object.kind === 'red' ? ' bonus' : ''); node.dataset.kind = object.kind;
      const [w, h] = ITEM_SIZES[object.kind]; node.style.width = `${w}px`; node.style.height = `${h}px`;
      field.append(node); nodes.set(object.id, node);
    }
    const [w, h] = ITEM_SIZES[object.kind];
    node.style.transform = `translate(${object.x - w / 2}px,${object.y - h / 2}px)`;
  }
}

function animate(node, frames, options) {
  const animation = node.animate(frames, options);
  return animation;
}
function temporary(node, frames, options) {
  const animation = animate(node, frames, options);
  animation.finished.then(() => node.remove()).catch(() => node.remove());
}
function pop(node) {
  if (!reducedMotion) animate(node, [{ transform: 'scale(1)' }, { transform: 'scale(1.04)', offset: .35 }, { transform: 'scale(1)' }], { duration: 250 });
}
function beep(reward = false) {
  if (!soundOn) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume().catch(() => {});
    const now = audio.currentTime;
    for (let n = 0; n < (reward ? 3 : 1); n++) {
      const oscillator = audio.createOscillator(), gain = audio.createGain();
      oscillator.type = 'sine'; oscillator.frequency.value = reward ? [660, 830, 990][n] : 850;
      gain.gain.setValueAtTime(0, now + n * .085);
      gain.gain.linearRampToValueAtTime(.065, now + n * .085 + .008);
      gain.gain.exponentialRampToValueAtTime(.001, now + n * .085 + .13);
      oscillator.connect(gain); gain.connect(audio.destination);
      oscillator.start(now + n * .085); oscillator.stop(now + n * .085 + .14);
    }
  } catch { /* Sound is optional; gameplay remains available. */ }
}

const holidayMarks = {
  star: '<svg viewBox="0 0 24 24"><path d="m12 1 2.8 7.8L23 12l-8.2 3.2L12 23l-2.8-7.8L1 12l8.2-3.2Z" fill="currentColor"/><path d="m12 5 1.6 5.4L19 12l-5.4 1.6L12 19l-1.6-5.4L5 12l5.4-1.6Z" fill="#fff" opacity=".65"/></svg>',
  snow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M3.34 7l17.32 10M3.34 17l17.32-10M8.8 4.4 12 7l3.2-2.6M8.8 19.6 12 17l3.2 2.6M3.8 10.8l3.85-1.47-.65-4.05m13.2 7.92-3.85 1.47.65 4.05M7 18.72l.65-4.05-3.85-1.47m13.2-7.92-.65 4.05 3.85 1.47"/></svg>',
  ribbon: '<svg viewBox="0 0 12 24"><path d="M2 1h8v8L5 15v8H0v-9l5-6Z" fill="currentColor"/><path d="M3 2h3v7l-3 4Z" fill="#fff" opacity=".5"/></svg>',
};
const holidayColors = ['#ffd66d', '#ffffff', '#f94a68', '#8cddc9', '#ffe7a4'];
function effectNode(className, x, y) {
  const node = document.createElement('span');
  node.className = className;
  node.style.left = `${x}px`; node.style.top = `${y}px`;
  $('effects').append(node);
  return node;
}
function holidayBurst(x, y, grand = false) {
  if (reducedMotion) return;
  const bloom = effectNode(`catch-bloom${grand ? ' grand' : ''}`, x, y);
  temporary(bloom, [
    { transform: 'translate(-50%,-50%) scale(.25)', opacity: 0 },
    { transform: 'translate(-50%,-50%) scale(1)', opacity: .9, offset: .17 },
    { transform: 'translate(-50%,-58%) scale(1.5)', opacity: 0 },
  ], { duration: grand ? 900 : 650, easing: 'ease-out' });
  const ring = effectNode('catch-ring', x, y + 3);
  temporary(ring, [
    { transform: 'translate(-50%,-50%) scale(.3)', opacity: 0 },
    { transform: 'translate(-50%,-50%) scale(.85)', opacity: 1, offset: .14 },
    { transform: `translate(-50%,-50%) scale(${grand ? 1.9 : 1.45})`, opacity: 0 },
  ], { duration: grand ? 800 : 580, easing: 'cubic-bezier(.12,.6,.3,1)' });

  const count = grand ? 32 : 19;
  for (let n = 0; n < count; n++) {
    const kind = n % 5 === 0 ? 'snow' : n % 3 === 0 ? 'ribbon' : 'star';
    const particle = effectNode(`holiday-particle ${kind}`, x, y);
    const size = kind === 'snow' ? 19 + n % 4 * 2 : kind === 'ribbon' ? 9 + n % 3 * 2 : 10 + n % 4 * 3;
    particle.innerHTML = holidayMarks[kind];
    particle.style.width = `${size}px`; particle.style.height = `${size}px`;
    particle.style.color = kind === 'snow' ? '#f1fcff' : holidayColors[n % holidayColors.length];
    const angle = -Math.PI + .18 + n / (count - 1) * (Math.PI - .36);
    const distance = (grand ? 100 : 66) + n % 5 * 12;
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance - 15;
    const spin = (n % 2 ? 1 : -1) * (70 + n * 17);
    temporary(particle, [
      { transform: 'translate(-50%,-50%) scale(.15) rotate(0deg)', opacity: 0 },
      { transform: `translate(calc(-50% + ${dx * .65}px),calc(-50% + ${dy * .8}px)) scale(1.1) rotate(${spin * .5}deg)`, opacity: 1, offset: .3 },
      { transform: `translate(calc(-50% + ${dx}px),calc(-50% + ${dy + 42}px)) scale(.55) rotate(${spin}deg)`, opacity: 0 },
    ], { duration: (grand ? 1150 : 850) + n % 5 * 55, delay: n % 4 * 12, easing: 'cubic-bezier(.16,.5,.35,1)', fill: 'both' });
  }
  for (let n = 0; n < (grand ? 10 : 6); n++) {
    const glint = effectNode('holiday-glint', x + (n % 2 ? -1 : 1) * (18 + n * 8), y - 7 - n % 3 * 14);
    temporary(glint, [
      { transform: 'scale(0)', opacity: 0 },
      { transform: 'translateY(-18px) scale(1)', opacity: 1, offset: .25 },
      { transform: 'translateY(-70px) scale(0)', opacity: 0 },
    ], { duration: 650 + n * 35, delay: 70 + n * 20, fill: 'both' });
  }
}
function catchEffect(object) {
  const x = game.characterX, y = game.catchY;
  const image = document.createElement('img');
  const [w, h] = ITEM_SIZES[object.kind];
  image.src = `assets/item-${object.kind}.webp`; image.className = 'falling-item caught-item';
  image.style.width = `${w}px`; image.style.height = `${h}px`;
  // This layer sits between the character and the front of its sack.
  image.style.zIndex = '22'; scene.append(image);
  temporary(image, [
    { transform: `translate(${object.x - w / 2}px,${object.y - h / 2}px) scale(1)`, opacity: 1 },
    { transform: `translate(${x - w / 2}px,${object.y - h / 2 - 5}px) scale(1.05) rotate(-3deg)`, opacity: 1, offset: .2 },
    { transform: `translate(${x - w / 2}px,${y + 28 - h / 2}px) scale(.06) rotate(6deg)`, opacity: 0 },
  ], { duration: reducedMotion ? 60 : 340, easing: 'cubic-bezier(.22,.1,.45,1)', fill: 'forwards' });
  for (const id of ['character', 'character-front']) {
    if (!reducedMotion) animate($(id), [
      { scale: '1 1' },
      { scale: '1.018 .985', offset: .3 },
      { scale: '.995 1.007', offset: .65 },
      { scale: '1 1' },
    ], { duration: 340, easing: 'cubic-bezier(.25,.46,.45,.94)' });
  }
  holidayBurst(x, y - 5);
  const labelX = Math.max(45, Math.min(330, x + (x < 210 ? 57 : -57)));
  const label = effectNode('catch-score', labelX, y - 54);
  label.innerHTML = `<img src="assets/coin.webp" alt=""><strong>+${object.value}</strong>`;
  temporary(label, reducedMotion ? [{ opacity: 1 }, { opacity: 0 }] : [
    { transform: 'translate(-50%,0) scale(.78)', opacity: 0 },
    { transform: 'translate(-50%,-10px) scale(1.04)', opacity: 1, offset: .2 },
    { transform: 'translate(-50%,-17px) scale(1)', opacity: 1, offset: .55 },
    { transform: 'translate(-50%,-44px) scale(.95)', opacity: 0 },
  ], { duration: reducedMotion ? 350 : 1000, easing: 'cubic-bezier(.2,.55,.35,1)', fill: 'both' });
  if (!reducedMotion) {
    const coin = document.createElement('img'); coin.src = 'assets/coin.webp'; coin.className = 'flying-coin';
    $('effects').append(coin);
    const arcX = x + (x > 185 ? -42 : 42);
    temporary(coin, [
      { transform: `translate(${x - 14}px,${y - 13}px) scale(.6)`, opacity: 0 },
      { transform: `translate(${arcX - 14}px,${y - 108}px) scale(1.2)`, opacity: 1, offset: .24 },
      { transform: `translate(${(arcX + 148) / 2}px,${(y - 108 + 91) / 2}px) scale(1)`, opacity: 1, offset: .58 },
      { transform: 'translate(148px,91px) scale(.65)', opacity: 0 },
    ], { duration: 880, easing: 'cubic-bezier(.22,.6,.35,1)', fill: 'forwards' });
    animate($('coin-stat'), [
      { boxShadow: '0 0 0 0 #ffdd8999' },
      { boxShadow: '0 0 0 5px #ffdd8980, 0 0 24px #ffda6b99', offset: .3 },
      { boxShadow: '0 0 0 10px #ffdd8900' },
    ], { duration: 550 });
  }
  pop($('coin-stat')); beep();
}

function confetti(target, win = false) {
  target.replaceChildren();
  for (const [index, art] of CONFETTI.entries()) {
    if (index === 0) continue;
    const piece = document.createElement('img'); piece.src = `assets/${art.name}.svg`; piece.alt = '';
    const x = win ? (art.x - 87) * 1.4 : art.x;
    const y = win ? (art.y - 155) * .9 : art.y + (game.height - 672) / 2;
    piece.style.left = `${x}px`; piece.style.top = `${y}px`;
    piece.style.setProperty('--from-x', `${(win ? 150 : 187.5) - x}px`);
    piece.style.setProperty('--from-y', `${(win ? 270 : game.height / 2 + 12) - y}px`);
    piece.style.setProperty('--spin', `${(index % 2 ? 1 : -1) * index * 27}deg`);
    piece.style.animationDelay = `${index % 5 * 24}ms`;
    target.append(piece);
  }
}
function processEvents(events) {
  for (const event of events) {
    if (event.type === 'catch') catchEffect(event.object);
    else if (event.type === 'reward') rewardQueue.push(event.rewards);
    else if (event.type === 'finish') { finishRound(); return; }
  }
  if (rewardQueue.length && !rewardBusy) nextReward();
  render();
}
function nextReward() {
  if (!rewardQueue.length) { rewardBusy = false; setModal(null); resume(); return; }
  rewardBusy = true; game.pause(); smile = true; setModal(null); render();
  const count = rewardQueue.shift();
  rewardTimers.push(setTimeout(() => showReward(count), reducedMotion ? 220 : 450));
}
function showReward(count) {
  $('reward-message').innerHTML = count === 1 ? 'Приз<br>1 из 3 доступен!' : `Призы<br>${count} из 3 доступны!`;
  $('all-prizes-actions').hidden = count !== 3;
  $('reward-plus').hidden = count === 3;
  paintReward(count); setModal('reward'); confetti($('reward-confetti'));
  $('announcer').textContent = `${count} из трёх призов доступны`;
  beep(true); render();
  if (count < 3) {
    rewardTimers.push(setTimeout(() => $('reward-layer').classList.add('leaving'), 2650));
    rewardTimers.push(setTimeout(closeReward, 3000));
  }
}
function closeReward() {
  clearRewardTimers(); smile = false; rewardBusy = false; setModal(null);
  if (rewardQueue.length) nextReward(); else resume();
}
async function finishRound() {
  if (finishing || !roundId) return;
  finishing = true; game.pause(); game.status = 'finished'; game.release();
  clearRewardTimers(); rewardBusy = false; smile = false; rewardQueue = [];
  game.objects = []; render();
  await transaction(l => l.commitRound(roundId, game.coins, prizeNow()));
  const available = ledger.state.pending.length;
  const rating = !available && ledger.state.earned === 3;
  setCounter('result-coins', ledger.state.coins, 'bold18', 21);
  setCounter('result-prizes', `${rating ? 3 : available} из 3`, 'bold18', 21);
  $('result-claim').disabled = available === 0;
  $('result-claim').textContent = available ? 'Забрать призы' : ledger.state.earned === 3 ? 'Все призы получены' : 'У вас 0 призов';
  // A settled round with pending prizes must be drawn before another round starts.
  $('result-replay').disabled = available > 0;
  $('result-replay').title = available > 0 ? 'Сначала получите все доступные призы' : '';
  paintResult(rating ? 'rating' : available ? 'available' : 'zero');
  setModal('result'); render();
}

function renderCabinet() {
  const list = $('prize-list'); list.replaceChildren();
  if (!ledger.state.prizes.length) {
    const empty = document.createElement('div'); empty.className = 'empty-ticket';
    const p = document.createElement('p'); p.textContent = 'Здесь будут ваши призы'; empty.append(p); list.append(empty); paintEmpty(p);
  }
  for (const won of ledger.state.prizes) {
    const prize = PRIZES[won.prizeId];
    const card = document.createElement('article'); card.className = 'prize-ticket'; card.dataset.prize = won.prizeId;
    card.innerHTML = `<div class="prize-illustration"><img src="assets/${prize.image}" alt=""></div><div class="prize-info"><div class="ticket-meta"><span>${prize.category}</span><span class="valid-until">Действует до 07.11</span></div><h2>${prize.title}</h2><div class="ticket-code"><button class="code-copy" data-code="${prize.code}" aria-label="Скопировать ${prize.code}"><span>${prize.code}</span><span class="copy-icon" aria-hidden="true"></span></button><button class="ticket-activate">Активировать</button></div></div>`;
    card.querySelector('.ticket-activate').addEventListener('click', () => {
      if (ledger.locked) { restoreDraw(); return; }
      $('coupon-scroll').scrollTop = 0; showScreen('coupon');
    });
    list.append(card); paintPrizeCard(card, won.prizeId);
  }
  $('cabinet-play').textContent = cabinetReturn ? 'Продолжить игру' : 'Играть еще';
}
async function copyCode(code) {
  let success = false;
  try { await navigator.clipboard.writeText(code); success = true; }
  catch {
    const input = document.createElement('textarea'); input.value = code;
    input.style.cssText = 'position:absolute;left:-9999px'; scene.append(input); input.select();
    try { success = document.execCommand('copy'); } catch { /* Keep the visible code available. */ }
    input.remove();
  }
  clearTimeout(toastTimer);
  $('copy-toast').textContent = success ? 'Промокод скопирован' : code;
  $('copy-toast').hidden = false; toastTimer = setTimeout(() => $('copy-toast').hidden = true, 1800);
}
scene.addEventListener('click', event => {
  const button = event.target.closest('[data-code]');
  if (button && !button.disabled) copyCode(button.dataset.code);
});

const reelOrder = ['hoff', 'rossko5', 'rossko10'];
const reelId = index => reelOrder[((index % 3) + 3) % 3];
function buildReel() {
  const track = $('reel-track'); track.replaceChildren();
  const items = [];
  for (let index = -36; index <= 2; index++) {
    const id = reelId(index), prize = PRIZES[id], img = document.createElement('img');
    const g = prizeGeometry(id), { width: w, height: h } = g;
    img.className = 'reel-item' + (index < -1 || index > 1 ? ' extra' : ''); img.src = `assets/${prize.image}`; img.alt = prize.title;
    img.style.width = `${w}px`; img.style.height = `${h}px`; img.style.left = `${33 + g.left}px`;
    track.append(img); items.push({ index, img, top: g.top });
  }
  reel = { items, gap: 176, offset: 0, targetIndex: -30 };
  layoutReel(176);
}
function layoutReel(gap) {
  if (!reel) return;
  reel.gap = gap;
  // The Figma pointers align with the discount label, below the illustration centre.
  const center = 271 + gap - 176;
  for (const item of reel.items) item.img.style.top = `${center + item.index * gap - 85 + item.top}px`;
}
function showRoulette() {
  if (ledger.state.lastWin) { showWin(); return; }
  if (!ledger.state.pending.length) { renderCabinet(); showScreen('cabinet'); return; }
  setModal(null); buildReel(); showScreen('roulette');
  const day = ledger.state.pending[0].day;
  const received = ledger.state.prizes.filter(p => p.day === day).length;
  const total = received + ledger.state.pending.filter(p => p.day === day).length;
  setCounter('spin-count', `${received + 1}/${total}`, 'bold16', 19);
  $('spin-button').disabled = Boolean(ledger.state.spin);
  $('roulette-screen').classList.toggle('spinning', Boolean(ledger.state.spin));
  if (ledger.state.spin) configureSpin();
}
function restoreDraw() {
  if (ledger.state.lastWin) showWin(); else showRoulette();
}
function configureSpin() {
  const spin = ledger.state.spin;
  if (!spin || !reel) return;
  const token = ledger.state.pending.find(p => p.id === spin.pendingId);
  if (!token) return;
  for (let index = -30; index >= -32; index--) if (reelId(index) === token.prizeId) reel.targetIndex = index;
  $('spin-button').disabled = true;
  $('roulette-screen').classList.add('spinning');
}
async function spin() {
  if (ledger.state.spin || $('spin-button').disabled) return;
  $('spin-button').disabled = true;
  await transaction(l => l.startSpin());
  configureSpin();
}
let settlingSpin = false;
function animateReel() {
  const spin = ledger.state.spin;
  if (!reel || !spin || screenName !== 'roulette') return;
  const t = Math.max(0, Math.min(1, (Date.now() - spin.startedAt) / SPIN_MS));
  const spread = Math.min(1, t / .075);
  const gap = 176 + 35 * (1 - (1 - spread) ** 3);
  layoutReel(gap);
  let distance;
  if (t < .08) distance = -17 * Math.sin(t / .08 * Math.PI);
  else {
    const q = (t - .08) / .92;
    const eased = q < .35 ? .5 * (q / .35) ** 2 : 1 - .5 * (1 - (q - .35) / .65) ** 3;
    distance = -reel.targetIndex * 211 * eased;
  }
  $('reel-track').style.transform = `translateY(${distance}px)`;
  if (t === 1 && !settlingSpin) {
    settlingSpin = true;
    transaction(l => l.finishSpin()).then(() => {
      settlingSpin = false;
      if (ledger.state.lastWin) showWin();
    });
  }
}
function showWin() {
  const result = ledger.state.lastWin;
  if (!result) { showRoulette(); return; }
  const prize = PRIZES[result.prizeId];
  $('won-prize').src = `assets/${prize.image}`; $('won-prize').alt = prize.title;
  $('won-title').textContent = prize.title;
  $('win-next').textContent = ledger.state.pending.length ? 'Получить еще призы' : 'Перейти в Мои призы';
  showScreen('win'); paintWin(result.prizeId); beep(true);
}
$('play-button').addEventListener('click', startRound);
$('entry-prizes').addEventListener('click', openCabinet);
$('game-prizes').addEventListener('click', openCabinet);
$('game-home').addEventListener('click', home);
$('cabinet-home').addEventListener('click', home);
$('teaching-dismiss').addEventListener('click', () => {
  if (modal !== 'teaching') return;
  $('teaching-layer').classList.add('leaving');
  setTimeout(() => { if (modal === 'teaching') { setModal(null); resume(); } }, 240);
});
$('help-button').addEventListener('click', () => { pause(); if (!rewardBusy && !finishing) setModal('help'); });
$('help-close').addEventListener('click', () => { setModal(null); resume(); });
$('sound-button').addEventListener('click', () => {
  soundOn = !soundOn; $('sound-button').setAttribute('aria-pressed', String(soundOn));
  $('sound-button').setAttribute('aria-label', soundOn ? 'Выключить звук' : 'Включить звук'); beep();
});
$('reward-continue').addEventListener('click', closeReward);
$('reward-claim').addEventListener('click', finishRound);
$('result-claim').addEventListener('click', showRoulette);
$('result-replay').addEventListener('click', startRound);
$('rating-replay').addEventListener('click', startRound);
$('rating-prizes').addEventListener('click', openCabinet);
$('cabinet-play').addEventListener('click', () => {
  if (cabinetReturn && game.status === 'paused' && roundId) { showScreen('game'); setModal(null); resume(); }
  else startRound();
});
$('coupon-back').addEventListener('click', () => { renderCabinet(); showScreen('cabinet'); });
$('spin-button').addEventListener('click', spin);
$('win-next').addEventListener('click', async () => {
  $('win-next').disabled = true;
  await transaction(l => l.acknowledgeWin());
  $('win-next').disabled = false;
  if (ledger.state.pending.length) showRoulette();
  else { cabinetReturn = false; roundId = null; renderCabinet(); showScreen('cabinet'); }
});
window.addEventListener('storage', event => {
  if (event.key === DEMO_CLOCK_KEY) { location.reload(); return; }
  if (event.key !== STORAGE_KEY) return;
  ledger = new PrizeLedger(readSaved(), prizeNow());
  renderAdmin();
  render();
  if (screenName === 'cabinet') renderCabinet();
  if (screenName === 'roulette' && ledger.state.lastWin) showWin();
});

function renderAdmin() {
  const date = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric' }).format(prizeNow());
  const status = `${date} МСК · призы ${ledger.state.earned}/3`;
  if ($('admin-state').textContent !== status) $('admin-state').textContent = status;
}
$('admin-toggle').addEventListener('click', () => {
  const expanded = $('admin-toggle').getAttribute('aria-expanded') !== 'true';
  $('admin-toggle').setAttribute('aria-expanded', String(expanded));
  $('admin-toggle').textContent = expanded ? 'ADMIN ▴' : 'ADMIN ▾';
  $('admin-panel').hidden = !expanded; renderAdmin();
});
async function adminAction(reset) {
  if (adminBusy) return;
  adminBusy = true; game.pause();
  $('admin-next-day').disabled = true; $('admin-reset').disabled = true;
  try {
    await transaction(l => {
      demoDays = reset ? 0 : Math.min(10000, readDemoDays() + 1);
      if (reset) l.state = new PrizeLedger(null, prizeNow()).state;
      else l.refreshDay(prizeNow());
      // A revision also reloads other demo tabs when resetting an already-zero offset.
      try { localStorage.setItem(DEMO_CLOCK_KEY, JSON.stringify({ days: demoDays, revision: crypto.randomUUID() })); } catch { /* Optional demo storage. */ }
    });
    location.reload();
  } catch {
    adminBusy = false; $('admin-next-day').disabled = false; $('admin-reset').disabled = false;
    $('admin-state').textContent = 'Не удалось выполнить действие. Попробуйте ещё раз.';
    resume();
  }
}
$('admin-next-day').addEventListener('click', () => adminAction(false));
$('admin-reset').addEventListener('click', () => adminAction(true));

function frame() { if (!adminBusy) { syncClock(); if (screenName === 'game') render(); animateReel(); } requestAnimationFrame(frame); }
initUI(); sizeScene();
if (ledger.locked) restoreDraw();
requestAnimationFrame(frame);
