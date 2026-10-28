import { CatchGame, ITEM_SIZES, ITEM_TYPES } from './game-core.mjs';
import { PRIZE_PIECES } from './prize-art.mjs';

const $ = id => document.getElementById(id);
const scene = $('scene'), phone = $('phone'), field = $('falling-field');
const game = new CatchGame();
const nodes = new Map();
let scale = 1, origin = 0, heldElapsed = 0, modalMode = null, lastFocus = null;
let teachingTimer, prizeTimer, prizeEndTimer, soundOn = false, audio = null;
let teachingReturn = false, prizeShowing = false, finishPending = false;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;


function sizeScene() {
  scale = phone.clientWidth / 375;
  const height = Math.max(500, phone.clientHeight / scale);
  game.setHeight(height);
  scene.style.height = `${height}px`;
  scene.style.transform = `scale(${scale})`;
  render();
}
new ResizeObserver(sizeScene).observe(phone);

function point(event) {
  const rect = scene.getBoundingClientRect();
  return { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale };
}
function syncClock() {
  if (game.status === 'running') processEvents(game.advanceTo((performance.now() - origin) / 1000));
}
scene.addEventListener('pointerdown', event => {
  if (event.target.closest('button, .modal-layer, .teaching-layer, .prize-layer') || (event.pointerType === 'mouse' && event.button !== 0)) return;
  syncClock();
  const { x, y } = point(event);
  if (!game.beginDrag(event.pointerId, x, y)) return;
  scene.setPointerCapture(event.pointerId);
  scene.classList.add('dragging');
  event.preventDefault();
});
scene.addEventListener('pointermove', event => {
  const { x, y } = point(event);
  // Resolve the preceding travel at the preceding character position first.
  syncClock();
  if (game.drag(event.pointerId, x)) { renderCharacter(); event.preventDefault(); }
  scene.classList.toggle('ready-to-grab', game.status === 'running' && game.containsCharacter(x, y));
});
function release(event) {
  syncClock();
  game.release(event?.pointerId);
  scene.classList.toggle('dragging', game.pointerId !== null);
  renderCharacter();
}
scene.addEventListener('pointerup', release);
scene.addEventListener('pointercancel', release);
scene.addEventListener('lostpointercapture', release);
window.addEventListener('blur', () => release());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) release();
  else { syncClock(); render(); }
});

function animate(node, frames, options) {
  const animation = node.animate(frames, options);
  return animation;
}
function temporary(node, frames, options) {
  const animation = animate(node, frames, options);
  animation.finished.then(() => node.remove()).catch(() => node.remove());
}
function pop(node) {
  if (!reducedMotion) animate(node, [{ transform: 'scale(1)' }, { transform: 'scale(1.12)', offset: .35 }, { transform: 'scale(1)' }], { duration: 250 });
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
  image.src = `assets/${object.kind}.png`; image.className = 'falling-item caught-item';
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
  label.innerHTML = '<img src="assets/coin.png" alt=""><strong>+1</strong>';
  temporary(label, reducedMotion ? [{ opacity: 1 }, { opacity: 0 }] : [
    { transform: 'translate(-50%,0) scale(.78)', opacity: 0 },
    { transform: 'translate(-50%,-10px) scale(1.04)', opacity: 1, offset: .2 },
    { transform: 'translate(-50%,-17px) scale(1)', opacity: 1, offset: .55 },
    { transform: 'translate(-50%,-44px) scale(.95)', opacity: 0 },
  ], { duration: reducedMotion ? 350 : 1000, easing: 'cubic-bezier(.2,.55,.35,1)', fill: 'both' });
  if (!reducedMotion) {
    const coin = document.createElement('img'); coin.src = 'assets/coin.png'; coin.className = 'flying-coin';
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
function prizeConfetti() {
  const container = $('prize-confetti'); container.replaceChildren();
  for (const [n, art] of PRIZE_PIECES.entries()) {
    if (n === 0) continue;
    const piece = document.createElement('img');
    piece.src = `assets/${art.name}.png`; piece.alt = ''; piece.className = 'prize-piece';
    piece.style.left = `${art.x}px`; piece.style.top = `${art.y}px`;
    piece.style.width = `${art.w}px`; piece.style.height = `${art.h}px`;
    if (n >= 3) {
      piece.style.setProperty('--from-x', `${187.5-art.x-art.w/2}px`);
      piece.style.setProperty('--from-y', `${371-art.y-art.h/2}px`);
      piece.style.setProperty('--spin', `${n*53}deg`);
      piece.style.animationDelay = `${n%6*22}ms`;
    } else {
      piece.style.animation = 'none'; piece.style.zIndex = n === 0 ? '-1' : '4';
    }
    container.append(piece);
  }
}
function showPrize(rewards) {
  heldElapsed = game.elapsed; game.pause();
  scene.classList.remove('dragging', 'ready-to-grab');
  prizeShowing = true;
  $('prize-message').textContent = `${rewards} из 3 получена!`;
  $('prize-layer').classList.remove('leaving'); $('prize-layer').hidden = false;
  prizeConfetti();
  $('announcer').textContent = `Получена награда ${rewards} из трёх`;
  beep(true);
  prizeTimer = setTimeout(() => $('prize-layer').classList.add('leaving'), 2650);
  prizeEndTimer = setTimeout(() => {
    $('prize-layer').hidden = true; prizeShowing = false;
    $('prize-confetti').replaceChildren();
    if (finishPending || game.status === 'finished') { finishPending = false; showResult(); }
    else resume();
  }, 3000);
}
function processEvents(events) {
  for (const event of events) {
    if (event.type === 'catch') catchEffect(event.object);
    if (event.type === 'reward') {
      pop($('reward-stat')); pop($('total-rewards')); showPrize(event.rewards);
    }
    if (event.type === 'finish') {
      scene.classList.remove('dragging');
      $('announcer').textContent = `Время вышло. Поймано ${game.coins} монет. Наград: ${game.progress.rewards}`;
      if (prizeShowing) finishPending = true; else showResult();
    }
  }
}
function renderCharacter() {
  const transform = `translate(${game.characterX - 92.5}px,${game.characterY}px)`;
  for (const id of ['character', 'character-front']) {
    $(id).style.left = '0'; $(id).style.top = '0'; $(id).style.transform = transform;
    $(id).dataset.pose = game.pose;
  }
  scene.dataset.bagOpen = String(game.bagOpen);
}
function render() {
  scene.dataset.state = game.status;
  renderCharacter();
  $('timer').textContent = `${String(Math.floor(game.remaining / 60)).padStart(2, '0')}:${String(game.remaining % 60).padStart(2, '0')}`;
  $('timer').setAttribute('aria-label', `Осталось ${game.remaining} секунд`);
  document.querySelector('.time-stat').classList.toggle('urgent', game.remaining <= 10);
  $('coins').textContent = game.coins;
  const p = game.progress;
  $('rewards').textContent = `${p.rewards}/3`; $('total-rewards').textContent = p.rewards;
  $('reward-stat').classList.toggle('complete', p.rewards === 3);
  const progress = $('progress');
  progress.setAttribute('aria-label', p.rewards === 3 ? 'Все три награды получены' : `Монеты до награды ${p.rewards + 1}`);
  progress.setAttribute('aria-valuemax', p.rewards === 3 ? '40' : String(p.target - p.start));
  progress.setAttribute('aria-valuenow', p.rewards === 3 ? '40' : String(p.earned));
  progress.setAttribute('aria-valuetext', p.rewards === 3 ? 'Все три награды получены' : `${p.earned} из ${p.target - p.start} монет`);
  $('progress-fill').style.width = `${p.fraction * 100}%`;
  const activeIds = new Set();
  for (const object of game.objects) {
    activeIds.add(object.id);
    let node = nodes.get(object.id);
    if (!node) {
      node = document.createElement('img'); node.src = `assets/${object.kind}.png`; node.className = 'falling-item';
      const [w, h] = ITEM_SIZES[object.kind]; node.style.width = `${w}px`; node.style.height = `${h}px`;
      field.append(node); nodes.set(object.id, node);
    }
    const [w, h] = ITEM_SIZES[object.kind];
    node.style.transform = `translate(${object.x - w / 2}px,${object.y - h / 2 - 133}px)`;
  }
  for (const [id, node] of nodes) if (!activeIds.has(id)) { node.remove(); nodes.delete(id); }
}
function pause() {
  syncClock();
  if (game.status === 'running') { heldElapsed = game.elapsed; game.pause(); }
  scene.classList.remove('dragging');
}
function resume() {
  if (game.status === 'paused') { origin = performance.now() - heldElapsed * 1000; game.resume(); }
}
function showModal(mode, content) {
  lastFocus = document.activeElement; modalMode = mode;
  $('modal-content').innerHTML = content; $('modal-layer').hidden = false;
  $('modal').classList.toggle('result-modal', mode === 'result');
  requestAnimationFrame(() => $('modal-content').querySelector('button')?.focus({ preventScroll: true }));
}
function hideModal() {
  $('modal-layer').hidden = true; modalMode = null;
  if (lastFocus instanceof HTMLElement) lastFocus.focus({ preventScroll: true });
}
function cleanEffects() {
  clearTimeout(teachingTimer); clearTimeout(prizeTimer); clearTimeout(prizeEndTimer);
  $('prize-layer').hidden = true; $('teaching-layer').hidden = true;
  prizeShowing = false; finishPending = false;
  for (const id of ['effects', 'character', 'character-front', 'coin-stat', 'reward-stat', 'total-rewards']) {
    for (const animation of $(id).getAnimations({ subtree: true })) animation.cancel();
  }
  $('effects').replaceChildren(); scene.querySelectorAll('.caught-item').forEach(n => n.remove());
  scene.classList.remove('dragging', 'ready-to-grab');
}
function startGame() {
  cleanEffects(); game.start(); origin = performance.now(); hideModal(); render(); beep();
}
function finishTeaching() {
  $('teaching-layer').classList.add('leaving');
  teachingTimer = setTimeout(() => {
    $('teaching-layer').hidden = true;
    field.querySelectorAll('.demo-item').forEach(n => n.remove());
    if (teachingReturn) resume(); else startGame();
  }, 240);
}
function showTeaching(returnToGame = false) {
  if (prizeShowing) return;
  clearTimeout(teachingTimer);
  teachingReturn = returnToGame && game.status === 'running';
  if (teachingReturn) pause(); else { cleanEffects(); game.reset(); render(); }
  hideModal();
  $('teaching-layer').classList.remove('leaving'); $('teaching-layer').hidden = false;
  if (!teachingReturn) {
    const demo = [['oil',187.5,199],['coffee-lid',78.5,315],['sandwich',187.5,393],['hotdog',296.5,297],['coffee',296.5,481]];
    for (const [kind,x,y] of demo) {
      const image = document.createElement('img'), [w,h] = ITEM_SIZES[kind];
      image.src = `assets/${kind}.png`; image.className = 'falling-item demo-item';
      image.style.width = `${w}px`; image.style.height = `${h}px`;
      image.style.transform = `translate(${x-w/2}px,${y-h/2-133}px)`; field.append(image);
    }
  }
  teachingTimer = setTimeout(finishTeaching, 4200);
}
function setVariant(variant) {
  game.variant = variant;
  for (const image of scene.querySelectorAll('.capy-image')) image.src = `assets/capy-${variant}-${image.dataset.pose}.png`;
  $('variant-number').textContent = `${variant}/2`;
  $('variant-button').setAttribute('aria-label', `Выбрать капибару ${variant === 1 ? 2 : 1}`);
  scene.dataset.variant = String(variant); renderCharacter();
}
const plural = (n, one, few, many) => n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many;
function showResult() {
  const p = game.progress;
  showModal('result', `
    <h1 id="modal-title">Поймано ${game.coins} ${plural(game.coins, 'монета', 'монеты', 'монет')}!</h1>
    <div class="result-stats">
      <div class="result-stat"><img src="assets/timer.png" alt=""><div><small>ВРЕМЯ</small><strong>01:00</strong></div></div>
      <div class="result-stat"><img src="assets/coin.png" alt=""><div><small>МОНЕТЫ</small><strong>${game.coins}</strong></div></div>
    </div>
    <div class="result-reward"><img src="assets/result-prize-icon.png" alt=""><div><strong>+${p.rewards} ${plural(p.rewards, 'награда', 'награды', 'наград')}</strong><p>${p.rewards === 3 ? 'Все три награды получены!' : `Ещё ${p.remaining} ${plural(p.remaining, 'монета', 'монеты', 'монет')} до ${p.rewards === 2 ? 'третьей' : p.rewards === 1 ? 'второй' : 'первой'} награды`}</p></div></div>
    <div class="result-actions">
      <button class="primary" data-action="rewards" ${p.rewards === 0 ? 'disabled' : ''}>Открыть (${p.rewards})</button>
      <button class="secondary" data-action="restart">Сыграть еще</button>
      <button class="text-button" data-action="rewards">Мои награды</button>
    </div>`);
}
function showRewards() {
  const previous = modalMode;
  pause();
  if (prizeShowing) return;
  const p = game.progress;
  showModal('rewards', `
    <h2 id="modal-title">Ваши награды</h2>
    <p class="reward-description">${p.rewards === 3 ? 'Все три награды уже ваши!' : `Вы получили ${p.rewards} из 3 наград за этот раунд.`}</p>
    <div class="reward-cards">${[20, 30, 40].map((target, i) => `<div class="reward-card ${game.coins >= target ? 'earned' : ''}"><img src="assets/reward.png" alt=""><strong>Награда ${i + 1}</strong>${target} монет</div>`).join('')}</div>
    <p class="reward-description">За один раунд можно получить<br>не больше трёх наград.</p>
    <button class="primary" data-action="${previous === 'result' || game.status === 'finished' ? 'result' : game.status === 'idle' ? 'intro' : 'resume'}">${game.status === 'paused' ? 'Продолжить игру' : 'Понятно'}</button>`);
}
$('modal-content').addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button) return;
  const action = button.id === 'start-button' ? 'restart' : button.dataset.action;
  if (action === 'restart') startGame();
  if (action === 'resume') { hideModal(); resume(); }
  if (action === 'intro') showTeaching();
  if (action === 'result') showResult();
  if (action === 'rewards') showRewards();
});
$('reset-button').addEventListener('click', startGame);
$('close-button').addEventListener('click', () => showTeaching());
$('help-button').addEventListener('click', () => showTeaching(true));
$('variant-button').addEventListener('click', () => { syncClock(); setVariant(game.variant === 1 ? 2 : 1); });
$('rewards-button').addEventListener('click', showRewards);
$('sound-button').addEventListener('click', () => {
  soundOn = !soundOn;
  $('sound-button').setAttribute('aria-pressed', String(soundOn));
  $('sound-button').setAttribute('aria-label', soundOn ? 'Выключить звук' : 'Включить звук');
  beep();
});
document.addEventListener('keydown', event => {
  if ($('modal-layer').hidden || prizeShowing) return;
  const buttons = [...$('modal').querySelectorAll('button')];
  if (event.key === 'Tab') {
    const first = buttons[0], last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  if (event.key === 'Escape' && game.status === 'paused') { hideModal(); resume(); }
});
// Show the Figma teaching screen immediately and start its display time after assets load.
const preloadNames = [...ITEM_TYPES, ...[1,2].flatMap(v => ['open','left','right'].map(pose => `capy-${v}-${pose}`)), 'foreground', 'background', 'result-capy', 'prize-icon', 'gesture-dot', 'gesture-glint', 'stat-shade', 'result-shade', 'result-shadow', 'result-prize-icon', ...PRIZE_PIECES.map(p => p.name)];
Promise.all(preloadNames.map(name => new Promise(resolve => {
  const image = new Image(); image.onload = () => resolve(true); image.onerror = () => resolve(false); image.src = `assets/${name}.png`;
}))).then(results => {
  if (results.every(Boolean)) showTeaching();
  else {
    $('teaching-layer').querySelector('p').innerHTML = 'Не удалось загрузить игру.<br>Коснитесь, чтобы повторить';
    $('teaching-layer').addEventListener('click', () => location.reload(), { once: true });
  }
});
setVariant(1); sizeScene();
function frame() { syncClock(); render(); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
