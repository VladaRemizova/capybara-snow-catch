import { CatchGame, ITEM_SIZES, ITEM_TYPES } from './game-core.mjs';

const $ = id => document.getElementById(id);
const scene = $('scene'), phone = $('phone'), field = $('falling-field');
const game = new CatchGame();
const nodes = new Map();
let scale = 1, origin = 0, heldElapsed = 0, modalMode = 'intro', lastFocus = null;
let toastTimer, tutorialHideTimer, soundOn = false, audio = null;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const introHTML = $('modal-content').innerHTML;

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
  if (event.target.closest('button, .modal-layer') || (event.pointerType === 'mouse' && event.button !== 0)) return;
  syncClock();
  const { x, y } = point(event);
  if (!game.beginDrag(event.pointerId, x, y)) return;
  scene.setPointerCapture(event.pointerId);
  scene.classList.add('dragging');
  clearTimeout(tutorialHideTimer);
  tutorialHideTimer = setTimeout(() => { $('tutorial').hidden = true; }, 900);
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
  game.release(event?.pointerId);
  scene.classList.toggle('dragging', game.pointerId !== null);
}
scene.addEventListener('pointerup', release);
scene.addEventListener('pointercancel', release);
scene.addEventListener('lostpointercapture', release);
window.addEventListener('blur', () => { game.release(); scene.classList.remove('dragging'); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { game.release(); scene.classList.remove('dragging'); }
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
function catchEffect(object) {
  const image = document.createElement('img');
  const [w, h] = ITEM_SIZES[object.kind];
  image.src = `assets/${object.kind}.png`; image.className = 'falling-item caught-item';
  image.style.width = `${w}px`; image.style.height = `${h}px`;
  // This layer sits between the character and the front of its sack.
  image.style.zIndex = '22'; scene.append(image);
  temporary(image, [
    { transform: `translate(${object.x - w / 2}px,${object.y - h / 2}px) scale(1)`, opacity: 1 },
    { transform: `translate(${game.characterX - w / 2}px,${game.catchY + 20 - h / 2}px) scale(.15)`, opacity: 0 },
  ], { duration: reducedMotion ? 60 : 240, easing: 'cubic-bezier(.35,0,.7,1)', fill: 'forwards' });
  for (const id of ['character', 'character-front']) {
    if (!reducedMotion) animate($(id), [{ scale: '1 1' }, { scale: '1.035 .965', offset: .3 }, { scale: '.985 1.025', offset: .65 }, { scale: '1 1' }], { duration: 270 });
  }
  const label = document.createElement('span'); label.className = 'plus-one'; label.textContent = '+1';
  label.style.left = `${game.characterX + 26}px`; label.style.top = `${game.catchY - 19}px`; $('effects').append(label);
  temporary(label, [{ transform: 'translateY(0) scale(.75)', opacity: 1 }, { transform: 'translateY(-42px) scale(1.1)', opacity: 0 }], { duration: reducedMotion ? 160 : 650, easing: 'ease-out' });
  if (!reducedMotion) {
    for (let n = 0; n < 7; n++) {
      const spark = document.createElement('i'); spark.className = 'spark';
      spark.style.left = `${game.characterX}px`; spark.style.top = `${game.catchY}px`; $('effects').append(spark);
      const angle = Math.PI + n / 6 * Math.PI;
      temporary(spark, [{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${Math.cos(angle) * 48}px,${Math.sin(angle) * 45 - 10}px) scale(.2)`, opacity: 0 }], { duration: 420 + n * 25, easing: 'ease-out' });
    }
    const coin = document.createElement('img'); coin.src = 'assets/coin.png'; coin.className = 'flying-coin';
    $('effects').append(coin);
    temporary(coin, [
      { transform: `translate(${game.characterX - 12}px,${game.catchY - 12}px) scale(.8)`, opacity: 0 },
      { transform: `translate(${game.characterX - 20}px,${game.catchY - 65}px) scale(1.1)`, opacity: 1, offset: .2 },
      { transform: 'translate(148px,91px) scale(.6)', opacity: 0 },
    ], { duration: 650, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'forwards' });
  }
  pop($('coin-stat')); beep();
}
function toast(text) {
  clearTimeout(toastTimer); $('toast').textContent = text; $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 2000);
}
function processEvents(events) {
  for (const event of events) {
    if (event.type === 'catch') catchEffect(event.object);
    if (event.type === 'reward') {
      toast(`Награда ${event.rewards} из 3 получена!`);
      $('announcer').textContent = `Получена награда ${event.rewards} из трёх`;
      pop($('reward-stat')); pop($('total-rewards')); beep(true);
    }
    if (event.type === 'tutorial-complete') {
      $('tutorial').hidden = true;
      toast('Отлично! Теперь предметов станет больше');
    }
    if (event.type === 'finish') {
      $('tutorial').hidden = true; scene.classList.remove('dragging');
      $('announcer').textContent = `Время вышло. Поймано ${game.coins} монет. Наград: ${game.progress.rewards}`;
      showResult();
    }
  }
}
function renderCharacter() {
  const transform = `translate(${game.characterX - 92.5}px,${game.characterY}px)`;
  for (const id of ['character', 'character-front']) {
    $(id).style.left = '0'; $(id).style.top = '0'; $(id).style.transform = transform;
  }
}
function render() {
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
function pause() { syncClock(); heldElapsed = game.elapsed; game.pause(); scene.classList.remove('dragging'); }
function resume() {
  if (game.status === 'paused') { origin = performance.now() - heldElapsed * 1000; game.resume(); }
}
function showModal(mode, content) {
  lastFocus = document.activeElement; modalMode = mode;
  $('modal-content').innerHTML = content; $('modal-layer').hidden = false;
  $('modal').classList.toggle('intro-modal', mode === 'intro');
  requestAnimationFrame(() => $('modal-content').querySelector('button')?.focus({ preventScroll: true }));
}
function hideModal() {
  $('modal-layer').hidden = true; modalMode = null;
  if (lastFocus instanceof HTMLElement) lastFocus.focus({ preventScroll: true });
}
function cleanEffects() {
  clearTimeout(toastTimer); clearTimeout(tutorialHideTimer);
  $('toast').hidden = true; $('tutorial').hidden = true;
  for (const animation of scene.getAnimations({ subtree: true })) animation.cancel();
  $('effects').replaceChildren(); scene.querySelectorAll('.caught-item').forEach(n => n.remove());
  scene.classList.remove('dragging', 'ready-to-grab');
}
function startGame() {
  cleanEffects(); game.start(); origin = performance.now(); hideModal(); render();
  $('tutorial').hidden = false; beep();
}
function showIntro() {
  cleanEffects(); game.reset(); render();
  showModal('intro', introHTML);
}
const plural = (n, one, few, many) => n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many;
function showResult() {
  const p = game.progress;
  showModal('result', `
    <h1 id="modal-title">Поймано ${game.coins} ${plural(game.coins, 'монета', 'монеты', 'монет')}!</h1>
    <div class="result-stats">
      <div class="result-stat"><img src="assets/timer.png" alt=""><div><small>Время игры</small><strong>01:00</strong></div></div>
      <div class="result-stat"><img src="assets/coin.png" alt=""><div><small>Монеты</small><strong>${game.coins}</strong></div></div>
    </div>
    <div class="result-reward"><img src="assets/reward.png" alt=""><div><strong>${p.rewards} ${plural(p.rewards, 'награда', 'награды', 'наград')}</strong><p>${p.rewards === 3 ? 'Вы собрали все награды за игру!' : `До ${p.rewards === 0 ? 'первой' : 'следующей'} награды — ${p.remaining} ${plural(p.remaining, 'монета', 'монеты', 'монет')}`}</p></div></div>
    <button class="primary" data-action="rewards">Мои награды (${p.rewards})</button>
    <button class="secondary" data-action="restart">Сыграть ещё</button>
    <button class="text-button" data-action="intro">На главный экран</button>`);
}
function showRewards() {
  const previous = modalMode;
  pause();
  const p = game.progress;
  showModal('rewards', `
    <h2 id="modal-title">Ваши награды</h2>
    <p class="reward-description">${p.rewards === 3 ? 'Все три награды уже ваши!' : `Вы получили ${p.rewards} из 3 наград за этот раунд.`}</p>
    <div class="reward-cards">${[20, 30, 40].map((target, i) => `<div class="reward-card ${game.coins >= target ? 'earned' : ''}"><img src="assets/reward.png" alt=""><strong>Награда ${i + 1}</strong>${target} монет</div>`).join('')}</div>
    <p class="reward-description">За один раунд можно получить<br>не больше трёх наград.</p>
    <button class="primary" data-action="${previous === 'result' || game.status === 'finished' ? 'result' : game.status === 'idle' ? 'intro' : 'resume'}">${game.status === 'paused' ? 'Продолжить игру' : 'Понятно'}</button>`);
}
function showRules() {
  pause();
  showModal('rules', `
    <h2 id="modal-title">Как играть</h2>
    <ol class="rules">
      <li><b>1</b><span>Зажмите капибару и ведите пальцем влево-вправо. Чтобы продолжить после отпускания, коснитесь самой капибары.</span></li>
      <li><b>2</b><span>Ловите предметы в мешок. Каждый приносит одну монету. Штрафов за пропуски нет.</span></li>
      <li><b>3</b><span>У вас 60 секунд. Через первые 10 секунд предметов станет больше и они начнут падать быстрее.</span></li>
      <li><b>4</b><span>20, 30 и 40 монет дают одну, две и три награды. После 40 монет продолжайте собирать!</span></li>
    </ol><button class="primary" data-action="${game.status === 'paused' ? 'resume' : game.status === 'finished' ? 'result' : 'intro'}">${game.status === 'paused' ? 'Продолжить игру' : 'Понятно'}</button>`);
}
$('modal-content').addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button) return;
  const action = button.id === 'start-button' ? 'restart' : button.dataset.action;
  if (action === 'restart') startGame();
  if (action === 'resume') { hideModal(); resume(); }
  if (action === 'intro') showIntro();
  if (action === 'result') showResult();
  if (action === 'rewards') showRewards();
});
$('reset-button').addEventListener('click', startGame);
$('close-button').addEventListener('click', showIntro);
$('help-button').addEventListener('click', showRules);
$('rewards-button').addEventListener('click', showRewards);
$('sound-button').addEventListener('click', () => {
  soundOn = !soundOn;
  $('sound-button').setAttribute('aria-pressed', String(soundOn));
  $('sound-button').setAttribute('aria-label', soundOn ? 'Выключить звук' : 'Включить звук');
  beep();
});
document.addEventListener('keydown', event => {
  if ($('modal-layer').hidden) return;
  const buttons = [...$('modal').querySelectorAll('button')];
  if (event.key === 'Tab') {
    const first = buttons[0], last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  if (event.key === 'Escape' && game.status === 'paused') { hideModal(); resume(); }
});
// Load every product before the timer begins; the initial button remains disabled while loading.
const startButton = $('start-button'); startButton.disabled = true; startButton.textContent = 'Загружаем игру…';
Promise.all([...ITEM_TYPES, 'capybara', 'foreground', 'background', 'result-art'].map(name => new Promise(resolve => {
  const image = new Image(); image.onload = () => resolve(true); image.onerror = () => resolve(false); image.src = `assets/${name}.png`;
}))).then(results => {
  startButton.disabled = false;
  startButton.textContent = results.every(Boolean) ? 'Начать игру' : 'Повторить загрузку';
  if (!results.every(Boolean)) startButton.addEventListener('click', event => { event.stopImmediatePropagation(); location.reload(); }, { capture: true });
});
sizeScene();
function frame() { syncClock(); render(); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
