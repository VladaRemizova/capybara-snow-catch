import { PROMO_ART, WIN_LIGHTS, COUPON_LIGHTS } from './promo-art.mjs?v=v3-nov13-3';
import { REEL_ART } from './roulette-art.mjs?v=v3-nov13-3';
import { UPDATED_ART } from './ui-updates.mjs?v=v3-nov13-3';
import { UI_ART as ORIGINAL_ART, UI_BOXES } from './ui-art.mjs?v=v3-nov13-3';
import { GLYPHS } from './ui-glyphs.mjs?v=v3-nov13-3';

const sharedWinParts = new Set(['win-box-layer','win-lid-layer','win-decor-layer']);
const sharedArt = Object.fromEntries(Object.entries({ ...ORIGINAL_ART, ...UPDATED_ART }).filter(([key]) => !key.startsWith('win-') || sharedWinParts.has(key)));
const UI_ART = { ...sharedArt, ...PROMO_ART };
for (const [key, file] of [['button-result-replay', 'button-result-retry-figma'], ['button-rating-play', 'button-rating-play-figma']]) {
  UI_ART[key] = { ...UI_ART[key], src: `assets/pixel/${file}.webp` };
}
UI_ART['win-saved-note'] = {src:'assets/pixel/win-saved-note.webp',box:{x:0,y:0,width:343,height:13},clip:{x:0,y:0,width:343,height:13},pixelWidth:686,pixelHeight:26,scale:2,kind:'text'};
const $ = id => document.getElementById(id);
const ready = new Map();
const glyphReady = new Set();
const counters = new Map();
const zeroBox = { x: 0, y: 0 };
function decode(src) {
  if (!ready.has(src)) {
    const img = new Image(); img.src = src;
    ready.set(src, img.decode().then(() => true).catch(() => false));
  }
  return ready.get(src);
}
function box(id) { return UI_BOXES[id] || Object.values(UI_ART).find(a => a.id === id)?.box || Object.values(UI_ART).find(a => a.rootId === id)?.rootBox || zeroBox; }
function geometry(node, b, origin = zeroBox) {
  Object.assign(node.style, { position: 'absolute', left: `${b.x - origin.x}px`, top: `${b.y - origin.y}px`, width: `${b.width}px`, height: `${b.height}px`, right: 'auto', bottom: 'auto', margin: '0', padding: '0' });
}
function paint(node, key, cls) {
  const a = UI_ART[key];
  if (!node || !a) return;
  if (node.dataset.paint === key) return;
  node.dataset.paint = key;
  const apply = () => {
    if (node.dataset.paint !== key || !node.isConnected) return;
    node.classList.add(cls);
    node.style.backgroundImage = `url("${a.src}")`;
    node.style.backgroundSize = `${a.pixelWidth / a.scale}px ${a.pixelHeight / a.scale}px`;
    node.style.backgroundPosition = `${a.clip.x - a.box.x}px ${a.clip.y - a.box.y}px`;
  };
  decode(a.src).then(ok => { if (ok) apply(); });
}
function text(node, key, originId = null, override = null) {
  const a = UI_ART[key]; if (!node || !a) return;
  if (override) geometry(node, override);
  else if (originId) geometry(node, a.box, box(originId));
  else Object.assign(node.style, { position: 'relative', display: 'block', width: `${a.box.width}px`, height: `${a.box.height}px`, flexShrink: '0' });
  paint(node, key, 'painted-text');
}
function image(node, key, originId = null, override = null) {
  const a = UI_ART[key]; if (!node || !a) return;
  node.src = a.src;
  const origin = originId ? box(originId) : a.rootBox;
  const b = override || { x: a.clip.x - origin.x, y: a.clip.y - origin.y, width: a.pixelWidth / a.scale, height: a.pixelHeight / a.scale };
  geometry(node, b); node.alt ||= '';
}
function graphic(node, key, originId = null, override = null) {
  const a = UI_ART[key]; if (!node || !a) return;
  if (override) geometry(node, override);
  else if (originId) geometry(node, a.box, box(originId));
  paint(node, key, 'painted-graphic');
}
function button(node, key, originId = null) {
  const a = UI_ART[key]; if (!node || !a) return;
  if (originId) geometry(node, a.box, box(originId));
  else Object.assign(node.style, { width: `${a.box.width}px`, height: `${a.box.height}px`, minHeight: `${a.box.height}px` });
  paint(node, key, 'art-button');
}
function addImage(parent, key, originId = null, cls = '') {
  const img = document.createElement('img'); img.className = cls; img.alt = '';
  parent.append(img); image(img, key, originId); return img;
}

for (const [key, font] of Object.entries(GLYPHS)) {
  Promise.all(Object.values(font.glyphs).filter(g => g.src).map(g => decode(g.src))).then(results => {
    if (results.every(Boolean)) glyphReady.add(key);
    for (const [node, value] of counters) if (value.font === key) setCounter(node, value.text, key, value.height);
  });
}
export function setCounter(target, value, fontKey = 'bold20', height = null) {
  const node = typeof target === 'string' ? $(target) : target; if (!node) return;
  const str = String(value), font = GLYPHS[fontKey];
  const complete = glyphReady.has(fontKey) && [...str].every(ch => font.glyphs[ch]);
  const token = `${fontKey}:${str}:${complete}`;
  counters.set(node, { text: str, font: fontKey, height });
  if (node.dataset.counter === token) return;
  node.dataset.counter = token;
  node.textContent = str;
  if (!complete) { node.classList.remove('number-painted'); return; }
  node.classList.add('number-painted');
  const run = document.createElement('span'); run.className = 'glyph-run'; run.setAttribute('aria-hidden', 'true');
  const lineHeight = height || font.glyphs['0'].lineHeight;
  run.style.top = `${(lineHeight - font.glyphs['0'].lineHeight) / 2}px`;
  for (const ch of str) {
    const g = font.glyphs[ch], cell = document.createElement('span'); cell.className = 'glyph-cell';
    cell.style.width = `${g.advance}px`; cell.style.height = `${lineHeight}px`;
    if (g.src) {
      const mask = document.createElement('i');
      Object.assign(mask.style, { left: `${g.left}px`, top: `${g.top}px`, width: `${g.width}px`, height: `${g.height}px`, maskImage: `url("${g.src}")`, webkitMaskImage: `url("${g.src}")` });
      cell.append(mask);
    }
    run.append(cell);
  }
  node.append(run);
}

export function prizeGeometry(prizeId, size = 170) {
  const a = UI_ART['reel-'+prizeId+'-art'];
  return {width:size,height:size,left:0,top:0,src:a.src};
}
function positionPrize(node, prizeId, x, y, size) {
  const g = prizeGeometry(prizeId, size); node.src = g.src;
  geometry(node, { x: x + g.left, y: y + g.top, width: g.width, height: g.height });
}

export function refreshUI() {
  const fixed = { 'play-button': 'button-play', 'entry-prizes': 'button-my-prizes', 'spin-button': 'button-spin', 'cabinet-play': 'button-play-again', 'activate-button': 'button-coupon-activate' };
  for (const [id, key] of Object.entries(fixed)) {
    if (id === 'cabinet-play' && $(id).textContent === 'Продолжить игру') { $(id).classList.remove('art-button'); $(id).style.backgroundImage = ''; delete $(id).dataset.paint; continue; }
    button($(id), key);
  }
  button($('win-next'), $('win-next').textContent === 'Перейти в Мои призы' ? 'button-to-prizes' : 'button-more-prizes');
}

export function paintReward(count) {
  const key = ['','text-565-2366','text-566-3341','text-565-2574'][count];
  const a = UI_ART[key]; if (a) geometry($('reward-message'), { ...a.box, x: a.box.x - a.rootBox.x, y: a.box.y - a.rootBox.y });
  paint($('reward-message'), key, 'painted-text');
  image(document.querySelector('.reward-gift'), count === 3 ? 'gift-third' : 'reward-gift');
  graphic($('reward-plus'), 'reward-plus', null, { x: 173, y: 392, width: 22.4422, height: 16.7959 });
  button($('reward-claim'), 'button-reward-claim'); button($('reward-continue'), 'button-continue');
}

export function paintResult(mode, replayAllowed = true) {
  const card = document.querySelector('.result-card'); card.dataset.state = mode;
  card.dataset.replay = replayAllowed ? 'available' : 'hidden';
  $('result-replay').hidden = !replayAllowed;
  $('rating-replay').hidden = !replayAllowed;
  const rating = mode === 'rating';
  text($('result-title'), 'text-565-1794', null, { x: 24, y: rating ? 117 : 117.427826, width: 259, height: 26 });
  const metrics = document.querySelectorAll('.result-metric');
  const firstX = rating ? 45.31 : 48.583;
  text(metrics[0].querySelector('small'), 'text-565-1799', null, { x: firstX, y: 8, width: 31, height: 8 });
  text(metrics[1].querySelector('small'), rating ? 'text-581-4112' : 'text-565-1816', null, { x: 46, y: 8, width: rating ? 61 : 66, height: 8 });
  Object.assign($('result-coins').style, { left: `${firstX}px`, top: '18px' });
  image(document.querySelector('.result-capy'), rating ? 'rating-capy' : mode === 'zero' ? 'result-capy-zero' : 'result-capy', null, {x:81,y:-100.404541,width:145,height:203});
  if (mode === 'zero') {
    // Both illustration variants use the same 145×203 slot above the card.
    geometry(document.querySelector('.result-capy'), { x: 81, y: -100.404541, width: 145, height: 203 });
  }
  document.querySelector('.result-rules').hidden = rating;
  $('result-rating-copy').hidden = !rating;
  document.querySelector('.result-actions').hidden = rating;
  $('result-rating-actions').hidden = !rating;
  if (rating) {
    text($('result-rating-copy').querySelector('h3'), 'text-581-4115', '581:4087');
    text($('result-rating-copy').querySelector('p'), 'text-581-4116', '581:4087');
    button($('rating-replay'), 'button-rating-play'); button($('rating-prizes'), 'button-rating-prizes');
  } else {
    button($('result-claim'), mode === 'zero' ? 'button-zero-claim' : 'button-result-claim');
    button($('result-replay'), 'button-result-replay');
  }
}

export function paintWin(prizeId) {
  text($('win-saved-note'), 'win-saved-note', null, {x:16,y:635,width:343,height:13});
  text(document.querySelector('.win-description>p'), 'text-565-3055', null, {x:150,y:prizeId==='points'?468:492,width:75,height:15});
  text($('won-title'), 'win-title-'+prizeId, UI_ART['win-title-'+prizeId].rootId);
  composeGift(document.querySelector('.win-native-art'), prizeId);
  revealGift(prizeId); refreshUI();
}

function addNativeLight(parent, light, cls = '') {
  const img = document.createElement('img'); img.alt = ''; img.src = light.src; img.className = cls;
  geometry(img, light); img.style.mixBlendMode = light.blend; parent.append(img); return img;
}
function composeGift(parent, prizeId) {
  parent.replaceChildren();
  const canvas={x:0,y:0,width:299.8,height:414};
  for (const [key,cls] of [['win-box-layer','win-box-layer'],['win-lid-layer','win-lid-layer'],['win-decor-layer','win-decor-layer']]) {
    const img=document.createElement('img');img.alt='';img.className=cls;image(img,key,null,canvas);parent.append(img);
  }
  const lights=WIN_LIGHTS[prizeId], front=prizeId==='hotdog'?null:lights.at(-1);
  for(const light of lights)if(light!==front)addNativeLight(parent,light,'win-prize-glow');
  const floating=document.createElement('div');floating.className='win-prize-float';
  const prize=document.createElement('img');prize.alt='';prize.className='win-prize-layer';
  image(prize,'win-'+prizeId+'-art',null,canvas);floating.append(prize);parent.append(floating);
  if(front)addNativeLight(parent,front,'win-prize-glow');
}
let giftSequence=0;
function revealGift(prizeId) {
  const sequence=++giftSequence,art=$('win-art'),layers=$('win-layers');
  art.classList.remove('gift-revealing','layers-ready');art.classList.add('gift-loading');
  void art.offsetWidth;
  const sources=['win-box-layer','win-lid-layer','win-decor-layer','win-'+prizeId+'-art'].map(key=>UI_ART[key].src).concat(WIN_LIGHTS[prizeId].map(light=>light.src));
  Promise.all(sources.map(decode)).then(loaded=>{
    if(sequence!==giftSequence)return;
    art.classList.remove('gift-loading');
    if(!loaded.every(Boolean))return;
    composeGift(layers,prizeId);
    art.style.setProperty('--prize-center-x','139.5px');
    art.classList.add('layers-ready','gift-revealing');
  });
}

export function paintEmpty(node) { const a = UI_ART['empty-ticket']; Object.assign(node.parentElement.style, {width:'343px',height:`${a.box.height}px`}); graphic(node.parentElement, 'empty-ticket'); node.classList.add('visually-hidden'); }

export function paintPrizeCard(card, prizeId) {
  const h=prizeId==='hotdog'?136:144;
  card.style.height=`${h}px`;card.style.minHeight=`${h}px`;
  const art='ticket-'+prizeId+'-art';image(card.querySelector('.prize-illustration img'),art,UI_ART[art].rootId);
  text(card.querySelector('.ticket-meta>span'),prizeId==='points'?'text-565-2622':'text-565-2592',null,{x:98,y:18.5,width:prizeId==='points'?31:22,height:11});
  graphic(card.querySelector('.valid-until'),'badge-card',null,{x:235.2,y:16,width:96.8,height:16});
  const title='ticket-title-'+prizeId;text(card.querySelector('h2'),title,UI_ART[title].rootId);
  const top=prizeId==='hotdog'?91:92,code=card.querySelector('.ticket-code');geometry(code,{x:98,y:top,width:233,height:36});
  const codeLabel=card.querySelector('.code-copy>span');
  text(codeLabel,{coffee:'text-565-2602',points:'text-566-3408',hotdog:'text-565-2633'}[prizeId],null,{x:8,y:9,width:{coffee:54,points:55,hotdog:49}[prizeId],height:16});
  graphic(card.querySelector('.copy-icon'),'copy-icon',null,{x:107.5,y:7.5,width:19,height:19});
  button(card.querySelector('.ticket-activate'),'button-activate-small');
  Object.assign(card.querySelector('.ticket-activate').style,{position:'absolute',left:'138px',top:'2px'});
}

export function initUI() {
  for (const layer of Object.values(REEL_ART).flat()) decode(layer.src);
  // Pre-decode small UI graphics so entering a popup never reveals an empty label.
  for (const a of Object.values(UI_ART)) if (a.kind === 'text' || a.kind === 'button' || (a.kind === 'art' && a.bytes < 30000)) decode(a.src);
  for (const [selector, key] of [['.entry-logo','entry-logo'],['.entry-heading','entry-heading'],['.entry-bag','entry-bag'],['.entry-left-detail','entry-left-detail'],['.entry-snow-left','entry-snow-left'],['.entry-snow-right','entry-snow-right'],['.entry-corner','entry-corner']]) image(document.querySelector(selector), key);
  text(document.querySelector('.entry-terms'), 'text-565-822', '565:800');
  const snow = addImage($('entry-screen'), 'entry-button-snow'); snow.className='entry-button-snow';
  const lights = document.querySelector('.entry-lights'); lights.replaceChildren();
  for (let i = 0; i < 7; i++) { const img = addImage(lights, `entry-glow-${i}`); img.style.mixBlendMode = 'soft-light'; }
  const shade = addImage($('entry-screen'), 'entry-shade'); shade.className = 'entry-shade'; shade.style.mixBlendMode = 'multiply'; $('entry-screen').insertBefore(shade, document.querySelector('.entry-snow-left'));
  for (const img of document.querySelectorAll('.world-piece')) {
    const key = img.getAttribute('src').split('/').pop().replace(/\.(png|webp)$/, ''); image(img, key);
  }
  image(document.querySelector('.foreground-snow'), 'snow-left');
  const light = document.createElement('div'); light.className = 'world-light'; $('world').insertBefore(light, document.querySelector('.world-piece[src*="sign"]'));

  const caption = UI_ART['prizes-caption'];
  image(document.querySelector('.prizes-caption-art'), 'prizes-caption', null, {x:7+caption.ink.x-caption.box.x,y:9.830078+caption.ink.y-caption.box.y,width:caption.pixelWidth/2,height:caption.pixelHeight/2});
  text(document.querySelector('.teaching-message'), 'text-565-1184', '565:1017');
  image(document.querySelector('.gesture'), 'gesture', '565:1017');

  const help = document.querySelector('.help-card');
  text(help.querySelector('h2'), 'text-565-1367', '565:1365');
  const ps = help.querySelectorAll(':scope>p');
  ['text-565-1370','text-565-1383','text-565-1387','text-565-1391'].forEach((key, i) => text(ps[i], key, '565:1365'));
  const rules = help.querySelectorAll('.item-rules p');
  text(rules[0], 'text-565-1377', '565:1365'); text(rules[1], 'text-565-1381', '565:1365');
  addImage(help, 'help-coffee', '565:1365', 'help-item-art'); addImage(help, 'help-red', '565:1365', 'help-item-art');
  button($('help-close'), 'button-understood', '565:1365');

  const legend = document.querySelector('.result-rules'); legend.textContent = '10 монет = 1 приз. 20 монет = 2 приза. 30 монет = 3 приза.';
  graphic(legend, 'result-rules', '565:1792');
  const metrics = document.querySelectorAll('.result-metric');
  for (const [i, key] of ['result-shade-gray','result-shade-pink'].entries()) { const a = UI_ART[key]; const img = document.createElement('img'); img.className = 'result-native-shade'; img.alt = ''; img.src = a.src; geometry(img, { x: i ? 79.5 : 80, y: 20, width: a.pixelWidth / 2, height: a.pixelHeight / 2 }); metrics[i].prepend(img); }
  $('roulette-snow').replaceChildren();
  $('roulette-screen').style.backgroundImage = `url(${UI_ART['roulette-bg'].src})`;
  for (const key of sharedWinParts) decode(UI_ART[key].src);
  const giftArt=document.createElement('div');giftArt.className='win-native-art';geometry(giftArt,{x:0,y:0,width:299.8,height:414});$('win-art').append(giftArt);
  for(const a of Object.values(PROMO_ART))decode(a.src);
  text(document.querySelector('.cabinet-screen h1'), 'text-565-2702', '565:2696');
  graphic($('owned-count'), 'hud-count-bg');
  text(document.querySelector('.spin-actions>p'), 'text-565-3018', null, {x:24,y:64,width:316,height:13});
  initCoupon(); refreshUI();
}

function initCoupon() {
  text(document.querySelector('.coupon-header h1'), 'text-566-3482', '566:3467');
  const hero = document.querySelector('.coupon-hero');
  const illustration=document.querySelector('.coupon-hero>img:not(.coupon-glow-art)');
  for(const [index,light] of COUPON_LIGHTS.entries()) {
    const glow=addNativeLight(hero,light,'coupon-glow-art');
    if(index<COUPON_LIGHTS.length-1)hero.insertBefore(glow,illustration);
  }
  image(illustration,'coupon-points-art','631:6312');
  text(document.querySelector('.coupon-hero h2'),'coupon-title','631:6312');
  text(document.querySelector('.coupon-hero>p'),'text-566-3500',null,{x:123.5,y:169,width:96,height:19});
  const ticket = document.querySelector('.coupon-ticket');
  const codeLabel = $('coupon-copy').querySelector('span');
  text(codeLabel,'coupon-code',null,{x:10,y:12.5,width:183,height:16});
  graphic($('coupon-copy').querySelector('.copy-icon'), 'copy-icon', null, { x: 282.5, y: 10.5, width: 19, height: 19 });
  text(ticket.querySelector('.coupon-code>p'), 'text-566-3512', '566:3502');
  graphic(ticket.querySelector('.valid-until'), 'badge-coupon', '566:3502');
  text(ticket.querySelector('h3'),'coupon-summary-title','631:6321');
  const sections = document.querySelectorAll('.coupon-card');
  text(sections[0].querySelector('h3'), 'text-566-3523', '566:3521');
  const lis = sections[0].querySelectorAll('li');
  ['566:3530','566:3535','566:3540','566:3545'].forEach((id, i) => { text(lis[i], 'text-'+id.replace(':','-'), '566:3521'); addImage(sections[0], 'coupon-step-'+(i+1), '566:3521', 'coupon-step-art'); });
  text(sections[1].querySelector('h3'), 'text-566-3548', '566:3546');
  const ul = sections[1].querySelectorAll('li');
  ['566:3554','566:3559','566:3564','566:3569'].forEach((id, i) => { text(ul[i], 'text-'+id.replace(':','-'), '566:3546'); const bullet = document.createElement('span'); bullet.textContent = '•'; sections[1].append(bullet); text(bullet,'text-'+['566-3552','566-3557','566-3562','566-3567'][i], '566:3546'); });
  text(sections[1].querySelector(':scope>p'), 'text-566-3572', '566:3546');
  text(sections[1].querySelector('.coupon-legal'), 'text-566-3574', '566:3546');
}
