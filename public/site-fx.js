/** Optional presentation layer. The score renderer owns all sounding identities. */
export function installScoreAtmosphere(doc = document, win = window) {
  const media = win.matchMedia('(prefers-reduced-motion: reduce)');
  const root = doc.getElementById('root') || doc.body;
  if (!root) return () => {};
  const style = doc.createElement('style');
  style.textContent = `
    .px-halo { position:fixed; pointer-events:none; z-index:30; background:radial-gradient(ellipse at center,rgba(49,89,75,.16) 0%,rgba(178,153,90,.09) 32%,rgba(49,89,75,.035) 52%,transparent 72%); mask-image:radial-gradient(ellipse,black 20%,transparent 72%); }
    .px-ripple { position:fixed; pointer-events:none; z-index:31; border:1px solid rgba(49,89,75,.32); border-radius:50%; background:radial-gradient(ellipse,rgba(239,222,175,.24),transparent 70%); }
    .is-sounding { filter:drop-shadow(0 0 5px #87a995); }
    @media (prefers-reduced-motion:reduce) { .is-sounding { filter:none; } }
    @media print { .px-halo,.px-ripple,.px-ink-field,.px-fx-settings,.px-page-scrollbar { display:none } }
    .px-fx-settings { position:fixed; top:max(8px, env(safe-area-inset-top, 0px)); right:max(20px, calc(20px + env(safe-area-inset-right, 0px))); left:auto; z-index:40; display:flex; flex-wrap:wrap; align-items:center; justify-content:flex-end; gap:4px; width:fit-content; max-width:calc(100vw - 16px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)); margin:0; padding:5px 6px; border-radius:999px; background:rgba(247,243,234,.92); border:1px solid #e7e0d3; box-shadow:0 4px 16px #1c191614; pointer-events:auto; font:12px/1.2 system-ui,sans-serif; color:#292b25; }
    .px-fx-settings::before { content:attr(data-legend); margin:0 6px 0 4px; color:#575047; }
    @media (max-width:639px) { .px-fx-settings::before { display:none; } }
    .px-fx-settings [role="radio"] { min-height:44px; min-width:44px; padding:0 8px; border:0; border-radius:999px; background:transparent; color:inherit; cursor:pointer; }
    .px-fx-settings [role="radio"][aria-checked="true"] { background:#1f3d3a; color:#f7f3ea; }
    .px-fx-settings[hidden] { display:none !important; }
    [data-home-landing] > header { padding-right: var(--px-fx-reserve, 0px); }
    html:has([data-home-landing]) { overflow-y: auto; scrollbar-gutter: stable; scrollbar-width: none; scrollbar-color: #8f8678 #efe8dc; }
    [data-primary-scroll],
    .app-shell:not([data-home-landing]) .score-stage,
    .px-page-scroll-target { scrollbar-width: none; }
    [data-primary-scroll]::-webkit-scrollbar,
    .app-shell:not([data-home-landing]) .score-stage::-webkit-scrollbar,
    .px-page-scroll-target::-webkit-scrollbar { width: 0; display: none; }
    .px-page-scrollbar { position:fixed; top:0; right:0; bottom:0; z-index:35; width:12px; box-sizing:border-box; background:#efe8dc; border-left:1px solid #e7e0d3; pointer-events:auto; }
    .px-page-scrollbar[hidden] { display:none !important; }
    .px-page-scrollbar-thumb { width:100%; box-sizing:border-box; background:#8f8678; border-radius:8px; border:2px solid #efe8dc; min-height:44px; cursor:grab; }
    .px-page-scrollbar-thumb:hover { background:#5f584e; }
  `;
  doc.head.append(style);
  const ink = installInkField(doc, win, { homeOnly: true });
  const pageScroll = installPageScrollbar(doc, win);
  const settings = installFxSettings(doc, win, () => ink.refresh());
  settings.hidden = !root.querySelector('[data-home-landing]');
  placeFxSettings(settings, doc, win);
  pageScroll.refresh();
  const animations = new Set();
  const cleanups = [];
  const ripples = new Set();
  const halos = new Map();
  const homes = new WeakSet();
  const cards = new WeakSet();
  let frame = 0;
  let stopped = false;
  function animate(el, frames, options) {
    if (!el.animate || doc.hidden || media.matches) return;
    const animation = el.animate(frames, options);
    animations.add(animation);
    animation.onfinish = animation.oncancel = () => animations.delete(animation);
    return animation;
  }
  const reveal = win.IntersectionObserver ? new win.IntersectionObserver(entries => {
    let order = 0;
    for (const entry of entries) if (entry.isIntersecting) {
      reveal.unobserve(entry.target);
      if (!media.matches) animate(entry.target, [{ opacity:.35, transform:'translateY(10px)' }, { opacity:1, transform:'translateY(0)' }], { duration:620, delay:Math.min(order++ * 65, 260), easing:'cubic-bezier(.2,.7,.2,1)' });
    }
  }, { threshold:.12 }) : null;
  function homeEntrance(home) {
    homes.add(home);
    const hero = home.querySelector('.px-overture');
    function depth(event) {
      if (media.matches || doc.hidden || !hero?.isConnected) return;
      const y = event.type === 'scroll' ? Math.min(12,win.scrollY*.025) : (event.clientY/win.innerHeight-.5)*6;
      const x = event.type === 'scroll' ? 0 : (event.clientX/win.innerWidth-.5)*8;
      hero.style.transform = `translate3d(${x}px,${y}px,0)`;
    }
    win.addEventListener('pointermove',depth,{passive:true});
    win.addEventListener('scroll',depth,{passive:true});
    cleanups.push(() => { win.removeEventListener('pointermove',depth); win.removeEventListener('scroll',depth); if(hero) hero.style.transform=''; });
  }
  function clearHalos() {
    for (const halo of halos.values()) halo.remove();
    halos.clear();
  }
  function sync() {
    frame = 0;
    if (stopped || doc.hidden) return;
    settings.hidden = !root.querySelector('[data-home-landing]');
    placeFxSettings(settings, doc, win);
    ink.refresh();
    pageScroll.refresh();
    for (const home of root.querySelectorAll('[data-home-landing]')) {
      if (!homes.has(home)) homeEntrance(home);
      for (const card of home.querySelectorAll('.song-row')) if (!cards.has(card)) {
        cards.add(card);
        reveal?.observe(card);
      }
    }
    const active = new Set([...root.querySelectorAll('.is-sounding, [data-visual-keyboard] [data-active="true"], [data-visual-keyboard] [data-played="true"]')].filter(note =>
      win.getComputedStyle(note).visibility !== 'hidden' && !note.closest('[hidden], [aria-hidden="true"]')));
    for (const [note, halo] of halos) if (!active.has(note) || !note.isConnected) {
      halo.remove();
      halos.delete(note);
    }
    if (media.matches) return;
    for (const note of active) {
      if (halos.has(note) || halos.size >= 12 || note.parentElement?.closest('.is-sounding')) continue;
      const rect = note.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > win.innerHeight) continue;
      const halo = doc.createElement('div');
      halo.className = 'px-halo';
      halo.setAttribute('aria-hidden', 'true');
      halo.style.cssText = `left:${rect.left-38}px;top:${rect.top-16}px;width:${rect.width+76}px;height:${rect.height+32}px`;
      const ripple = doc.createElement('div');
      ripple.className = 'px-ripple';
      ripple.setAttribute('aria-hidden','true');
      ripple.style.cssText = `left:${rect.left-16}px;top:${rect.top-12}px;width:${rect.width+32}px;height:${rect.height+24}px`;
      if (ripples.size < 12) {
        doc.body.append(ripple); ripples.add(ripple);
        const pulse = animate(ripple,[{opacity:.7,transform:'scale(.35)'},{opacity:0,transform:'scale(1.8)'}],{duration:850,easing:'ease-out'});
        if(pulse) pulse.onfinish = pulse.oncancel = () => { animations.delete(pulse); ripple.remove(); ripples.delete(ripple); };
      }
      animate(note,[{transform:'translateY(0)'},{transform:'translateY(-2px)',offset:.35},{transform:'translateY(0)'}],{duration:340,easing:'ease-out',composite:'add'});
      doc.body.append(halo);
      halos.set(note, halo);
      animate(halo, [{ opacity:0, transform:'translateX(-14px)' }, { opacity:1, transform:'translateX(0)', offset:.3 }, { opacity:.4, transform:'translateX(12px)' }], { duration:650, easing:'ease-out', fill:'forwards' });
    }
  }
  function schedule() { if (!stopped && !frame && !doc.hidden) frame = win.requestAnimationFrame(sync); }
  const observer = new win.MutationObserver(schedule);
  observer.observe(root, { subtree:true, childList:true, attributes:true, attributeFilter:['class','data-active','data-played'] });
  function reset() {
    for (const animation of animations) animation.cancel();
    animations.clear();
    clearHalos();
    for(const ripple of ripples) ripple.remove();
    ripples.clear();
    root.querySelectorAll(".px-overture").forEach(el => { el.style.transform=""; });
    if (frame) win.cancelAnimationFrame(frame);
    frame = 0;
    schedule();
  }
  media.addEventListener('change', reset);
  doc.addEventListener('visibilitychange', reset);
  // Fixed-position accents are discarded as soon as the score moves.
  win.addEventListener('scroll', reset, true);
  win.addEventListener('resize', reset);
  schedule();
  return () => {
    stopped = true;
    ink.destroy();
    pageScroll.destroy();
    settings.remove();
    reset();
    observer.disconnect();
    reveal?.disconnect();
    media.removeEventListener('change', reset);
    doc.removeEventListener('visibilitychange', reset);
    win.removeEventListener('scroll', reset, true);
    win.removeEventListener('resize', reset);
    root.querySelectorAll('.px-ink').forEach(el => el.remove());
    cleanups.forEach(cleanup => cleanup());
    style.remove();
  };
}



export const FX_STORAGE_KEY = "puxian-site-fx-v1";
export const FX_MODES = Object.freeze(["ink", "stars", "notes", "off"]);
export const FX_DEFAULT_MODE = "stars";
export const FX_COUNTS = Object.freeze({ ink: 120, stars: 230, notes: 240, off: 0 });
export const STAR_COUNTS = Object.freeze({ full: 230, reduced: 110 });
/** Light-theme capsular field: blue, red, gold. Original look/motion reimplementation, not a third-party source copy. */
export const STAR_PALETTE = Object.freeze([
  [44, 100, 237],
  [248, 66, 66],
  [255, 207, 3],
]);
/** Paler, still colorful note tints so the landing stays readable. */
export const NOTE_PALETTE = Object.freeze([
  [97, 152, 142],
  [213, 141, 102],
  [105, 133, 205],
  [207, 106, 117],
  [166, 116, 192],
  [105, 164, 123],
]);
export const NOTE_STYLE = Object.freeze({
  band: 0.2,
  fieldAlpha: 0.5,
  minAlpha: 0.38,
  maxAlpha: 0.58,
  blur: 1.1,
  driftAlong: 0.055,
  driftOut: 0.028,
});
export const NOTE_DURATIONS = Object.freeze(["half", "quarter", "eighth", "sixteenth"]);
/** Quieter than the first capsular field: smaller, paler, with a brief self-twinkle boost. */
export const STAR_STYLE = Object.freeze({
  minLength: 7,
  lengthRange: 5.2,
  minThickness: 2.5,
  thicknessRange: 1.5,
  restScale: 0.52,
  rippleScale: 0.38,
  twinkleScale: 0.28,
  restAlpha: 0.18,
  rippleAlpha: 0.16,
  maxAlpha: 0.7,
  twinkleWidth: 0.4,
  twinkleMinPeriod: 3.2,
  twinklePeriodRange: 3.8,
  twinkleFire: 0.5,
});

export function starPaintAlpha(baseAlpha, twinkle) {
  const t = Math.max(0, Math.min(1, twinkle || 0));
  return Math.min(STAR_STYLE.maxAlpha, Math.max(0.1, baseAlpha + t * 0.42));
}

export function starCount(reduced = false) {
  return reduced ? STAR_COUNTS.reduced : STAR_COUNTS.full;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function mixRgb(a, b, t) {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
}

function hashLattice(ix, iy) {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** Occasional 0–1 brightness pulse, independent of the pointer. Sparse, not a strobe. */
export function starSelfTwinkle(seed, seconds) {
  const period = STAR_STYLE.twinkleMinPeriod + seed * STAR_STYLE.twinklePeriodRange;
  const width = STAR_STYLE.twinkleWidth;
  const shifted = seconds + seed * 19.7;
  const cycle = Math.floor(shifted / period);
  const t = shifted - cycle * period;
  const fires = hashLattice(Math.floor(seed * 10000) + 3, cycle) < STAR_STYLE.twinkleFire;
  if (!fires || t < 0 || t > width) return 0;
  return Math.sin((t / width) * Math.PI);
}

export function isNoteCenter(u, v, band = NOTE_STYLE.band) {
  return u > band && u < 1 - band && v > band && v < 1 - band;
}

/** Map a random sample onto the border band, with depth from the outer edge. */
export function seedNoteSite(rand, band = NOTE_STYLE.band) {
  const side = Math.floor(rand() * 4);
  const along = rand();
  const depth = rand() * band;
  if (side === 0) return { u: along, v: depth };
  if (side === 1) return { u: 1 - depth, v: along };
  if (side === 2) return { u: along, v: 1 - depth };
  return { u: depth, v: along };
}

export function projectToNoteBand(u, v, band = NOTE_STYLE.band) {
  const cu = Math.max(0, Math.min(1, u));
  const cv = Math.max(0, Math.min(1, v));
  if (!isNoteCenter(cu, cv, band)) return { u: cu, v: cv };
  const left = cu - band;
  const right = 1 - band - cu;
  const top = cv - band;
  const bottom = 1 - band - cv;
  const nearest = Math.min(left, right, top, bottom);
  if (nearest === left) return { u: band, v: cv };
  if (nearest === right) return { u: 1 - band, v: cv };
  if (nearest === top) return { u: cu, v: band };
  return { u: cu, v: 1 - band };
}

/** Soft wander along the rim; stays in the band so the center stays clear. */
export function noteDrift(u, v, phase, time, travel = 1, band = NOTE_STYLE.band) {
  const along = Math.sin(time * 0.0018 + phase) * NOTE_STYLE.driftAlong * travel;
  const out = Math.cos(time * 0.0022 + phase * 1.3) * NOTE_STYLE.driftOut * travel;
  const left = u;
  const right = 1 - u;
  const top = v;
  const bottom = 1 - v;
  const nearest = Math.min(left, right, top, bottom);
  let nu = u;
  let nv = v;
  if (nearest === top || nearest === bottom) {
    nu = u + along;
    nv = v + (nearest === top ? out : -out);
  } else {
    nv = v + along;
    nu = u + (nearest === left ? out : -out);
  }
  return projectToNoteBand(nu, nv, band);
}

/** Original value-noise field in 0..1, used for wander, drift, and color morph. */
export function valueNoise2(x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = fade(x - x0);
  const fy = fade(y - y0);
  const a = hashLattice(x0, y0);
  const b = hashLattice(x0 + 1, y0);
  const c = hashLattice(x0, y0 + 1);
  const d = hashLattice(x0 + 1, y0 + 1);
  return mix(mix(a, b, fx), mix(c, d, fx), fy);
}

export function valueNoise3(x, y, z) {
  const z0 = Math.floor(z);
  const fz = fade(z - z0);
  return mix(
    valueNoise2(x + z0 * 19.13, y + z0 * 7.71),
    valueNoise2(x + (z0 + 1) * 19.13, y + (z0 + 1) * 7.71),
    fz,
  );
}

export function signedNoise3(x, y, z) {
  return valueNoise3(x, y, z) * 2 - 1;
}

export function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / ((edge1 - edge0) || 1)));
  return t * t * (3 - 2 * t);
}

/** Even spread in the unit square; not a grid and not random clumps. */
export function poissonDisk(count, rand = Math.random) {
  const width = 1;
  const height = 1;
  const minDist = Math.sqrt((width * height) / Math.max(1, count)) * 0.84;
  const cell = minDist / Math.SQRT2;
  const gw = Math.max(1, Math.ceil(width / cell));
  const gh = Math.max(1, Math.ceil(height / cell));
  const grid = new Array(gw * gh).fill(-1);
  const pts = [];
  const active = [];
  function add(x, y) {
    const i = pts.length;
    pts.push({ u: x, v: y });
    const gx = Math.min(gw - 1, Math.max(0, Math.floor(x / cell)));
    const gy = Math.min(gh - 1, Math.max(0, Math.floor(y / cell)));
    grid[gx + gy * gw] = i;
    active.push(i);
  }
  add(rand() * width, rand() * height);
  while (active.length && pts.length < count) {
    const ai = Math.floor(rand() * active.length);
    const base = pts[active[ai]];
    let placed = false;
    for (let k = 0; k < 28; k++) {
      const ang = rand() * Math.PI * 2;
      const rad = minDist * (1 + rand());
      const x = base.u + Math.cos(ang) * rad;
      const y = base.v + Math.sin(ang) * rad;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const gx = Math.floor(x / cell);
      const gy = Math.floor(y / cell);
      let ok = true;
      for (let yy = gy - 2; yy <= gy + 2 && ok; yy++) {
        for (let xx = gx - 2; xx <= gx + 2; xx++) {
          if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
          const j = grid[xx + yy * gw];
          if (j >= 0 && Math.hypot(pts[j].u - x, pts[j].v - y) < minDist) ok = false;
        }
      }
      if (ok) {
        add(x, y);
        placed = true;
        break;
      }
    }
    if (!placed) active.splice(ai, 1);
  }
  let guard = 0;
  while (pts.length < count && guard++ < count * 50) {
    const x = rand() * width;
    const y = rand() * height;
    let ok = true;
    for (const p of pts) {
      if (Math.hypot(p.u - x, p.v - y) < minDist * 0.7) { ok = false; break; }
    }
    if (ok) add(x, y);
  }
  return pts;
}

/** Soft annular pulse whose radius breathes in normalized space. */
export function rippleRadius(seconds) {
  return 0.175 + Math.sin(seconds) * 0.03 + Math.cos(seconds * 3) * 0.02;
}

export function rippleAmount(dist, radius) {
  const band = 0.1;
  const ring = Math.exp(-((dist - radius) * (dist - radius)) / (2 * (band * 0.52) * (band * 0.52)));
  const inside = 1 - smoothstep(0, radius + 0.045, dist);
  const halo = 1 - smoothstep(radius - band * 1.6, radius + band * 1.8, dist);
  return ring * 1.2 + inside * 0.32 + halo * 0.1;
}

export function morphStarColor(u, v, seconds) {
  const n = valueNoise3(u * 2.1, v * 2.1, seconds * 0.45);
  const progress = smoothstep(0.06, 0.94, n);
  const split = 0.58;
  if (progress < split) return mixRgb(STAR_PALETTE[0], STAR_PALETTE[1], progress / split);
  return mixRgb(STAR_PALETTE[1], STAR_PALETTE[2], (progress - split) / (1 - split));
}

export function drawCapsule(ctx, x, y, length, thickness, angle, color, alpha) {
  const hw = length / 2;
  const hh = thickness / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.fillStyle = `rgba(${Math.round(color[0])},${Math.round(color[1])},${Math.round(color[2])},1)`;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(-hw, -hh, length, thickness, hh);
  } else {
    ctx.moveTo(-hw + hh, -hh);
    ctx.lineTo(hw - hh, -hh);
    ctx.arc(hw - hh, 0, hh, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(-hw + hh, hh);
    ctx.arc(-hw + hh, 0, hh, Math.PI / 2, -Math.PI / 2);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function createStarField(width, height, options = {}) {
  const reduced = !!options.reduced;
  const rand = options.rand || Math.random;
  const count = starCount(reduced);
  const pts = poissonDisk(count, rand);
  const particles = pts.map((p, i) => ({
    kind: "star",
    u: p.u,
    v: p.v,
    x: p.u * width,
    y: p.v * height,
    phase: rand() * Math.PI * 2,
    seed: rand(),
    length: STAR_STYLE.minLength + rand() * STAR_STYLE.lengthRange,
    thickness: STAR_STYLE.minThickness + rand() * STAR_STYLE.thicknessRange,
    scale: STAR_STYLE.restScale,
    color: STAR_PALETTE[i % STAR_PALETTE.length].slice(),
    alpha: STAR_STYLE.restAlpha,
    twinkle: 0,
    angle: 0,
  }));
  return {
    width,
    height,
    reduced,
    seconds: options.seconds || 0,
    particles,
    ringX: 0,
    ringY: 0,
    pointerX: null,
    pointerY: null,
  };
}

export function stepStarField(field, dt, options = {}) {
  const seconds = (field.seconds || 0) + dt;
  field.seconds = seconds;
  if (options.width) field.width = options.width;
  if (options.height) field.height = options.height;
  const width = field.width;
  const height = field.height;
  const span = Math.min(width, height) || 1;
  const calm = field.reduced ? 0.35 : 1;
  const px = options.pointerX;
  const py = options.pointerY;
  const over = Number.isFinite(px) && Number.isFinite(py) && px >= 0 && py >= 0 && px <= width && py <= height;
  const wanderX = signedNoise3(seconds * 0.11, 1.7, 0.4) * 0.22 * calm + Math.sin(seconds * 0.17) * 0.04 * calm;
  const wanderY = signedNoise3(seconds * 0.09, 8.3, 0.6) * 0.18 * calm + Math.cos(seconds * 0.13) * 0.04 * calm;
  let targetX = wanderX;
  let targetY = wanderY;
  if (over) {
    targetX = ((px - width / 2) / span) * 0.72 + wanderX * 0.22;
    targetY = ((py - height / 2) / span) * 0.72 + wanderY * 0.22;
  }
  const follow = over ? 0.025 * Math.min(dt * 60, 2) : 0.012 * Math.min(dt * 60, 2);
  field.ringX += (targetX - field.ringX) * follow;
  field.ringY += (targetY - field.ringY) * follow;
  field.pointerX = over ? px : null;
  field.pointerY = over ? py : null;
  const radius = rippleRadius(seconds);
  const pulse = field.reduced ? 0.4 : 1;
  for (const p of field.particles) {
    const restX = p.u * width;
    const restY = p.v * height;
    const nx = (restX - width / 2) / span;
    const ny = (restY - height / 2) / span;
    const n1 = signedNoise3(p.u * 4.1, p.v * 4.1, seconds * 0.32);
    const n2 = signedNoise3(p.u * 4.1 + 5.1, p.v * 4.1 + 2.4, seconds * 0.32);
    const n3 = signedNoise3(p.u * 18, p.v * 18, seconds * 0.5);
    const n4 = signedNoise3(p.u * 18 + 3.2, p.v * 18 + 1.1, seconds * 0.5);
    let dx = (n1 * 0.03 + n3 * 0.006) * span * calm;
    let dy = (n2 * 0.03 + n4 * 0.006) * span * calm;
    const dist0 = Math.hypot(nx - field.ringX, ny - field.ringY);
    dx += Math.sin(p.u * 20 + seconds * 3.4) * 0.018 * span * Math.min(dist0, 1) * calm;
    dy += Math.cos(p.v * 20 + seconds * 2.6) * 0.018 * span * Math.min(dist0, 1) * calm;
    const wx = restX + dx;
    const wy = restY + dy;
    const cx = (wx - width / 2) / span;
    const cy = (wy - height / 2) / span;
    const dist = Math.hypot(cx - field.ringX, cy - field.ringY);
    const amount = rippleAmount(dist, radius);
    const push = amount * 0.085 * pulse * span;
    const angTo = Math.atan2(cy - field.ringY, cx - field.ringX);
    p.x = wx + Math.cos(angTo) * push;
    p.y = wy + Math.sin(angTo) * push;
    const twist = signedNoise3(p.u * 10, p.v * 10, seconds * 0.8) * 0.45;
    p.angle = angTo + twist * calm;
    const twinkle = field.reduced ? 0 : starSelfTwinkle(p.seed, seconds);
    p.twinkle = twinkle;
    p.scale = (STAR_STYLE.restScale + amount * STAR_STYLE.rippleScale * pulse + twinkle * STAR_STYLE.twinkleScale) * (0.9 + p.seed * 0.16);
    p.color = morphStarColor(p.u + p.seed, p.v, seconds);
    const rest = (STAR_STYLE.restAlpha + amount * STAR_STYLE.rippleAlpha * pulse) * (field.reduced ? 0.85 : 1);
    p.alpha = starPaintAlpha(rest, twinkle);
  }
  return field;
}

export function paintStarField(ctx, field) {
  const particles = field.particles;
  const order = particles.map((_, i) => i).sort((a, b) => particles[a].scale - particles[b].scale);
  for (const i of order) {
    const p = particles[i];
    const length = p.length * p.scale;
    const thickness = p.thickness * (0.85 + p.scale * 0.2);
    drawCapsule(ctx, p.x, p.y, length, thickness, p.angle, p.color, p.alpha);
  }
}

function noteHeadSize(radius) {
  return Math.max(7.5, Math.min(13.5, radius * 5.4));
}

function stemAttach(size, stemUp) {
  const rx = size * 0.68;
  const ry = size * 0.5;
  if (stemUp) return { x: rx * 0.86, y: -ry * 0.18 };
  return { x: -rx * 0.86, y: ry * 0.18 };
}

export function drawNoteHead(ctx, size, duration) {
  const rx = size * 0.68;
  const ry = size * 0.5;
  const tilt = -0.38;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, tilt, 0, Math.PI * 2);
  if (duration === "half") {
    ctx.ellipse(0, 0, rx * 0.58, ry * 0.46, tilt, 0, Math.PI * 2, true);
    if (typeof ctx.fill === "function") ctx.fill("evenodd");
    else ctx.fill();
  } else {
    ctx.fill();
  }
}

export function drawNoteFlag(ctx, size, stemUp, index = 0) {
  const attach = stemAttach(size, stemUp);
  const stemLen = size * 3.45;
  const tipY = stemUp ? attach.y - stemLen : attach.y + stemLen;
  const dir = stemUp ? 1 : -1;
  const startY = tipY + dir * size * (0.02 + index * 0.9);
  const sp = size;
  ctx.beginPath();
  ctx.moveTo(attach.x, startY);
  // Hooked flag whose tip stays out to the right, not a closed loop back on the stem.
  ctx.bezierCurveTo(
    attach.x + sp * 1.15, startY + dir * sp * 0.12,
    attach.x + sp * 1.85, startY + dir * sp * 0.78,
    attach.x + sp * 1.08, startY + dir * sp * 1.58,
  );
  ctx.bezierCurveTo(
    attach.x + sp * 1.42, startY + dir * sp * 1.02,
    attach.x + sp * 0.7, startY + dir * sp * 0.42,
    attach.x, startY + dir * sp * 0.7,
  );
  ctx.closePath();
  ctx.fill();
}

export function drawBeamPolygon(ctx, x0, y0, x1, y1, thickness) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len * thickness / 2;
  const ny = dx / len * thickness / 2;
  ctx.beginPath();
  ctx.moveTo(x0 + nx, y0 + ny);
  ctx.lineTo(x1 + nx, y1 + ny);
  ctx.lineTo(x1 - nx, y1 - ny);
  ctx.lineTo(x0 - nx, y0 - ny);
  ctx.closePath();
  ctx.fill();
}

export function drawNoteGlyph(ctx, options) {
  const x = options.x;
  const y = options.y;
  const size = options.size || 10;
  const duration = options.duration || "quarter";
  const stemUp = options.stemUp !== false;
  const color = options.color || NOTE_PALETTE[0];
  const alpha = options.alpha == null ? 1 : options.alpha;
  const withFlag = options.withFlag !== false && !options.beamed;
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},1)`;
  ctx.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},1)`;
  ctx.lineCap = "butt";
  ctx.lineJoin = "round";
  drawNoteHead(ctx, size, duration);
  if (duration !== "whole") {
    const attach = stemAttach(size, stemUp);
    const stemLen = size * 3.45;
    ctx.lineWidth = Math.max(1.15, size * 0.12);
    ctx.beginPath();
    ctx.moveTo(attach.x, attach.y);
    ctx.lineTo(attach.x, stemUp ? attach.y - stemLen : attach.y + stemLen);
    ctx.stroke();
    if (withFlag && (duration === "eighth" || duration === "sixteenth")) {
      drawNoteFlag(ctx, size, stemUp, 0);
      if (duration === "sixteenth") drawNoteFlag(ctx, size, stemUp, 1);
    }
  }
  ctx.restore();
}

export function drawBeamedGroup(ctx, options) {
  const notes = options.notes || [];
  if (!notes.length) return;
  const color = options.color || notes[0].color || NOTE_PALETTE[0];
  const alpha = options.alpha == null ? 1 : options.alpha;
  const size = options.size || notes[0].size || 10;
  const stemUp = notes[0].stemUp !== false;
  const kind = options.kind || notes[0].duration || "eighth";
  if (options.staff) {
    const xs = notes.map((n) => n.x);
    const ys = notes.map((n) => n.y);
    const left = Math.min(...xs) - size * 1.6;
    const right = Math.max(...xs) + size * 1.6;
    const midY = (Math.min(...ys) + Math.max(...ys)) / 2;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha * 0.22));
    ctx.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},1)`;
    ctx.lineWidth = Math.max(0.7, size * 0.06);
    for (let i = -2; i <= 2; i++) {
      const y = midY + i * (size * 0.52);
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
    }
    ctx.restore();
  }
  for (const note of notes) {
    drawNoteGlyph(ctx, {
      x: note.x,
      y: note.y,
      size: note.size || size,
      duration: note.duration || kind,
      stemUp,
      color: note.color || color,
      alpha,
      beamed: true,
      withFlag: false,
    });
  }
  const tips = notes.map((note) => {
    const sz = note.size || size;
    const attach = stemAttach(sz, stemUp);
    const stemLen = sz * 3.45;
    return { x: note.x + attach.x, y: note.y + (stemUp ? attach.y - stemLen : attach.y + stemLen) };
  });
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},1)`;
  const thickness = size * 0.42;
  drawBeamPolygon(ctx, tips[0].x, tips[0].y, tips[tips.length - 1].x, tips[tips.length - 1].y, thickness);
  if (kind === "sixteenth") {
    const inward = stemUp ? size * 0.72 : -size * 0.72;
    drawBeamPolygon(
      ctx,
      tips[0].x, tips[0].y + inward,
      tips[tips.length - 1].x, tips[tips.length - 1].y + inward,
      thickness * 0.82,
    );
  }
  ctx.restore();
}

function pickNoteDuration(rand) {
  const roll = rand();
  if (roll < 0.14) return "half";
  if (roll < 0.5) return "quarter";
  if (roll < 0.78) return "eighth";
  return "sixteenth";
}

export function seedNoteParticles(count, rand = Math.random) {
  const particles = [];
  let leftover = count;
  let groupSerial = 1;
  while (leftover > 0) {
    const tint = NOTE_PALETTE[particles.length % NOTE_PALETTE.length];
    const wantGroup = leftover >= 2 && rand() < 0.4;
    if (wantGroup) {
      const size = Math.min(leftover, 2 + Math.floor(rand() * 3));
      const stemUp = rand() < 0.58;
      const duration = rand() < 0.42 ? "sixteenth" : "eighth";
      const groupId = groupSerial++;
      const contour = [0, 0.7, -0.35, 1.05, 0.3];
      const site = seedNoteSite(rand);
      const u = site.u;
      const v = site.v;
      const phase = rand() * Math.PI * 2;
      const radius = 1.35 + rand() * 1.2;
      const staff = rand() < 0.28;
      for (let i = 0; i < size; i++) {
        particles.push({
          kind: "note",
          u,
          v,
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          phase,
          radius,
          tint: tint.slice(),
          duration,
          stemUp,
          groupId,
          groupIndex: i,
          groupSize: size,
          contour: contour[i] || 0,
          staff: i === 0 && staff,
        });
      }
      leftover -= size;
    } else {
      const site = seedNoteSite(rand);
      particles.push({
        kind: "note",
        u: site.u,
        v: site.v,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        phase: rand() * Math.PI * 2,
        radius: 1.35 + rand() * 1.2,
        tint: tint.slice(),
        duration: pickNoteDuration(rand),
        stemUp: rand() < 0.58,
        groupId: 0,
        groupIndex: 0,
        groupSize: 1,
        contour: 0,
        staff: false,
      });
      leftover -= 1;
    }
  }
  return particles;
}

export function paintNoteField(ctx, particles, options = {}) {
  const groups = new Map();
  const solo = [];
  for (const p of particles) {
    if (p.groupSize > 1 && p.groupId) {
      if (!groups.has(p.groupId)) groups.set(p.groupId, []);
      groups.get(p.groupId).push(p);
    } else solo.push(p);
  }
  const blur = options.blur == null ? NOTE_STYLE.blur : options.blur;
  ctx.save();
  if (blur > 0 && ctx.filter !== undefined) ctx.filter = `blur(${blur}px)`;
  const fallback = options.alpha == null ? NOTE_STYLE.fieldAlpha : options.alpha;
  for (const p of solo) {
    const size = noteHeadSize(p.radius);
    const twinkle = options.twinkle === false ? 1 : (0.88 + 0.12 * Math.sin((options.time || 0) * 0.01 + p.phase));
    drawNoteGlyph(ctx, {
      x: p.x,
      y: p.y,
      size,
      duration: p.duration,
      stemUp: p.stemUp,
      color: p.tint,
      alpha: (p.alpha == null ? fallback : p.alpha) * twinkle,
    });
  }
  for (const members of groups.values()) {
    members.sort((a, b) => a.groupIndex - b.groupIndex);
    const lead = members[0];
    const size = noteHeadSize(lead.radius);
    const twinkle = options.twinkle === false ? 1 : (0.88 + 0.12 * Math.sin((options.time || 0) * 0.01 + lead.phase));
    drawBeamedGroup(ctx, {
      notes: members.map((p) => ({ x: p.x, y: p.y, size: noteHeadSize(p.radius), duration: p.duration, stemUp: p.stemUp, color: p.tint })),
      color: lead.tint,
      alpha: (lead.alpha == null ? fallback : lead.alpha) * twinkle,
      size,
      kind: lead.duration,
      staff: lead.staff,
    });
  }
  ctx.restore();
}

/** Pin the settings pill to the top-right; reserve header space when it fits, otherwise sit just under the header. */

/** Always-visible right-edge page scrollbar on every screen, so macOS overlay bars are not the only affordance. */
const SECONDARY_SCROLL = ".zone-panel, [data-secondary-scroll], aside, .px-fx-settings, .px-page-scrollbar, .px-halo, .px-ripple, .px-ink-field";

function documentScrollMetrics(doc, win) {
  const html = doc.documentElement;
  const view = win.innerHeight || html.clientHeight || 0;
  const total = Math.max(html.scrollHeight || 0, doc.body?.scrollHeight || 0, view);
  const max = Math.max(0, total - view);
  const top = html.scrollTop || win.scrollY || 0;
  return { kind: "document", el: doc.scrollingElement || html, view, total, max, top };
}

function elementScrollMetrics(el) {
  const view = el.clientHeight || 0;
  const total = Math.max(el.scrollHeight || 0, view);
  const max = Math.max(0, total - view);
  return { kind: "element", el, view, total, max, top: el.scrollTop || 0 };
}

function overflowAmount(el) {
  const view = el.clientHeight || 0;
  return Math.max(0, Math.max(el.scrollHeight || 0, view) - view);
}

/** Pick the active primary vertical scroller: the document on home (and any page that itself scrolls), otherwise the main content scroller of a locked workspace. */
export function primaryScrollMetrics(doc = document, win = window) {
  if (doc.querySelector("[data-home-landing]")) return documentScrollMetrics(doc, win);
  const marked = doc.querySelector("[data-primary-scroll]");
  if (marked) return elementScrollMetrics(marked);
  const locked = doc.querySelector(".app-shell:not([data-home-landing])");
  if (!locked) {
    const page = documentScrollMetrics(doc, win);
    if (page.max > 1) return page;
  }
  const stage = (locked || doc).querySelector(".score-stage");
  if (stage) return elementScrollMetrics(stage);
  const roots = [locked, doc.querySelector(".app-shell"), doc.getElementById("root"), doc.body].filter(Boolean);
  const seen = new Set();
  let best = null, bestArea = 0, bestOverflow = 0;
  for (const root of roots) {
    for (const el of root.querySelectorAll("*")) {
      if (seen.has(el) || el.closest(SECONDARY_SCROLL)) continue;
      seen.add(el);
      const overflow = overflowAmount(el);
      if (overflow <= 1) continue;
      const area = (el.clientWidth || 0) * (el.clientHeight || 0);
      if (area > bestArea || (area === bestArea && overflow > bestOverflow)) {
        best = el;
        bestArea = area;
        bestOverflow = overflow;
      }
    }
  }
  if (best) return elementScrollMetrics(best);
  return { kind: "none", el: null, view: 0, total: 0, max: 0, top: 0 };
}

export function installPageScrollbar(doc = document, win = window) {
  const existing = doc.querySelector(".px-page-scrollbar");
  if (existing) existing.remove();
  const bar = doc.createElement("div");
  bar.className = "px-page-scrollbar";
  bar.setAttribute("role", "scrollbar");
  bar.setAttribute("aria-label", "页面滚动");
  bar.setAttribute("aria-orientation", "vertical");
  bar.hidden = true;
  const thumb = doc.createElement("div");
  thumb.className = "px-page-scrollbar-thumb";
  bar.append(thumb);
  doc.body.append(bar);

  let raf = 0;
  let refreshing = false;
  let attached = null;
  let targetClass = null;

  function unbindScroller() {
    if (attached && attached !== "window") {
      attached.removeEventListener("scroll", requestRefresh);
    }
    if (targetClass) {
      targetClass.classList.remove("px-page-scroll-target");
      targetClass = null;
    }
    attached = null;
  }

  function bindScroller(metrics) {
    const next = !metrics.el || metrics.kind === "document" ? "window" : metrics.el;
    const nextClass = metrics.kind === "element" ? metrics.el : null;
    if (targetClass !== nextClass) {
      if (targetClass) targetClass.classList.remove("px-page-scroll-target");
      targetClass = nextClass;
      if (targetClass && !targetClass.classList.contains("px-page-scroll-target")) {
        targetClass.classList.add("px-page-scroll-target");
      }
    }
    if (attached === next) return;
    if (attached && attached !== "window") attached.removeEventListener("scroll", requestRefresh);
    attached = next;
    if (attached && attached !== "window") {
      attached.addEventListener("scroll", requestRefresh, { passive: true });
    }
  }

  function refresh() {
    if (refreshing) return { visible: !bar.hidden, skipped: true };
    refreshing = true;
    try {
      const metrics = primaryScrollMetrics(doc, win);
      bindScroller(metrics);
      const { view, total, max, top } = metrics;
      const visible = !!metrics.el && max > 1;
      if (bar.hidden === visible) bar.hidden = !visible;
      if (!visible) return { visible: false, max, kind: metrics.kind };
      const track = bar.getBoundingClientRect().height || win.innerHeight || view;
      const thumbH = Math.max(44, Math.min(track, (view / Math.max(total, 1)) * track));
      const span = Math.max(1, track - thumbH);
      const y = max <= 0 ? 0 : (top / max) * span;
      const height = `${thumbH}px`;
      const transform = `translateY(${y}px)`;
      if (thumb.style.height !== height) thumb.style.height = height;
      if (thumb.style.transform !== transform) thumb.style.transform = transform;
      const ariaMax = String(Math.round(max));
      const ariaNow = String(Math.round(top));
      if (bar.getAttribute("aria-valuemin") !== "0") bar.setAttribute("aria-valuemin", "0");
      if (bar.getAttribute("aria-valuemax") !== ariaMax) bar.setAttribute("aria-valuemax", ariaMax);
      if (bar.getAttribute("aria-valuenow") !== ariaNow) bar.setAttribute("aria-valuenow", ariaNow);
      return { visible: true, max, thumbH, y, kind: metrics.kind };
    } finally {
      refreshing = false;
    }
  }
  function requestRefresh() {
    if (raf) return;
    raf = win.requestAnimationFrame(() => {
      raf = 0;
      refresh();
    });
  }

  let drag = null;
  function scrollToY(next) {
    const metrics = primaryScrollMetrics(doc, win);
    if (!metrics.el) return;
    const y = Math.max(0, Math.min(metrics.max, next));
    metrics.el.scrollTop = y;
    refresh();
  }
  function onPointerDown(event) {
    if (bar.hidden) return;
    event.preventDefault();
    const { max, top } = primaryScrollMetrics(doc, win);
    const track = bar.getBoundingClientRect();
    const thumbBox = thumb.getBoundingClientRect();
    const thumbH = thumbBox.height || 44;
    const span = Math.max(1, track.height - thumbH);
    let startTop = top;
    if (event.target !== thumb && !thumb.contains(event.target)) {
      startTop = ((event.clientY - track.top - thumbH / 2) / span) * max;
      scrollToY(startTop);
    }
    drag = { startY: event.clientY, startTop, span, max };
    thumb.setPointerCapture?.(event.pointerId);
  }
  function onPointerMove(event) {
    if (!drag) return;
    scrollToY(drag.startTop + ((event.clientY - drag.startY) / drag.span) * drag.max);
  }
  function onPointerUp() { drag = null; }

  bar.addEventListener("pointerdown", onPointerDown);
  win.addEventListener("pointermove", onPointerMove);
  win.addEventListener("pointerup", onPointerUp);
  win.addEventListener("scroll", requestRefresh, { passive: true });
  win.addEventListener("resize", requestRefresh);
  refresh();
  return { element: bar, refresh, destroy() {
    if (raf) win.cancelAnimationFrame(raf);
    raf = 0;
    unbindScroller();
    bar.removeEventListener("pointerdown", onPointerDown);
    win.removeEventListener("pointermove", onPointerMove);
    win.removeEventListener("pointerup", onPointerUp);
    win.removeEventListener("scroll", requestRefresh);
    win.removeEventListener("resize", requestRefresh);
    bar.remove();
  } };
}

export function placeFxSettings(box, doc, win) {
  if (!box || box.hidden) {
    if (box) box.style.top = "";
    doc.documentElement.style.removeProperty("--px-fx-reserve");
    return { placement: "hidden", reserve: 0 };
  }
  box.style.top = "";
  const header = doc.querySelector("[data-home-landing] > header");
  const width = box.getBoundingClientRect().width || 0;
  const gap = 8;
  let used = 0;
  if (header) {
    for (const child of header.children) used += child.getBoundingClientRect().width;
    used += 32;
  }
  const fits = Boolean(header && width > 0 && used + width + gap <= (win.innerWidth || 0));
  if (fits) {
    const reserve = Math.ceil(width + gap);
    doc.documentElement.style.setProperty("--px-fx-reserve", `${reserve}px`);
    return { placement: "header-right", reserve };
  }
  doc.documentElement.style.removeProperty("--px-fx-reserve");
  const bottom = header?.getBoundingClientRect().bottom || 0;
  if (bottom > 0) box.style.top = `${Math.ceil(bottom + gap)}px`;
  return { placement: "below-header", reserve: 0 };
}

export function readFxMode(storage) {
  try {
    const value = storage?.getItem?.(FX_STORAGE_KEY);
    return FX_MODES.includes(value) ? value : FX_DEFAULT_MODE;
  } catch {
    return FX_DEFAULT_MODE;
  }
}

export function writeFxMode(storage, mode) {
  if (!FX_MODES.includes(mode)) return;
  try { storage?.setItem?.(FX_STORAGE_KEY, mode); } catch { /* private mode */ }
}

export function fxStorage(win) {
  try { return win.localStorage; } catch { return null; }
}


/** A presentation-only field; sounding elements remain owned by the renderer. */
export const INK_STYLE = Object.freeze({ homeAlpha:.36, edgeAlpha:.17, centerAlpha:.04, minRadius:1.2, radiusRange:1.5, pointerRadius:240, pointerForce:4.3 });

const FX_MAX_PIXELS = 1920 * 1080;
const FX_FRAME_INTERVAL = 1000 / 60 - 0.1; // Allow for rAF timestamp rounding.

export function installInkField(doc = document, win = window, options = {}) {
  const homeOnly = options.homeOnly === true;
  const motion = win.matchMedia('(prefers-reduced-motion: reduce)');
  const desktop = win.matchMedia('(hover: hover) and (pointer: fine)');
  const particles = [];
  let canvas, ctx, frame = 0, previous = null, time = 0, target = null, blend = 0;
  let contextUnavailable = false;
  let width = 0, height = 0, destroyed = false, lastRect = null, lastSoundAt = -Infinity, dirty = true;
  const pointer = { x:-1000, y:-1000 };
  let mode = readFxMode(fxStorage(win));
  let starField = null;
  const state = {
    particles,
    get frame() { return frame; },
    get time() { return time; },
    get blend() { return blend; },
    get target() { return target; },
    get star() { return starField; },
  };
  function seedInkParticle() {
    const u = Math.random(), v = Math.random();
    return { kind:"ink", u, v, x:u * width, y:v * height, vx:0, vy:0, phase:Math.random() * Math.PI * 2, radius:INK_STYLE.minRadius + Math.random() * INK_STYLE.radiusRange };
  }
  function syncParticles() {
    if (mode === "stars") {
      const count = starCount(motion.matches);
      if (!starField || starField.particles.length !== count || starField.reduced !== motion.matches) {
        starField = createStarField(width, height, { reduced: motion.matches });
      } else {
        starField.width = width;
        starField.height = height;
      }
      particles.length = 0;
      particles.push(...starField.particles);
      return;
    }
    starField = null;
    if (mode === "notes") {
      if (!particles.length || particles[0]?.kind !== "note" || particles.length !== FX_COUNTS.notes) {
        particles.length = 0;
        particles.push(...seedNoteParticles(FX_COUNTS.notes));
        for (const p of particles) { p.x = p.u * width; p.y = p.v * height; }
      }
      return;
    }
    if (particles[0]?.kind && particles[0].kind !== "ink") particles.length = 0;
    const n = FX_COUNTS[mode] ?? FX_COUNTS.ink;
    while (particles.length < n) particles.push(seedInkParticle());
    if (particles.length > n) particles.length = n;
  }
  function editing() {
    const el = doc.activeElement;
    if (!el || el === doc.body || el === doc.documentElement) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }
  function select() {
    dirty = false;
    if (editing()) { target = null; return; }
    target = [...doc.querySelectorAll('.is-sounding')].find(el => {
      const r = el.getBoundingClientRect();
      return el.isConnected && !el.parentElement?.closest('.is-sounding') && !el.closest('[hidden],[aria-hidden="true"]') && win.getComputedStyle(el).visibility !== 'hidden' && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < height;
    }) || null;
  }
  const observer = new win.MutationObserver(() => { dirty = true; });
  function size() {
    width = win.innerWidth; height = win.innerHeight;
    const ratio = Math.min(win.devicePixelRatio || 1, 2, Math.sqrt(FX_MAX_PIXELS / (width * height)));
    const pixelWidth = Math.floor(width * ratio);
    const pixelHeight = Math.floor(height * ratio);
    // Shrink before growing either axis to avoid an oversized intermediate buffer.
    if (pixelHeight < canvas.height) canvas.height = pixelHeight;
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    ctx.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0);
    if (starField) { starField.width = width; starField.height = height; }
  }
  function placeNotes(dt, home, rect) {
    particles.forEach((p, i) => {
      const travel = motion.matches ? 0.35 : 1;
      const rim = mode === "notes" ? noteDrift(p.u, p.v, p.phase, time, travel) : null;
      const hx = rim ? rim.u * width : p.u * width + Math.sin(time * .0025 + p.phase) * 20 * travel;
      const hy = rim ? rim.v * height : p.v * height + Math.cos(time * .002 + p.phase) * 16 * travel;
      let tx = hx, ty = hy;
      if (p.groupSize > 1 && p.groupId) {
        const spacing = noteHeadSize(p.radius) * 1.85;
        tx = hx + p.groupIndex * spacing;
        ty = hy + (p.contour || 0) * noteHeadSize(p.radius);
      }
      const formed = i < 64 && p.kind !== "note";
      if (formed && rect) {
        const angle = i * 2.39996;
        const radius = Math.sqrt((i % 48 + .5) / 48);
        const nx = i < 48 ? Math.cos(angle) * radius * 15 : 12;
        const ny = i < 48 ? Math.sin(angle) * radius * 9 - nx * .28 : -((i - 48) / 15) * 43;
        tx += (Math.max(24, Math.min(width - 24, rect.left + rect.width / 2 + nx)) - hx) * blend;
        ty += (Math.max(52, rect.top - 22) + ny - hy) * blend;
      }
      const dx = p.x - pointer.x, dy = p.y - pointer.y;
      const distance = Math.hypot(dx, dy);
      const push = Math.max(0, 1 - distance / INK_STYLE.pointerRadius) * (1 - (formed ? blend : 0));
      const spring = .008 + (formed ? blend * .052 : 0);
      const damping = Math.pow(.85 - (formed ? blend * .12 : 0), dt);
      p.vx = (p.vx + (tx - p.x) * spring * dt + dx / (distance || 1) * push * INK_STYLE.pointerForce * dt) * damping;
      p.vy = (p.vy + (ty - p.y) * spring * dt + dy / (distance || 1) * push * INK_STYLE.pointerForce * dt) * damping;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (mode === "notes" && width > 0 && height > 0) {
        const kept = projectToNoteBand(p.x / width, p.y / height);
        p.x = kept.u * width;
        p.y = kept.v * height;
      }
      const edge = Math.min(p.x, width - p.x) < width * .18;
      const alpha = (home ? INK_STYLE.homeAlpha : edge ? INK_STYLE.edgeAlpha : INK_STYLE.centerAlpha) + (formed ? blend * .38 : 0);
      p.alpha = mode === "notes" ? Math.max(NOTE_STYLE.minAlpha, Math.min(NOTE_STYLE.maxAlpha, alpha + 0.12)) : alpha;
      if (mode !== "notes") {
        ctx.fillStyle = `rgba(41,43,37,${alpha})`;
        drawFxStamp(ctx, p, mode, time, alpha);
      }
    });
    if (mode === "notes") paintNoteField(ctx, particles, { time });
  }
  function draw(now) {
    frame = 0;
    if (!canvas || doc.hidden || destroyed || editing()) return;
    if (previous !== null && now - previous < FX_FRAME_INTERVAL) {
      frame = win.requestAnimationFrame(draw);
      return;
    }
    if (ctx.isContextLost?.()) {
      onContextLost();
      return;
    }
    const dt = previous === null ? 1 : Math.min((now - previous) / 16.667, 2);
    previous = now; time += dt;
    if (dirty || (target && !target.isConnected)) select();
    let rect = target?.getBoundingClientRect();
    if (rect) { lastRect = rect; lastSoundAt = now; }
    else if (now - lastSoundAt < 180) rect = lastRect;
    blend += ((rect ? 1 : 0) - blend) * (1 - Math.pow(.94, dt));
    const home = !!doc.querySelector('[data-home-landing]');
    ctx.clearRect(0, 0, width, height);
    if (mode === "stars" && starField) {
      stepStarField(starField, (dt * 16.667) / 1000, {
        width, height,
        pointerX: pointer.x, pointerY: pointer.y,
      });
      paintStarField(ctx, starField);
    } else {
      placeNotes(dt, home, rect);
    }
    frame = win.requestAnimationFrame(draw);
  }
  function suspend() {
    if (frame) win.cancelAnimationFrame(frame);
    frame = 0; previous = null;
  }
  function onContextLost(event) {
    event?.preventDefault();
    contextUnavailable = true;
    reconcile();
  }
  function reconcile() { update(false); }
  function update(afterPaint) {
    mode = readFxMode(fxStorage(win));
    // Atmosphere passes homeOnly: the field is a body-level overlay
    // (z-index 29). The editor wrapper uses view-transition-name, which
    // creates a stacking context, so this canvas would otherwise paint
    // over the score, transport, and hit regions.
    const onHome = !homeOnly || !!doc.querySelector('[data-home-landing]');
    const enabled = !destroyed && !contextUnavailable && onHome && mode !== 'off' && !motion.matches && desktop.matches && win.innerWidth >= 900 && win.innerHeight > 0;
    if (!enabled) {
      canvas?.removeEventListener('contextlost', onContextLost);
      suspend(); canvas?.remove(); canvas = ctx = null; particles.length = 0; starField = null; target = null; blend = 0; lastRect = null; lastSoundAt = -Infinity;
      observer.disconnect(); return;
    }
    if (doc.hidden || editing()) {
      suspend();
      return;
    }
    if (!canvas) {
      if (!afterPaint) {
        // rAF runs before paint. Leave a rendering opportunity before allocating the buffer.
        if (!frame) frame = win.requestAnimationFrame(() => {
          frame = win.requestAnimationFrame(() => {
            frame = 0;
            update(true);
          });
        });
        return;
      }
      canvas = doc.createElement('canvas'); canvas.className = 'px-ink-field';
      canvas.setAttribute('aria-hidden', 'true');
      canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:29';
      ctx = canvas.getContext('2d');
      if (!ctx) { contextUnavailable = true; canvas = null; return; }
      canvas.addEventListener('contextlost', onContextLost);
      doc.body.append(canvas); size();
      observer.observe(doc.getElementById('root') || doc.body, { subtree:true, childList:true, attributes:true, attributeFilter:['class','hidden','aria-hidden'] });
      select();
    } else size();
    syncParticles();
    if (!frame) frame = win.requestAnimationFrame(draw);
  }
  function onFocusChange() {
    queueMicrotask(() => { if (!destroyed) reconcile(); });
  }
  function move(event) { pointer.x = event.clientX; pointer.y = event.clientY; }
  function leave(event) { if (!event.relatedTarget) pointer.x = pointer.y = -1000; }
  motion.addEventListener('change', reconcile); desktop.addEventListener('change', reconcile);
  win.addEventListener('resize', reconcile); win.addEventListener('pointermove', move, { passive:true });
  win.addEventListener('pointerout', leave, { passive:true });
  doc.addEventListener('visibilitychange', reconcile);
  doc.addEventListener('focusin', onFocusChange, true);
  doc.addEventListener('focusout', onFocusChange, true);
  reconcile();
  return { state, refresh() { if (!destroyed) reconcile(); }, destroy() {
    destroyed = true; reconcile();
    motion.removeEventListener('change', reconcile); desktop.removeEventListener('change', reconcile);
    win.removeEventListener('resize', reconcile); win.removeEventListener('pointermove', move); win.removeEventListener('pointerout', leave);
    doc.removeEventListener('visibilitychange', reconcile);
    doc.removeEventListener('focusin', onFocusChange, true);
    doc.removeEventListener('focusout', onFocusChange, true);
  } };
}

function drawFxStamp(ctx, p, mode, time, alpha) {
  if (mode !== "stars" && mode !== "notes") {
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, p.radius, p.radius * .74, p.phase, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (mode === "stars") {
    drawCapsule(ctx, p.x, p.y, (p.length || 12) * (p.scale || 1), (p.thickness || 5) * (p.scale || 1), p.angle || p.phase, p.color || STAR_PALETTE[0], p.alpha == null ? alpha : p.alpha);
    return;
  }
  const size = noteHeadSize(p.radius);
  const twinkle = 0.88 + 0.12 * (0.5 + 0.5 * Math.sin(time * 0.01 + p.phase));
  drawNoteGlyph(ctx, {
    x: p.x,
    y: p.y,
    size,
    duration: p.duration || "quarter",
    stemUp: p.stemUp !== false,
    color: p.tint || NOTE_PALETTE[0],
    alpha: Math.max(0.7, Math.min(1, (alpha + 0.45) * twinkle)),
    withFlag: !(p.groupSize > 1),
    beamed: p.groupSize > 1,
  });
}

function installFxSettings(doc, win, onChange) {
  const existing = doc.querySelector(".px-fx-settings");
  if (existing) existing.remove();
  const box = doc.createElement("div");
  box.className = "px-fx-settings";
  box.setAttribute("role", "radiogroup");
  box.setAttribute("aria-label", "页面效果");
  box.setAttribute("data-legend", "页面效果");
  const labels = { ink: "墨点", stars: "星光", notes: "音符", off: "关闭效果" };
  function paint() {
    const current = readFxMode(fxStorage(win));
    for (const button of box.querySelectorAll("[role=radio]")) {
      button.setAttribute("aria-checked", button.dataset.fx === current ? "true" : "false");
      button.tabIndex = button.dataset.fx === current ? 0 : -1;
    }
  }
  for (const mode of FX_MODES) {
    const button = doc.createElement("button");
    button.type = "button";
    button.setAttribute("role", "radio");
    button.dataset.fx = mode;
    button.textContent = labels[mode];
    button.addEventListener("click", () => {
      writeFxMode(fxStorage(win), mode);
      paint();
      onChange?.();
    });
    box.append(button);
  }
  box.addEventListener("keydown", (event) => {
    const keys = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 1, ArrowUp: -1 };
    const step = keys[event.key];
    if (!step) return;
    event.preventDefault();
    const current = readFxMode(fxStorage(win));
    const next = FX_MODES[(FX_MODES.indexOf(current) + step + FX_MODES.length) % FX_MODES.length];
    writeFxMode(fxStorage(win), next);
    paint();
    onChange?.();
    box.querySelector(`[data-fx="${next}"]`)?.focus();
  });
  paint();
  doc.body.append(box);
  return box;
}

if (typeof window !== 'undefined') installScoreAtmosphere();
