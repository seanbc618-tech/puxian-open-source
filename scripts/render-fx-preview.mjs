import { mkdirSync, writeFileSync } from 'node:fs';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
GlobalFonts.registerFromPath('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', 'Noto Sans CJK SC');
import {
  createStarField, stepStarField, paintStarField, mulberry32,
  seedNoteParticles, paintNoteField, drawNoteGlyph, drawBeamedGroup,
  NOTE_PALETTE, NOTE_STYLE, noteDrift,
} from '../public/site-fx.js';

function headSize(radius) {
  return Math.max(7.5, Math.min(13.5, radius * 5.4));
}

const out = process.env.FX_PREVIEW_DIR || 'artifacts/fx-preview';
mkdirSync(out, { recursive: true });
const paper = '#f7f3ea';

function save(canvas, name) {
  const path = `${out}/${name}`;
  writeFileSync(path, canvas.toBuffer('image/png'));
  console.log('wrote', path, canvas.width, 'x', canvas.height);
}

function fillPaper(ctx, w, h) {
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, w, h);
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function paintHomeStandIn(ctx, w, h) {
  fillPaper(ctx, w, h);
  const cw = Math.min(640, w * 0.5);
  const ch = Math.min(430, h * 0.56);
  const x = (w - cw) / 2;
  const y = (h - ch) / 2;
  ctx.save();
  ctx.shadowColor = '#1c191614';
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = '#fffdf8';
  roundRect(ctx, x, y, cw, ch, 24);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = '#e7e0d3';
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, cw, ch, 24);
  ctx.stroke();
  ctx.fillStyle = '#3b3832';
  ctx.font = '28px "Noto Sans CJK SC", sans-serif';
  ctx.fillText('让旋律，落在纸上。', x + 36, y + 64);
  ctx.font = '15px "Noto Sans CJK SC", sans-serif';
  ctx.fillStyle = '#575047';
  const rows = ['小星星', '欢乐颂', '阿拉伯风格曲第一号'];
  rows.forEach((title, i) => {
    const ry = y + 110 + i * 72;
    ctx.fillStyle = '#f7f3ea';
    roundRect(ctx, x + 28, ry, cw - 56, 56, 14);
    ctx.fill();
    ctx.strokeStyle = '#e7e0d3';
    ctx.stroke();
    ctx.fillStyle = '#292b25';
    ctx.font = '16px "Noto Sans CJK SC", sans-serif';
    ctx.fillText(title, x + 48, ry + 34);
  });
}

const W = 1280;
const H = 800;

function starAt(seconds, pointer, name) {
  const field = createStarField(W, H, { rand: mulberry32(18), seconds: 0 });
  const dt = 1 / 30;
  const frames = Math.max(1, Math.round(seconds / dt));
  for (let i = 0; i < frames; i++) {
    stepStarField(field, dt, pointer ? { pointerX: pointer[0], pointerY: pointer[1] } : {});
  }
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  fillPaper(ctx, W, H);
  paintStarField(ctx, field);
  save(canvas, name);
  return field;
}

function findTwinkleTime(limit = 16) {
  const field = createStarField(W, H, { rand: mulberry32(18), seconds: 0 });
  const dt = 1 / 30;
  let best = { seconds: 1.6, count: 0, peak: 0, score: -1 };
  const frames = Math.round(limit / dt);
  for (let i = 0; i < frames; i++) {
    stepStarField(field, dt);
    const flashing = field.particles.filter((p) => (p.twinkle || 0) > 0.75);
    const peak = flashing.reduce((m, p) => Math.max(m, p.twinkle), 0);
    // A handful of strong flashes reads as "occasional twinkle" better than the densest burst.
    const ideal = 12;
    const score = flashing.length ? (peak * 2) - Math.abs(flashing.length - ideal) * 0.15 : -1;
    if (score > best.score) {
      best = { seconds: field.seconds, count: flashing.length, peak, score };
    }
  }
  return best;
}

starAt(0.05, null, 'stars-rest.png');
const twinkleAt = findTwinkleTime(16);
console.log('twinkle frame', twinkleAt);
starAt(twinkleAt.seconds, null, 'stars-twinkle.png');

const glyph = createCanvas(1280, 340);
const gctx = glyph.getContext('2d');
fillPaper(gctx, 1280, 340);
gctx.fillStyle = '#3b3832';
gctx.font = '16px "Noto Sans CJK SC", sans-serif';
const labels = [
  ['quarter', 90, 180, true, '四分'],
  ['eighth', 230, 180, true, '八分（上）'],
  ['eighth', 370, 150, false, '八分（下）'],
  ['sixteenth', 520, 180, true, '十六分'],
  ['half', 680, 180, true, '二分'],
];
labels.forEach(([duration, x, y, stemUp, label], i) => {
  drawNoteGlyph(gctx, {
    x, y, size: 28, duration, stemUp, color: NOTE_PALETTE[i], alpha: 0.82,
  });
  gctx.globalAlpha = 1;
  gctx.fillStyle = '#3b3832';
  gctx.fillText(label, x - 28, 300);
});
drawBeamedGroup(gctx, {
  notes: [
    { x: 860, y: 198, size: 26, duration: 'eighth', stemUp: true, color: NOTE_PALETTE[4] },
    { x: 912, y: 178, size: 26, duration: 'eighth', stemUp: true, color: NOTE_PALETTE[4] },
    { x: 964, y: 186, size: 26, duration: 'eighth', stemUp: true, color: NOTE_PALETTE[4] },
    { x: 1016, y: 164, size: 26, duration: 'sixteenth', stemUp: true, color: NOTE_PALETTE[4] },
  ],
  kind: 'sixteenth',
  size: 26,
  color: NOTE_PALETTE[4],
  staff: true,
  alpha: 0.82,
});
gctx.globalAlpha = 1;
gctx.fillStyle = '#3b3832';
gctx.fillText('连梁 2–4', 900, 300);
save(glyph, 'notes-glyphs.png');

const notes = seedNoteParticles(240, mulberry32(21));
for (const p of notes) {
  const size = headSize(p.radius);
  const site = noteDrift(p.u, p.v, p.phase, 0, 1);
  const hx = site.u * W;
  const hy = site.v * H;
  if (p.groupSize > 1) {
    p.x = hx + p.groupIndex * size * 1.85;
    p.y = hy + (p.contour || 0) * size;
  } else {
    p.x = hx;
    p.y = hy;
  }
  p.alpha = NOTE_STYLE.fieldAlpha;
}
const fieldCanvas = createCanvas(W, H);
const fctx = fieldCanvas.getContext('2d');
paintHomeStandIn(fctx, W, H);
paintNoteField(fctx, notes, { time: 0, twinkle: false });
save(fieldCanvas, 'notes-field.png');
