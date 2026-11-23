import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { installScoreAtmosphere, INK_STYLE } from '../public/site-fx.js';

function fixture(reduced = false) {
  const dom = new JSDOM('<div id="root"><main data-home-landing><section aria-labelledby="home-title"><h1>让旋律，落在纸上。</h1></section><button class="song-row">曲目</button></main><svg><g id="a" class="is-sounding"></g><g id="b"></g><g class="is-sounding" style="visibility:hidden"></g></svg></div>', { pretendToBeVisual:true });
  const { window:win } = dom;
  win.matchMedia = () => ({ matches:reduced, addEventListener() {}, removeEventListener() {} });
  const calls = [];
  win.Element.prototype.animate = function(frames) {
    calls.push({ target:this, frames });
    return { cancel() {} };
  };
  for (const note of win.document.querySelectorAll('g')) note.getBoundingClientRect = () => ({ left:note.id === 'b' ? 120 : 40, top:80, width:18, height:24 });
  const stop = installScoreAtmosphere(win.document, win);
  const tick = () => new Promise(resolve => win.setTimeout(resolve, 40));
  return { win, calls, stop, tick };
}

test('reduced motion never schedules displaced animations or playback accents', async () => {
  const f = fixture(true);
  await f.tick();
  assert.equal(f.calls.length, 0);
  assert.equal(f.win.document.querySelectorAll('.px-halo').length, 0);

  f.stop();
  f.win.close();
});

test('playback accents follow renderer identity and clear at stop', async () => {
  const f = fixture();
  await f.tick();
  assert.equal(f.win.document.querySelectorAll('.px-halo').length, 1);
  const first = f.win.document.querySelector('.px-halo');
  assert.equal(first.style.left, '2px');
  f.win.document.getElementById('a').classList.remove('is-sounding');
  f.win.document.getElementById('b').classList.add('is-sounding');
  await f.tick();
  assert.equal(first.isConnected, false);
  assert.equal(f.win.document.querySelector('.px-halo').style.left, '82px');
  assert.equal(f.win.document.querySelectorAll('.px-halo').length, 1);
  f.win.document.getElementById('b').classList.remove('is-sounding');
  await f.tick();
  assert.equal(f.win.document.querySelectorAll('.px-halo').length, 0);
  f.stop();
  assert.equal(f.win.document.querySelectorAll('.px-ink,.px-halo').length, 0);
  f.win.close();
});

test('opening is painted inline while heavy effects stay outside entry dependency map', () => {
  const source = readFileSync(new URL('../src/components/home-landing.tsx', import.meta.url), 'utf8');
  assert.match(source, /@vite-ignore/);
  assert.match(source, /setTimeout\(loadAtmosphere, 4000\)/);
  assert.doesNotMatch(source, /<canvas|installInkField|px-ink-field/);
  assert.match(source, /className="px-overture"/);
  assert.match(source, /Array.from\("让旋律，落在纸上。"\)/);
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /animation:none/);
  assert.doesNotMatch(source, /import\(["'][^"']*site-fx/);
});


test('hidden pages remove accents and stop scheduling effects until visible', async () => {
  const f = fixture();
  await f.tick();
  const doc = f.win.document;
  assert.equal(doc.querySelectorAll('.px-halo').length, 1);
  Object.defineProperty(doc, 'hidden', { value:true, configurable:true });
  doc.dispatchEvent(new f.win.Event('visibilitychange'));
  const count = f.calls.length;
  doc.getElementById('b').classList.add('is-sounding');
  await f.tick();
  assert.equal(doc.querySelectorAll('.px-halo').length, 0);
  assert.equal(f.calls.length, count);
  Object.defineProperty(doc, 'hidden', { value:false, configurable:true });
  doc.dispatchEvent(new f.win.Event('visibilitychange'));
  await f.tick();
  assert.equal(doc.querySelectorAll('.px-halo').length, 2);
  f.stop();
  f.win.close();
});

test('irregular bar and tied-note identities use the renderer rather than beat arithmetic', async () => {
  const f = fixture();
  const a = f.win.document.getElementById('a');
  const b = f.win.document.getElementById('b');
  a.dataset.id = 'bar-7-tuplet-2';
  b.dataset.id = 'bar-8-tied-continuation';
  await f.tick();
  const first = f.win.document.querySelector('.px-halo');
  a.dataset.tie = 'hold';
  await f.tick();
  assert.equal(f.win.document.querySelector('.px-halo'), first);
  a.classList.remove('is-sounding'); b.classList.add('is-sounding');
  await f.tick();
  assert.equal(first.isConnected, false);
  assert.equal(f.win.document.querySelector('.px-halo').style.left, '82px');
  assert.ok(f.win.document.querySelector('.px-ripple'));
  f.stop(); f.win.close();
});

test('keyboard accents follow active and played keys, and have a bounded lifetime', async () => {
  const f = fixture();
  f.win.document.getElementById('a').classList.remove('is-sounding');
  const key = f.win.document.getElementById('b');
  key.parentElement.setAttribute('data-visual-keyboard','');
  key.setAttribute('data-active','true');
  await f.tick();
  assert.equal(f.win.document.querySelector('.px-halo').style.left, '82px');
  key.setAttribute('data-active','false');
  await f.tick();
  assert.equal(f.win.document.querySelector('.px-halo'), null);
  key.setAttribute('data-played','true');
  await f.tick();
  assert.equal(f.win.document.querySelectorAll('.px-halo').length, 1);
  f.stop();
  assert.equal(f.win.document.querySelectorAll('.px-ripple').length, 0);
  f.win.close();
});

test('dense ink retains paper contrast with a wider, stronger pointer response', () => {
  assert.ok(INK_STYLE.homeAlpha >= .28 && INK_STYLE.homeAlpha <= .4);
  assert.ok(INK_STYLE.homeAlpha > .14 * 2);
  assert.ok(INK_STYLE.edgeAlpha > .08);
  assert.ok(INK_STYLE.centerAlpha < INK_STYLE.edgeAlpha / 3);
  assert.ok(INK_STYLE.minRadius >= 1.2);
  assert.ok(INK_STYLE.pointerRadius >= 200 && INK_STYLE.pointerRadius > 135 * 1.4);
  assert.ok(INK_STYLE.pointerForce >= 3.2 && INK_STYLE.pointerForce > 1.9 * 1.6);
});

test('ink field gates creation, repels locally, follows sounding identity and suspends when hidden', async () => {
  const { installInkField, writeFxMode } = await import('../public/site-fx.js');
  for (const settings of [{ reduced:true }, { fine:false }, { width:899 }, {}]) {
    const dom = new JSDOM('<div id="root"><svg><g class="is-sounding"></g></svg></div>', { pretendToBeVisual:true, url:'https://818189.xyz/' });
    const w = dom.window, d = w.document;
    w.innerWidth = settings.width || 1280;
    w.matchMedia = query => ({ matches:query.includes('reduced') ? !!settings.reduced : settings.fine !== false, addEventListener() {}, removeEventListener() {} });
    w.HTMLCanvasElement.prototype.getContext = () => ({ setTransform() {}, clearRect() {}, beginPath() {}, ellipse() {}, fill() {} });
    let next = 0; const pending = new Map();
    w.requestAnimationFrame = cb => { pending.set(++next, cb); return next; };
    w.cancelAnimationFrame = id => pending.delete(id);
    const step = n => { for (let i=0;i<n;i++) { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(cb => cb(next * 16.667)); } };
    const note = d.querySelector('g');
    note.getBoundingClientRect = () => ({ left:500, top:300, bottom:324, width:18, height:24 });
    writeFxMode(w.localStorage, 'ink');
    const ink = installInkField(d,w);
    if (Object.keys(settings).length) {
      assert.equal(d.querySelector('canvas'), null); assert.equal(pending.size, 0);
    } else {
      step(2);
      assert.equal(d.querySelectorAll('canvas').length, 1);
      assert.equal(d.querySelector('canvas').style.pointerEvents, 'none');
      assert.equal(ink.state.particles.length, 120);
      step(180); assert.ok(ink.state.blend > .99);
      const p = ink.state.particles[0];
      assert.ok(Math.abs(p.x - 509) < 20 && Math.abs(p.y - 278) < 20);
      const nextNote = note.cloneNode();
      nextNote.getBoundingClientRect = () => ({ left:700, top:400, bottom:424, width:18, height:24 });
      note.parentElement.append(nextNote);
      note.classList.remove('is-sounding'); await Promise.resolve(); step(80);
      assert.equal(ink.state.target, nextNote);
      assert.ok(Math.abs(p.x - 709) < 20 && Math.abs(p.y - 378) < 20);
      nextNote.classList.remove('is-sounding'); await Promise.resolve(); step(240);
      assert.ok(ink.state.blend < .001); assert.equal(ink.state.target, null);
      const q = ink.state.particles[90];
      q.x = q.u * w.innerWidth; q.y = q.v * w.innerHeight; q.vx = q.vy = 0;
      const x = q.x, y = q.y;
      w.dispatchEvent(new w.MouseEvent('pointermove', { clientX:x - 10, clientY:y }));
      step(15); assert.ok(q.x > x + 65, 'nearby ink moves away from pointer');
      const box = d.createElement('textarea');
      d.body.append(box);
      let layout = 0;
      const measured = note.getBoundingClientRect;
      note.getBoundingClientRect = () => { layout += 1; return measured.call(note); };
      box.focus();
      d.dispatchEvent(new w.Event('focusin', { bubbles:true }));
      await Promise.resolve();
      const frozen = ink.state.time;
      const before = layout;
      note.setAttribute('class', 'is-sounding');
      await Promise.resolve();
      assert.equal(layout, before, 'typing must not layout-scan the score');
      step(20);
      assert.equal(pending.size, 0);
      assert.equal(ink.state.time, frozen);
      box.blur();
      d.dispatchEvent(new w.Event('focusout', { bubbles:true }));
      await Promise.resolve();
      assert.equal(pending.size, 1);
      box.remove();
      Object.defineProperty(d,'hidden',{ value:true, configurable:true });
      d.dispatchEvent(new w.Event('visibilitychange'));
      const time = ink.state.time; step(10);
      assert.equal(pending.size,0); assert.equal(ink.state.time,time);
      Object.defineProperty(d,'hidden',{ value:false, configurable:true });
      d.dispatchEvent(new w.Event('visibilitychange')); assert.equal(pending.size,1);
      w.innerWidth = 800; w.dispatchEvent(new w.Event('resize'));
      assert.equal(d.querySelector('canvas'),null); assert.equal(pending.size,0);
    }
    ink.destroy(); w.close();
  }
});

test('fx mode storage defaults to stars and keeps a saved preference', async () => {
  const { readFxMode, writeFxMode, FX_STORAGE_KEY, FX_MODES, FX_DEFAULT_MODE } = await import('../public/site-fx.js');
  assert.deepEqual([...FX_MODES], ['ink', 'stars', 'notes', 'off']);
  assert.equal(FX_DEFAULT_MODE, 'stars');
  const store = new Map();
  const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
  };
  assert.equal(readFxMode(storage), 'stars', 'empty storage must default to stars');
  assert.equal(store.has(FX_STORAGE_KEY), false, 'the default must not write a preference of its own');
  writeFxMode(storage, 'ink');
  assert.equal(store.get(FX_STORAGE_KEY), 'ink');
  assert.equal(readFxMode(storage), 'ink', 'a saved ink choice must be kept');
  writeFxMode(storage, 'stars');
  assert.equal(readFxMode(storage), 'stars');
  writeFxMode(storage, 'mixed');
  assert.equal(readFxMode(storage), 'stars', 'an invalid write must leave the previous saved value');
  storage.setItem(FX_STORAGE_KEY, 'nope');
  assert.equal(readFxMode(storage), 'stars', 'an unknown stored value falls back to stars');
  for (const mode of FX_MODES) {
    writeFxMode(storage, mode);
    assert.equal(readFxMode(storage), mode);
  }
  const throwing = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  assert.equal(readFxMode(throwing), 'stars');
  writeFxMode(storage, 'notes');
  writeFxMode(throwing, 'off');
  assert.equal(readFxMode(storage), 'notes', 'a blocked write must not clobber a saved preference');
  writeFxMode(storage, 'off');
  assert.equal(readFxMode(storage), 'off');
});

test('empty storage opens the landing on stars, but a saved ink choice is kept', async () => {
  const { installScoreAtmosphere, installInkField, writeFxMode, STAR_COUNTS, FX_STORAGE_KEY } = await import('../public/site-fx.js');
  const fresh = inkHarness();
  assert.equal(fresh.w.localStorage.getItem(FX_STORAGE_KEY), null);
  const stopFresh = installScoreAtmosphere(fresh.d, fresh.w);
  await Promise.resolve();
  fresh.step(2);
  const freshGroup = fresh.d.querySelector('[role="radiogroup"][aria-label="页面效果"]');
  assert.equal(freshGroup.querySelector('[data-fx="stars"]').getAttribute('aria-checked'), 'true');
  assert.equal(freshGroup.querySelector('[data-fx="ink"]').getAttribute('aria-checked'), 'false');
  assert.equal(fresh.w.localStorage.getItem(FX_STORAGE_KEY), null, 'opening on the default must not invent a saved preference');
  stopFresh();
  fresh.w.close();

  const fieldH = inkHarness();
  const field = installInkField(fieldH.d, fieldH.w);
  fieldH.step(2);
  assert.equal(field.state.particles.length, STAR_COUNTS.full);
  assert.ok(field.state.particles.every((p) => p.kind === 'star'));
  field.destroy();
  fieldH.w.close();

  const saved = inkHarness();
  writeFxMode(saved.w.localStorage, 'ink');
  const stopSaved = installScoreAtmosphere(saved.d, saved.w);
  await Promise.resolve();
  saved.step(2);
  const savedGroup = saved.d.querySelector('[role="radiogroup"][aria-label="页面效果"]');
  assert.equal(savedGroup.querySelector('[data-fx="ink"]').getAttribute('aria-checked'), 'true');
  assert.equal(saved.w.localStorage.getItem(FX_STORAGE_KEY), 'ink');
  stopSaved();
  saved.w.close();
});

function inkHarness(settings = {}) {
  const dom = new JSDOM('<div id="root"><main data-home-landing><svg><g class="is-sounding"></g></svg></main></div>', { pretendToBeVisual:true, url:'https://818189.xyz/' });
  const w = dom.window, d = w.document;
  w.innerWidth = settings.width || 1280;
  w.matchMedia = query => ({ matches:query.includes('reduced') ? !!settings.reduced : settings.fine !== false, addEventListener() {}, removeEventListener() {} });
  w.innerHeight = settings.height ?? w.innerHeight;
  w.devicePixelRatio = settings.dpr ?? 1;
  const paths = [];
  const fills = [];
  const draws = [];
  const transforms = [];
  let now = 0;
  w.HTMLCanvasElement.prototype.getContext = () => ({
    setTransform(...args) { transforms.push(args); },
    clearRect() { draws.push(now); },
    beginPath() {},
    ellipse() { paths.push('ellipse'); },
    fill(rule) { paths.push(rule === 'evenodd' ? 'evenodd' : 'fill'); },
    moveTo() {}, lineTo() {}, closePath() {}, save() {}, restore() {}, translate() {}, rotate() {},
    arc() { paths.push('arc'); },
    roundRect() { paths.push('roundRect'); },
    bezierCurveTo() { paths.push('bezier'); },
    quadraticCurveTo() { paths.push('quadratic'); },
    stroke() { paths.push('stroke'); },
    set fillStyle(value) { fills.push(value); this._fill = value; },
    get fillStyle() { return this._fill; },
    set strokeStyle(value) { fills.push(value); this._stroke = value; },
    get strokeStyle() { return this._stroke; },
    set globalAlpha(value) { this._alpha = value; },
    get globalAlpha() { return this._alpha; },
    set lineWidth(value) { this._lineWidth = value; },
    get lineWidth() { return this._lineWidth; },
    set lineCap(value) { this._lineCap = value; },
    get lineCap() { return this._lineCap; },
    set lineJoin(value) { this._lineJoin = value; },
    get lineJoin() { return this._lineJoin; },
  });
  let next = 0; const pending = new Map();
  w.requestAnimationFrame = cb => { pending.set(++next, cb); return next; };
  w.cancelAnimationFrame = id => pending.delete(id);
  const step = (count, hz = 60) => {
    for (let i = 0; i < count; i++) {
      now += 1000 / hz;
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach(cb => cb(now));
    }
  };
  return { w, d, paths, fills, draws, transforms, pending, step };
}

test('field waits a paint opportunity and cancels pending startup while hidden', async (t) => {
  const { installInkField } = await import('../public/site-fx.js');
  const h = inkHarness();
  const field = installInkField(h.d, h.w);
  t.after(() => { field.destroy(); h.w.close(); });
  assert.equal(h.d.querySelector('canvas'), null);
  h.step(1);
  assert.equal(h.d.querySelector('canvas'), null);
  Object.defineProperty(h.d, 'hidden', { value: true, configurable: true });
  h.d.dispatchEvent(new h.w.Event('visibilitychange'));
  assert.equal(h.pending.size, 0);
  h.step(3);
  assert.equal(h.d.querySelector('canvas'), null);
  Object.defineProperty(h.d, 'hidden', { value: false, configurable: true });
  h.d.dispatchEvent(new h.w.Event('visibilitychange'));
  h.step(1);
  assert.equal(h.d.querySelector('canvas'), null);
  h.step(1);
  assert.ok(h.d.querySelector('canvas'));
  assert.equal(h.draws.length, 0);
  h.step(1);
  assert.equal(h.draws.length, 1);
});

test('field caps backing pixels at 1080p while retaining viewport coordinates', async (t) => {
  const { installInkField } = await import('../public/site-fx.js');
  const h = inkHarness({ width: 1920, height: 1080, dpr: 2 });
  const field = installInkField(h.d, h.w);
  t.after(() => { field.destroy(); h.w.close(); });
  h.step(2);
  const canvas = h.d.querySelector('canvas');
  assert.equal(canvas.width, 1920);
  assert.equal(canvas.height, 1080);
  assert.equal(canvas.style.width, '100%');
  assert.equal(canvas.style.height, '100%');
  assert.deepEqual(h.transforms.at(-1), [1, 0, 0, 1, 0, 0]);

  h.w.innerWidth = 3440;
  h.w.innerHeight = 1440;
  h.w.dispatchEvent(new h.w.Event('resize'));
  assert.ok(canvas.width * canvas.height <= 1920 * 1080);
  assert.ok(Math.abs(canvas.width / canvas.height - 3440 / 1440) < 0.01);
  assert.deepEqual(h.transforms.at(-1), [canvas.width / 3440, 0, 0, canvas.height / 1440, 0, 0]);

  h.w.innerWidth = 1000;
  h.w.innerHeight = 500;
  h.w.dispatchEvent(new h.w.Event('resize'));
  assert.deepEqual([canvas.width, canvas.height], [2000, 1000]);
});

test('field limits full redraws at 144 Hz and draws every 60 Hz frame', async (t) => {
  const { installInkField } = await import('../public/site-fx.js');
  for (const [hz, expected] of [[144, 48], [60, 60]]) {
    const h = inkHarness();
    const field = installInkField(h.d, h.w);
    t.after(() => { field.destroy(); h.w.close(); });
    h.step(2, hz);
    h.step(hz, hz);
    assert.equal(h.draws.length, expected);
    assert.ok(h.draws.slice(1).every((now, i) => now - h.draws[i] >= 1000 / 60 - 0.1));
  }
});

test('context loss disables the field without retrying on resize or refresh', async (t) => {
  const { installInkField, writeFxMode } = await import('../public/site-fx.js');
  const h = inkHarness();
  const field = installInkField(h.d, h.w);
  t.after(() => { field.destroy(); h.w.close(); });
  h.step(3);
  const lost = new h.w.Event('contextlost', { cancelable: true });
  h.d.querySelector('canvas').dispatchEvent(lost);
  assert.equal(lost.defaultPrevented, true);
  assert.equal(h.d.querySelector('canvas'), null);
  assert.equal(h.pending.size, 0);
  writeFxMode(h.w.localStorage, 'notes');
  field.refresh();
  h.w.dispatchEvent(new h.w.Event('resize'));
  assert.equal(h.pending.size, 0);
  h.step(4);
  assert.equal(h.draws.length, 1);
});

test('off mode and reduced motion do not create a canvas; settings remain available', async () => {
  const { installScoreAtmosphere, writeFxMode, FX_STORAGE_KEY } = await import('../public/site-fx.js');
  const reduced = inkHarness({ reduced:true });
  const stopReduce = installScoreAtmosphere(reduced.d, reduced.w);
  assert.equal(reduced.d.querySelector('canvas'), null);
  const group = reduced.d.querySelector('[role="radiogroup"][aria-label="页面效果"]');
  assert.ok(group);
  assert.equal(group.querySelectorAll('[role="radio"]').length, 4);
  const reducedCss = settingsCss(reduced.d);
  assert.match(reducedCss, /\.px-fx-settings \{[^}]*position:\s*fixed/);
  stopReduce();

  const off = inkHarness();
  writeFxMode(off.w.localStorage, 'off');
  const stopOff = installScoreAtmosphere(off.d, off.w);
  assert.equal(off.d.querySelector('canvas'), null);
  const offGroup = off.d.querySelector('[role="radiogroup"][aria-label="页面效果"]');
  assert.ok(offGroup);
  assert.equal(offGroup.querySelector('[data-fx="off"]').getAttribute('aria-checked'), 'true');
  offGroup.querySelector('[data-fx="ink"]').click();
  assert.equal(off.w.localStorage.getItem(FX_STORAGE_KEY), 'ink');
  off.step(2);
  assert.equal(off.d.querySelectorAll('canvas').length, 1);
  assert.equal(off.d.querySelector('canvas').style.pointerEvents, 'none');
  offGroup.querySelector('[data-fx="off"]').click();
  assert.equal(off.d.querySelector('canvas'), null);
  stopOff();
});

test('ink mode still uses elliptical stamps and does not add a first-screen import', async () => {
  const { installInkField, writeFxMode, INK_STYLE } = await import('../public/site-fx.js');
  assert.ok(INK_STYLE.homeAlpha >= .28 && INK_STYLE.homeAlpha <= .4);
  const h = inkHarness();
  writeFxMode(h.w.localStorage, 'ink');
  const ink = installInkField(h.d, h.w);
  h.step(2);
  assert.equal(h.d.querySelectorAll('canvas').length, 1);
  assert.equal(ink.state.particles.length, 120);
  h.step(2);
  assert.ok(h.paths.includes('ellipse'));
  ink.destroy();
  const source = readFileSync(new URL('../src/components/home-landing.tsx', import.meta.url), 'utf8');
  assert.match(source, /@vite-ignore/);
  assert.match(source, /setTimeout\(loadAtmosphere, 4000\)/);
  assert.doesNotMatch(source, /import\(["'][^"']*site-fx/);
  assert.doesNotMatch(source, /puxian-site-fx-v1/);
});

test('fx settings are hidden off the home landing so they cannot block editor chrome', async () => {
  const { installScoreAtmosphere } = await import('../public/site-fx.js');
  const h = inkHarness();
  const stop = installScoreAtmosphere(h.d, h.w);
  const group = h.d.querySelector('[role="radiogroup"][aria-label="页面效果"]');
  assert.equal(group.hidden, false);
  h.d.querySelector('[data-home-landing]').remove();
  // MutationObserver + rAF in atmosphere
  await Promise.resolve();
  h.step(2);
  await new Promise((resolve) => h.w.setTimeout(resolve, 40));
  assert.equal(group.hidden, true);
  assert.equal(group.isConnected, true, 'settings node must survive leaving home so it can return');

  const home = h.d.createElement('main');
  home.setAttribute('data-home-landing', '');
  home.innerHTML = '<button class="song-row">示例曲目</button><footer><p aria-label="功能介绍">页脚说明</p></footer>';
  h.d.getElementById('root').append(home);
  await Promise.resolve();
  h.step(2);
  await new Promise((resolve) => h.w.setTimeout(resolve, 40));
  assert.equal(group.hidden, false);
  assert.equal(group.querySelectorAll('[role="radio"]').length, 4);
  stop();
});

function settingsCss(doc) {
  return [...doc.querySelectorAll('style')].map((style) => style.textContent).join('\n');
}

async function flushAtmosphere(h) {
  await Promise.resolve();
  h.step(2);
  await new Promise((resolve) => h.w.setTimeout(resolve, 40));
}

test('ink field is torn down off the home landing so it cannot cover the editor', async () => {
  const { installScoreAtmosphere } = await import('../public/site-fx.js');
  const h = inkHarness();
  const stop = installScoreAtmosphere(h.d, h.w);
  h.step(2);
  const canvas = h.d.querySelector('canvas');
  assert.ok(canvas, 'the field may run on the home landing');
  assert.equal(canvas.style.pointerEvents, 'none');
  assert.equal(canvas.parentElement, h.d.body, 'the field is a full-viewport body layer');

  h.d.querySelector('[data-home-landing]').remove();
  await flushAtmosphere(h);
  assert.equal(h.d.querySelector('canvas'), null, 'canvas must not stay stacked over the editor');

  h.w.dispatchEvent(new h.w.MouseEvent('pointermove', { clientX: 80, clientY: 120 }));
  h.w.dispatchEvent(new h.w.Event('scroll', { bubbles: true }));
  await flushAtmosphere(h);
  assert.equal(h.d.querySelector('canvas'), null, 'pointer or scroll in the editor must not recreate the field');

  const home = h.d.createElement('main');
  home.setAttribute('data-home-landing', '');
  home.innerHTML = '<button class="song-row">示例曲目</button>';
  h.d.getElementById('root').append(home);
  await flushAtmosphere(h);
  h.step(1);
  assert.equal(h.d.querySelectorAll('canvas').length, 1, 'returning home may restore the field');
  stop();
});

test('opening atmosphere after the editor is already shown never creates a covering canvas', async () => {
  const { installScoreAtmosphere } = await import('../public/site-fx.js');
  const h = inkHarness();
  h.d.querySelector('[data-home-landing]').remove();
  const stop = installScoreAtmosphere(h.d, h.w);
  await flushAtmosphere(h);
  assert.equal(h.d.querySelector('canvas'), null);
  h.w.dispatchEvent(new h.w.MouseEvent('pointermove', { clientX: 40, clientY: 40 }));
  await flushAtmosphere(h);
  assert.equal(h.d.querySelector('canvas'), null);
  stop();
});

test('fx settings pin to the top-right with 44px targets and stay on-screen', async () => {
  const { installScoreAtmosphere } = await import('../public/site-fx.js');
  for (const width of [355, 390, 1280]) {
    const h = inkHarness({ width });
    const landing = h.d.querySelector('[data-home-landing]');
    landing.innerHTML = '<header><p>谱线</p><a href="#songs">选一首曲子</a></header><section id="songs"><button class="song-row">打开小星星</button></section><footer><p aria-label="功能介绍">仅存于当前浏览器</p></footer>';
    const stop = installScoreAtmosphere(h.d, h.w);
    await flushAtmosphere(h);
    const group = h.d.querySelector('[role="radiogroup"][aria-label="页面效果"]');
    assert.ok(group);
    assert.equal(group.hidden, false);
    assert.equal(group.querySelectorAll('[role="radio"]').length, 4);
    const css = settingsCss(h.d);
    assert.match(css, /\.px-fx-settings \[role="radio"\][^}]*min-height:\s*44px/);
    assert.match(css, /\.px-fx-settings \[role="radio"\][^}]*min-width:\s*44px/);
    assert.match(css, /\.px-fx-settings \{[^}]*position:\s*fixed/);
    assert.match(css, /\.px-fx-settings \{[^}]*top:\s*max\(8px,\s*env\(safe-area-inset-top/);
    assert.match(css, /\.px-fx-settings \{[^}]*right:\s*max\(20px,\s*calc\(20px \+ env\(safe-area-inset-right/);
    assert.match(css, /\.px-fx-settings \{[^}]*max-width:\s*calc\(100vw/);
    assert.match(css, /\[data-home-landing\] > header \{[^}]*--px-fx-reserve/);
    assert.match(css, /@media \(max-width:\s*639px\) \{ \.px-fx-settings::before \{ display:\s*none/);
    assert.doesNotMatch(css, /\.px-fx-settings \{[^}]*overflow:\s*auto/);
    assert.equal(group.parentElement, h.d.body, `width ${width}: stay outside the React landing tree`);
    stop();
    h.w.close();
  }
});

test('placeFxSettings reserves the header when there is room, otherwise drops just below it', async () => {
  const { placeFxSettings } = await import('../public/site-fx.js');
  const h = inkHarness({ width: 1280 });
  const landing = h.d.querySelector('[data-home-landing]');
  landing.innerHTML = '<header><p>谱线</p><a href="#songs">选一首曲子</a></header>';
  const box = h.d.createElement('div');
  box.className = 'px-fx-settings';
  h.d.body.append(box);
  const header = landing.querySelector('header');
  const kids = [...header.children];
  kids[0].getBoundingClientRect = () => ({ width: 80, height: 44, top: 0, bottom: 56, left: 16, right: 96 });
  kids[1].getBoundingClientRect = () => ({ width: 96, height: 44, top: 0, bottom: 56, left: 110, right: 206 });
  header.getBoundingClientRect = () => ({ width: 1280, height: 56, top: 0, bottom: 56, left: 0, right: 1280 });
  box.getBoundingClientRect = () => ({ width: 280, height: 54, top: 8, bottom: 62, left: 992, right: 1272 });
  const wide = placeFxSettings(box, h.d, h.w);
  assert.equal(wide.placement, 'header-right');
  assert.equal(wide.reserve, 288);
  assert.equal(h.d.documentElement.style.getPropertyValue('--px-fx-reserve'), '288px');
  assert.equal(box.style.top, '');

  h.w.innerWidth = 390;
  box.getBoundingClientRect = () => ({ width: 200, height: 54, top: 8, bottom: 62, left: 182, right: 382 });
  const narrow = placeFxSettings(box, h.d, h.w);
  assert.equal(narrow.placement, 'below-header');
  assert.equal(narrow.reserve, 0);
  assert.equal(h.d.documentElement.style.getPropertyValue('--px-fx-reserve'), '');
  assert.equal(box.style.top, '64px');

  box.hidden = true;
  const hidden = placeFxSettings(box, h.d, h.w);
  assert.equal(hidden.placement, 'hidden');
  assert.equal(box.style.top, '');
  h.w.close();
});

test('notes mode is denser and uses multiple colors; ink count stays 120', async () => {
  const { installInkField, writeFxMode, FX_COUNTS, NOTE_PALETTE } = await import('../public/site-fx.js');
  assert.equal(FX_COUNTS.ink, 120);
  assert.ok(FX_COUNTS.notes >= 220);
  assert.ok(NOTE_PALETTE.length >= 4);

  const inkH = inkHarness();
  writeFxMode(inkH.w.localStorage, 'ink');
  const ink = installInkField(inkH.d, inkH.w);
  inkH.step(2);
  assert.equal(ink.state.particles.length, FX_COUNTS.ink);
  ink.destroy();
  inkH.w.close();

  const h = inkHarness();
  writeFxMode(h.w.localStorage, 'notes');
  const field = installInkField(h.d, h.w);
  h.step(2);
  assert.equal(field.state.particles.length, FX_COUNTS.notes);
  h.step(3);
  const colorFills = h.fills.filter((value) => /^rgba\(\d+,\d+,\d+/.test(value) && !value.startsWith('rgba(41,43,37'));
  const unique = new Set(colorFills.map((value) => value.replace(/,1\)$/, '')));
  assert.ok(unique.size >= 4, `expected several note colors, got ${[...unique].join(' | ')}`);
  for (const [r, g, b] of NOTE_PALETTE) {
    assert.ok(h.fills.some((value) => value.includes(`${r},${g},${b}`)), `missing palette color ${r},${g},${b}`);
  }
  field.destroy();
  h.w.close();
});

test('stars field uses colored capsules, not five-point sparkles', async () => {
  const {
    installInkField, writeFxMode, FX_COUNTS, STAR_COUNTS, STAR_PALETTE, starCount,
    createStarField, stepStarField, paintStarField, mulberry32, morphStarColor,
  } = await import('../public/site-fx.js');
  const source = readFileSync(new URL('../public/site-fx.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Math\.PI \* 2 \/ 5/);
  assert.doesNotMatch(source, /for \(let i = 0; i < 5; i\+\+\)/);
  assert.equal(FX_COUNTS.stars, STAR_COUNTS.full);
  assert.equal(starCount(), 230);
  assert.equal(starCount(true), 110);
  assert.ok(starCount(true) < starCount(false));

  const colors = [];
  for (let t = 0; t < 6; t += 0.4) {
    for (let u = 0; u <= 1; u += 0.25) {
      colors.push(morphStarColor(u, 1 - u, t));
    }
  }
  const near = (rgb, target) => Math.hypot(rgb[0] - target[0], rgb[1] - target[1], rgb[2] - target[2]) < 28;
  for (const target of STAR_PALETTE) {
    assert.ok(colors.some((rgb) => near(rgb, target)), `color morph never approached ${target}`);
  }

  const h = inkHarness();
  writeFxMode(h.w.localStorage, 'stars');
  const field = installInkField(h.d, h.w);
  h.step(2);
  assert.equal(field.state.particles.length, FX_COUNTS.stars);
  h.step(3);
  assert.ok(h.paths.includes('roundRect') || h.paths.filter((value) => value === 'arc').length >= 2, 'stars draw rounded capsules');
  assert.ok(!h.fills.some((value) => value.startsWith('rgba(245,228,170,') || value.startsWith('rgba(236,214,148,')), 'must not fall back to the gold five-point sparkle fills');
  const starFills = h.fills.filter((value) => /^rgba\(\d+,\d+,\d+/.test(value));
  assert.ok(starFills.length > 20, `expected a dense capsule field, got ${starFills.length} fills`);
  field.destroy();
  h.w.close();

  const wander = createStarField(1280, 800, { rand: mulberry32(18), seconds: 0 });
  const start = { x: wander.ringX, y: wander.ringY };
  for (let i = 0; i < 90; i++) stepStarField(wander, 1 / 30);
  assert.ok(Math.hypot(wander.ringX - start.x, wander.ringY - start.y) > 0.02, 'ripple center must auto-wander without a pointer');

  const pointed = createStarField(1280, 800, { rand: mulberry32(18), seconds: 0 });
  for (let i = 0; i < 90; i++) stepStarField(pointed, 1 / 30, { pointerX: 1100, pointerY: 160 });
  assert.ok(pointed.ringX > wander.ringX + 0.08, 'ripple should ease toward a pointer on the right');
  assert.ok(pointed.ringY < wander.ringY - 0.04, 'ripple should ease toward a pointer near the top');

  const reduced = createStarField(1280, 800, { reduced: true, rand: mulberry32(5) });
  assert.equal(reduced.particles.length, 110);
  stepStarField(reduced, 1 / 30);
  const calm = reduced.particles.reduce((sum, p) => sum + p.scale, 0) / reduced.particles.length;
  const lively = createStarField(1280, 800, { rand: mulberry32(5) });
  stepStarField(lively, 1 / 30);
  const vivid = lively.particles.reduce((sum, p) => sum + p.scale, 0) / lively.particles.length;
  assert.ok(calm <= vivid, 'reduced-motion capsules should pulse more calmly');
  const rec = inkHarness();
  paintStarField({
    roundRect() { rec.paths.push('roundRect'); },
    beginPath() {}, closePath() {}, fill() {}, save() {}, restore() {}, translate() {}, rotate() {},
    set fillStyle(value) { rec.fills.push(value); },
    set globalAlpha(_value) {},
  }, lively);
  assert.ok(rec.paths.includes('roundRect'));
});

test('notes path draws oval heads, stems, curved flags and beams', async () => {
  const {
    installInkField, writeFxMode, FX_COUNTS, NOTE_PALETTE, NOTE_DURATIONS,
    drawNoteGlyph, drawBeamedGroup, seedNoteParticles, mulberry32,
  } = await import('../public/site-fx.js');
  const source = readFileSync(new URL('../public/site-fx.js', import.meta.url), 'utf8');
  assert.match(source, /bezierCurveTo/);
  assert.doesNotMatch(source, /lineTo\(scale \* 1\.15, -scale \* 1\.1\)/);

  const h = inkHarness();
  writeFxMode(h.w.localStorage, 'notes');
  const field = installInkField(h.d, h.w);
  h.step(2);
  assert.equal(field.state.particles.length, FX_COUNTS.notes);
  const durations = new Set(field.state.particles.map((p) => p.duration));
  for (const duration of NOTE_DURATIONS) assert.ok(durations.has(duration), `missing ${duration} notes`);
  assert.ok(field.state.particles.some((p) => p.groupSize >= 2 && p.groupSize <= 4), 'expected short beamed groups');
  h.step(3);
  assert.ok(h.paths.includes('ellipse'), 'noteheads are ovals');
  assert.ok(h.paths.includes('stroke'), 'stems are stroked');
  assert.ok(h.paths.includes('bezier'), 'flags are curved, not triangles');
  assert.ok(h.paths.includes('evenodd'), 'half notes use hollow heads');
  field.destroy();
  h.w.close();

  const rec = { paths: [], fills: [] };
  const ctx = {
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() { rec.paths.push('lineTo'); },
    ellipse() { rec.paths.push('ellipse'); },
    bezierCurveTo() { rec.paths.push('bezier'); },
    stroke() { rec.paths.push('stroke'); },
    fill(rule) { rec.paths.push(rule === 'evenodd' ? 'evenodd' : 'fill'); },
    save() {}, restore() {}, translate() {}, rotate() {},
    set fillStyle(value) { rec.fills.push(value); },
    set strokeStyle(value) { rec.fills.push(value); },
    set globalAlpha(_value) {},
    set lineWidth(_value) {},
    set lineCap(_value) {},
    set lineJoin(_value) {},
  };
  drawNoteGlyph(ctx, { x: 40, y: 40, size: 14, duration: 'quarter', stemUp: true, color: NOTE_PALETTE[0] });
  assert.ok(rec.paths.includes('ellipse') && rec.paths.includes('stroke'));
  assert.ok(!rec.paths.includes('bezier'), 'quarters have no flag');
  rec.paths.length = 0;
  drawNoteGlyph(ctx, { x: 80, y: 40, size: 14, duration: 'eighth', stemUp: true, color: NOTE_PALETTE[1] });
  assert.ok(rec.paths.includes('bezier'));
  rec.paths.length = 0;
  drawNoteGlyph(ctx, { x: 120, y: 40, size: 14, duration: 'sixteenth', stemUp: false, color: NOTE_PALETTE[2] });
  assert.ok(rec.paths.filter((value) => value === 'bezier').length >= 4, 'sixteenth notes have two curved flags');
  rec.paths.length = 0;
  drawNoteGlyph(ctx, { x: 160, y: 40, size: 14, duration: 'half', stemUp: true, color: NOTE_PALETTE[3] });
  assert.ok(rec.paths.includes('evenodd'));
  rec.paths.length = 0;
  drawBeamedGroup(ctx, {
    notes: [
      { x: 40, y: 80, size: 12, duration: 'eighth', stemUp: true, color: NOTE_PALETTE[0] },
      { x: 64, y: 74, size: 12, duration: 'eighth', stemUp: true, color: NOTE_PALETTE[0] },
      { x: 88, y: 86, size: 12, duration: 'eighth', stemUp: true, color: NOTE_PALETTE[0] },
    ],
    kind: 'eighth',
    size: 12,
    color: NOTE_PALETTE[0],
  });
  assert.ok(rec.paths.filter((value) => value === 'ellipse').length >= 3);
  assert.ok(rec.paths.filter((value) => value === 'stroke').length >= 3);
  assert.ok(!rec.paths.includes('bezier'), 'beamed groups use beams instead of flags');
  assert.ok(rec.paths.filter((value) => value === 'lineTo').length >= 3, 'beams are solid polygons');

  const seeded = seedNoteParticles(240, mulberry32(9));
  assert.equal(seeded.length, 240);
  assert.ok(seeded.filter((p) => p.groupSize > 1).length >= 20);
});

test('fx still lazy-loads and is not referenced from the first-screen HTML template', async () => {
  const landing = readFileSync(new URL('../src/components/home-landing.tsx', import.meta.url), 'utf8');
  assert.match(landing, /setTimeout\(loadAtmosphere, 4000\)/);
  assert.doesNotMatch(landing, /import\(["'][^"']*site-fx/);
  const htmlFiles = ['index.html', 'src/index.html', 'src/entry.html'];
  for (const relative of htmlFiles) {
    try {
      const html = readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
      assert.doesNotMatch(html, /site-fx/);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
});

test('stars are smaller and paler, and occasionally twinkle without a pointer', async () => {
  const {
    STAR_STYLE, starPaintAlpha, starSelfTwinkle, createStarField, stepStarField, mulberry32,
  } = await import('../public/site-fx.js');
  assert.ok(STAR_STYLE.minLength + STAR_STYLE.lengthRange <= 13, 'capsules must stay shorter than the first bright field');
  assert.ok(STAR_STYLE.minThickness + STAR_STYLE.thicknessRange <= 4.2, 'capsules must stay thinner than the first bright field');
  assert.ok(STAR_STYLE.restAlpha < 0.28 && STAR_STYLE.maxAlpha <= 0.7);

  const rest = starPaintAlpha(STAR_STYLE.restAlpha, 0);
  const flash = starPaintAlpha(STAR_STYLE.restAlpha, 1);
  assert.ok(rest < 0.28, `resting alpha should stay pale, got ${rest}`);
  assert.ok(flash > rest + 0.08 && flash <= STAR_STYLE.maxAlpha, 'a twinkle should briefly lift brightness, not strobe the whole cap');

  const lit = [];
  const dark = [];
  for (let seed = 0; seed < 1; seed += 0.02) {
    for (let t = 0; t < 16; t += 0.05) {
      const w = starSelfTwinkle(seed, t);
      if (w > 0.75) lit.push({ seed, t, w });
      if (w === 0) dark.push(t);
    }
  }
  assert.ok(lit.length > 20, 'self-twinkle must fire over time with no pointer');
  assert.ok(dark.length > lit.length, 'most of the time a sparkle stays quiet');

  const field = createStarField(1280, 800, { rand: mulberry32(18), seconds: 0 });
  assert.ok(field.particles.every((p) => p.length <= 13 && p.thickness <= 4.2));
  const seen = [];
  let peakTwinkling = 0;
  for (let i = 0; i < 240; i++) {
    stepStarField(field, 1 / 30);
    const flashing = field.particles.filter((p) => (p.twinkle || 0) > 0.5);
    peakTwinkling = Math.max(peakTwinkling, flashing.length);
    if (flashing.length) seen.push(flashing.length);
  }
  assert.ok(seen.length > 0, 'the live field must self-twinkle while the ripple wanders on its own');
  assert.ok(peakTwinkling < field.particles.length * 0.2, `twinkle must stay sparse, peaked at ${peakTwinkling} of ${field.particles.length}`);
  const restMean = field.particles.reduce((sum, p) => sum + p.alpha, 0) / field.particles.length;
  assert.ok(restMean < 0.45, `resting field should stay paler than the first bright pass, mean ${restMean}`);

  const reduced = createStarField(1280, 800, { reduced: true, rand: mulberry32(18) });
  stepStarField(reduced, 1 / 30);
  assert.ok(reduced.particles.every((p) => (p.twinkle || 0) === 0), 'reduced motion should not self-flash');
});

test('notes stay in a border band and keep a clear center', async () => {
  const {
    NOTE_STYLE, NOTE_PALETTE, seedNoteParticles, seedNoteSite, isNoteCenter, projectToNoteBand,
    installInkField, writeFxMode, mulberry32,
  } = await import('../public/site-fx.js');
  assert.ok(NOTE_STYLE.band >= 0.18 && NOTE_STYLE.band <= 0.26);
  assert.ok(NOTE_STYLE.fieldAlpha <= 0.58 && NOTE_STYLE.maxAlpha <= 0.65);
  assert.ok(NOTE_STYLE.blur >= 0.6);
  assert.ok(NOTE_PALETTE.every(([r, g, b]) => r + g + b > 300), 'palette should be lifted, not heavy primaries');

  const rand = mulberry32(21);
  for (let i = 0; i < 80; i++) {
    const site = seedNoteSite(rand);
    assert.equal(isNoteCenter(site.u, site.v), false, `seed ${i} landed in the center (${site.u},${site.v})`);
  }
  const pushed = projectToNoteBand(0.5, 0.5);
  assert.equal(isNoteCenter(pushed.u, pushed.v), false);

  const seeded = seedNoteParticles(240, mulberry32(21));
  assert.ok(seeded.every((p) => !isNoteCenter(p.u, p.v)), 'every spawned note must start in the border band');

  const h = inkHarness();
  writeFxMode(h.w.localStorage, 'notes');
  const field = installInkField(h.d, h.w);
  h.step(8);
  const width = h.w.innerWidth;
  const height = h.w.innerHeight;
  const inner = 0.32;
  const inCenter = field.state.particles.filter((p) => {
    const u = p.x / width;
    const v = p.y / height;
    return u >= inner && u <= 1 - inner && v >= inner && v <= 1 - inner;
  });
  assert.equal(inCenter.length, 0, `${inCenter.length} notes sat in the middle of the landing`);

  h.w.dispatchEvent(new h.w.MouseEvent('pointermove', { clientX: width / 2, clientY: height / 2 }));
  h.step(12);
  const afterPointer = field.state.particles.filter((p) => {
    const u = p.x / width;
    const v = p.y / height;
    return u >= inner && u <= 1 - inner && v >= inner && v <= 1 - inner;
  });
  assert.equal(afterPointer.length, 0, 'a pointer in the middle must not drag notes across the landing');
  assert.ok(field.state.particles.every((p) => p.alpha <= NOTE_STYLE.maxAlpha + 1e-6));
  field.destroy();
  h.w.close();
});



function mockScroller(el, view, total) {
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => view });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => total });
  el.scrollTop = 0;
  return el;
}

function mountLockedWorkspace(doc, { stageView = 800, stageTotal = 2400, panelView = 800, panelTotal = 3200, primary = false } = {}) {
  doc.querySelector('[data-home-landing]')?.remove();
  const shell = doc.createElement('main');
  shell.className = 'app-shell';
  const stage = doc.createElement('div');
  stage.className = 'score-stage';
  mockScroller(stage, stageView, stageTotal);
  const panel = doc.createElement('div');
  panel.className = 'zone-panel';
  mockScroller(panel, panelView, panelTotal);
  shell.append(stage, panel);
  (doc.getElementById('root') || doc.body).append(shell);
  return { shell, stage, panel };
}

test('home landing shows a visible right-edge page scrollbar and the editor hooks the same bar to the score', async () => {
  const { installScoreAtmosphere } = await import('../public/site-fx.js');
  const h = inkHarness();
  Object.defineProperty(h.w, 'innerHeight', { configurable: true, value: 800 });
  Object.defineProperty(h.d.documentElement, 'clientHeight', { configurable: true, get: () => 800 });
  Object.defineProperty(h.d.documentElement, 'scrollHeight', { configurable: true, get: () => 2135 });
  const stop = installScoreAtmosphere(h.d, h.w);
  await flushAtmosphere(h);
  const bar = h.d.querySelector('.px-page-scrollbar');
  assert.ok(bar, 'page scrollbar must exist on the home landing');
  bar.getBoundingClientRect = () => ({ width: 12, height: 800, top: 0, bottom: 800, left: 1268, right: 1280 });
  h.w.dispatchEvent(new h.w.Event('resize'));
  h.step(1);
  assert.equal(bar.hidden, false, 'overflowing home page must show the right-edge bar');
  assert.equal(bar.getAttribute('role'), 'scrollbar');
  assert.equal(bar.getAttribute('aria-label'), '页面滚动');
  assert.ok(bar.querySelector('.px-page-scrollbar-thumb'));
  const css = settingsCss(h.d);
  assert.match(css, /\.px-page-scrollbar \{[^}]*position:\s*fixed/);
  assert.match(css, /\.px-page-scrollbar \{[^}]*right:\s*0/);
  assert.match(css, /\.px-page-scrollbar \{[^}]*width:\s*12px/);
  assert.match(css, /\.px-fx-settings \{[^}]*right:\s*max\(20px/);
  assert.match(css, /html:has\(\[data-home-landing\]\)\s*\{[^}]*scrollbar-gutter:\s*stable/);
  assert.match(css, /html:has\(\[data-home-landing\]\)\s*\{[^}]*scrollbar-width:\s*none/);
  assert.doesNotMatch(css, /html[^{]*::-webkit-scrollbar/, "the home document must not gain a webkit scrollbar when effects load");
  assert.match(css, /\.app-shell:not\(\[data-home-landing\]\) \.score-stage[^}]*scrollbar-width:\s*none/);
  assert.doesNotMatch(css, /px-page-scrollbar:not\(\[hidden\]\)[^{]*\{[^}]*scrollbar-gutter:\s*auto/, 'showing the custom bar must not drop the reserved gutter');

  h.d.querySelector('[data-home-landing]').remove();
  Object.defineProperty(h.d.documentElement, 'scrollHeight', { configurable: true, get: () => 800 });
  await flushAtmosphere(h);
  h.w.dispatchEvent(new h.w.Event('resize'));
  h.step(1);
  assert.equal(bar.hidden, true, 'a locked workspace without a primary scroller must hide the bar');
  assert.equal(h.d.querySelector('canvas'), null, 'editor must not keep the FX canvas');
  assert.equal(h.d.querySelector('[role="radiogroup"][aria-label="页面效果"]').hidden, true, 'FX settings stay hidden in the editor');

  const { stage, panel } = mountLockedWorkspace(h.d);
  await flushAtmosphere(h);
  h.w.dispatchEvent(new h.w.Event('resize'));
  h.step(1);
  assert.equal(bar.hidden, false, 'an overflowing score-stage must show the same window-edge bar');
  assert.ok(stage.classList.contains('px-page-scroll-target'));
  assert.equal(panel.classList.contains('px-page-scroll-target'), false, 'the tool panel is not the primary scroller');

  mockScroller(stage, 800, 800);
  await flushAtmosphere(h);
  h.w.dispatchEvent(new h.w.Event('resize'));
  h.step(1);
  assert.equal(bar.hidden, true, 'a short score that does not overflow must hide the bar');

  mockScroller(stage, 800, 2400);
  Object.defineProperty(h.d.documentElement, 'scrollHeight', { configurable: true, get: () => 2135 });
  const home = h.d.createElement('main');
  home.setAttribute('data-home-landing', '');
  stage.closest('.app-shell').remove();
  h.d.getElementById('root').append(home);
  await flushAtmosphere(h);
  h.w.dispatchEvent(new h.w.Event('resize'));
  h.step(1);
  assert.equal(bar.hidden, false, 'returning home restores the document page scrollbar');

  stop();
  assert.equal(h.d.querySelector('.px-page-scrollbar'), null, 'teardown removes the page scrollbar');
  h.w.close();
});

test('page scrollbar thumb tracks document scroll and can be dragged', async () => {
  const { installPageScrollbar } = await import('../public/site-fx.js');
  const h = inkHarness();
  Object.defineProperty(h.w, 'innerHeight', { configurable: true, value: 800 });
  Object.defineProperty(h.d.documentElement, 'clientHeight', { configurable: true, get: () => 800 });
  Object.defineProperty(h.d.documentElement, 'scrollHeight', { configurable: true, get: () => 2000 });
  h.d.documentElement.scrollTop = 0;
  const scroll = installPageScrollbar(h.d, h.w);
  const bar = scroll.element;
  const thumb = bar.querySelector('.px-page-scrollbar-thumb');
  bar.getBoundingClientRect = () => ({ width: 12, height: 800, top: 0, bottom: 800, left: 1268, right: 1280 });
  thumb.getBoundingClientRect = () => ({ width: 12, height: 44, top: 0, bottom: 44, left: 1268, right: 1280 });
  const first = scroll.refresh();
  assert.equal(first.visible, true);
  assert.equal(first.y, 0);
  h.d.documentElement.scrollTop = 600;
  const mid = scroll.refresh();
  assert.ok(mid.y > first.y, 'thumb must travel down as the page scrolls');

  const EventCtor = h.w.PointerEvent || h.w.MouseEvent;
  bar.dispatchEvent(new EventCtor('pointerdown', { bubbles: true, clientY: 22, clientX: 1274, pointerId: 1, button: 0 }));
  h.w.dispatchEvent(new EventCtor('pointermove', { bubbles: true, clientY: 400, clientX: 1274, pointerId: 1, buttons: 1 }));
  h.w.dispatchEvent(new EventCtor('pointerup', { bubbles: true, clientY: 400, clientX: 1274, pointerId: 1 }));
  assert.ok(h.d.documentElement.scrollTop > 0, 'dragging the bar must scroll the document');
  scroll.destroy();
  h.w.close();
});


test('editor page scrollbar tracks the score-stage and can be dragged, not the tool panel', async () => {
  const { installPageScrollbar } = await import('../public/site-fx.js');
  const h = inkHarness();
  Object.defineProperty(h.w, 'innerHeight', { configurable: true, value: 800 });
  Object.defineProperty(h.d.documentElement, 'clientHeight', { configurable: true, get: () => 800 });
  Object.defineProperty(h.d.documentElement, 'scrollHeight', { configurable: true, get: () => 800 });
  const { stage, panel } = mountLockedWorkspace(h.d);
  const scroll = installPageScrollbar(h.d, h.w);
  const bar = scroll.element;
  const thumb = bar.querySelector('.px-page-scrollbar-thumb');
  bar.getBoundingClientRect = () => ({ width: 12, height: 800, top: 0, bottom: 800, left: 1268, right: 1280 });
  thumb.getBoundingClientRect = () => ({ width: 12, height: 44, top: 0, bottom: 44, left: 1268, right: 1280 });
  const first = scroll.refresh();
  assert.equal(first.visible, true);
  assert.equal(first.kind, 'element');
  assert.equal(first.y, 0);
  assert.ok(stage.classList.contains('px-page-scroll-target'));
  stage.scrollTop = 600;
  panel.scrollTop = 900;
  const mid = scroll.refresh();
  assert.ok(mid.y > first.y, 'thumb must travel down as the score scrolls');
  const yAfterPanel = mid.y;
  panel.scrollTop = 0;
  const still = scroll.refresh();
  assert.equal(still.y, yAfterPanel, 'scrolling the tool panel must not move the page bar');

  const EventCtor = h.w.PointerEvent || h.w.MouseEvent;
  bar.dispatchEvent(new EventCtor('pointerdown', { bubbles: true, clientY: 22, clientX: 1274, pointerId: 1, button: 0 }));
  h.w.dispatchEvent(new EventCtor('pointermove', { bubbles: true, clientY: 400, clientX: 1274, pointerId: 1, buttons: 1 }));
  h.w.dispatchEvent(new EventCtor('pointerup', { bubbles: true, clientY: 400, clientX: 1274, pointerId: 1 }));
  assert.ok(stage.scrollTop > 0, 'dragging the bar must scroll the score-stage');
  assert.equal(panel.scrollTop, 0, 'dragging the bar must not scroll the tool panel');
  scroll.destroy();
  assert.equal(stage.classList.contains('px-page-scroll-target'), false);
  h.w.close();
});

test('a non-home feature page can hook the same bar to its primary scroller', async () => {
  const { installPageScrollbar, primaryScrollMetrics } = await import('../public/site-fx.js');
  const h = inkHarness();
  Object.defineProperty(h.w, 'innerHeight', { configurable: true, value: 800 });
  Object.defineProperty(h.d.documentElement, 'clientHeight', { configurable: true, get: () => 800 });
  Object.defineProperty(h.d.documentElement, 'scrollHeight', { configurable: true, get: () => 800 });
  h.d.querySelector('[data-home-landing]').remove();
  const shell = h.d.createElement('main');
  shell.className = 'app-shell';
  const main = h.d.createElement('div');
  main.setAttribute('data-primary-scroll', '');
  mockScroller(main, 800, 2200);
  const side = h.d.createElement('div');
  side.className = 'zone-panel';
  mockScroller(side, 800, 4000);
  shell.append(main, side);
  h.d.getElementById('root').append(shell);
  const picked = primaryScrollMetrics(h.d, h.w);
  assert.equal(picked.el, main);
  assert.equal(picked.kind, 'element');
  const scroll = installPageScrollbar(h.d, h.w);
  const bar = scroll.element;
  const thumb = bar.querySelector('.px-page-scrollbar-thumb');
  bar.getBoundingClientRect = () => ({ width: 12, height: 800, top: 0, bottom: 800, left: 1268, right: 1280 });
  thumb.getBoundingClientRect = () => ({ width: 12, height: 44, top: 0, bottom: 44, left: 1268, right: 1280 });
  assert.equal(scroll.refresh().visible, true);
  assert.ok(main.classList.contains('px-page-scroll-target'));
  const EventCtor = h.w.PointerEvent || h.w.MouseEvent;
  bar.dispatchEvent(new EventCtor('pointerdown', { bubbles: true, clientY: 22, clientX: 1274, pointerId: 1, button: 0 }));
  h.w.dispatchEvent(new EventCtor('pointermove', { bubbles: true, clientY: 400, clientX: 1274, pointerId: 1, buttons: 1 }));
  h.w.dispatchEvent(new EventCtor('pointerup', { bubbles: true, clientY: 400, clientX: 1274, pointerId: 1 }));
  assert.ok(main.scrollTop > 0, 'dragging must scroll the marked primary scroller');
  assert.equal(side.scrollTop, 0);
  scroll.destroy();
  h.w.close();
});

test('page scrollbar must settle instead of looping when showing it would change overflow', async () => {
  const { installPageScrollbar } = await import('../public/site-fx.js');
  const h = inkHarness();
  const html = h.d.documentElement;
  Object.defineProperty(h.w, 'innerHeight', { configurable: true, value: 800 });
  Object.defineProperty(html, 'clientHeight', { configurable: true, get: () => 800 });
  // Model the #140 macOS Chrome hang: showing the custom bar used to flip
  // scrollbar-gutter from stable to auto, widening the page, unwrapping text,
  // and collapsing overflow — which hid the bar, reserved the gutter, and repeated.
  Object.defineProperty(html, 'scrollHeight', {
    configurable: true,
    get: () => {
      const bar = h.d.querySelector('.px-page-scrollbar');
      return bar && !bar.hidden ? 800 : 960;
    },
  });

  const observed = [];
  const roCallbacks = [];
  h.w.ResizeObserver = class {
    constructor(cb) { this.cb = cb; roCallbacks.push(cb); }
    observe(target) { observed.push(target); }
    disconnect() {}
    unobserve() {}
  };

  let feedback = 0;
  const deliverLayout = () => {
    feedback++;
    assert.ok(feedback <= 24, `page scrollbar layout feedback looped (${feedback} deliveries)`);
    for (const cb of roCallbacks) cb([], { disconnect() {} });
  };
  const mo = new h.w.MutationObserver(deliverLayout);
  mo.observe(h.d.body, { subtree: true, attributes: true, attributeFilter: ['hidden', 'style', 'aria-valuenow'] });

  const scroll = installPageScrollbar(h.d, h.w);
  const bar = scroll.element;
  bar.getBoundingClientRect = () => ({ width: 12, height: 800, top: 0, bottom: 800, left: 1268, right: 1280 });
  await Promise.resolve();
  h.step(8);
  await Promise.resolve();

  assert.equal(
    observed.includes(html) || observed.includes(h.d.documentElement),
    false,
    'must not ResizeObserver.documentElement; hiding the native bar changes its size',
  );
  assert.equal(bar.hidden, false, 'the first overflow measurement must still show the right-edge bar');

  // After the dangerous layout coupling is gone, overflow is stable. User
  // scroll/resize must coalesce to a single frame and then go idle.
  Object.defineProperty(html, 'scrollHeight', { configurable: true, get: () => 2135 });
  scroll.refresh();
  await Promise.resolve();
  h.step(2);
  assert.equal(bar.hidden, false);

  const rafBefore = h.pending.size;
  for (let i = 0; i < 20; i++) {
    h.w.dispatchEvent(new h.w.Event('scroll'));
    h.w.dispatchEvent(new h.w.Event('resize'));
  }
  assert.ok(h.pending.size <= rafBefore + 1, 'scroll/resize must be coalesced to one animation frame');
  h.step(4);
  await Promise.resolve();
  h.step(2);
  assert.equal(h.pending.size, 0, 'opening the landing must go idle; the scrollbar must not recurse');
  assert.ok(feedback <= 8, `visibility/layout notifications must stay bounded (got ${feedback})`);
  mo.disconnect();
  scroll.destroy();
  h.w.close();
});
