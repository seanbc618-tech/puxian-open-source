import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
const output = process.env.FX_OUTPUT || '/tmp/puxian-site-fx';
const origin = process.env.FX_ORIGIN || 'http://127.0.0.1:8090/';
mkdirSync(output, { recursive:true });
const browser = await chromium.launch();
const report = {};
try {
  const c = await browser.newContext({ viewport:{ width:1280, height:800 }, recordVideo:{ dir:output, size:{ width:1280,height:800 } } });
  await c.addInitScript(() => {
    let seed = 117;
    Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  });
  const started = Date.now();
  const p = await c.newPage(); const requests = []; const errors = [];
  p.on('requestfinished', r => requests.push(new URL(r.url()).pathname)); p.on('pageerror', e => errors.push(e.message));
  await p.goto(origin); await p.waitForTimeout(2800);
  assert.equal(await p.locator('canvas.px-ink-field').count(),0);
  assert.equal(requests.length,8); assert.ok(!requests.includes('/site-fx.js'));
  const bytes = requests.reduce((sum,path) => sum + statSync(`dist-static${path === '/' ? '/index.html' : path}`).size,0);
  assert.ok(bytes <= 391586); report.firstScreen = { requests:8, bytes };
  await p.locator('.px-ink-field').waitFor({ state:'attached' });
  await p.waitForTimeout(200);
  await p.screenshot({ path:`${output}/ink-home.png` });
  for (let i=0;i<15;i++) { await p.mouse.move(150+i*34,240+Math.sin(i*.3)*75); await p.waitForTimeout(65); }
  await p.mouse.move(640, 380, { steps:12 });
  await p.waitForTimeout(950);
  await p.screenshot({ path:`${output}/ink-pointer.png` });
  await p.getByRole('button',{ name:'打开小星星', exact:true }).click();
  await p.getByRole('button',{ name:'播放', exact:true }).click();
  await p.locator('.is-sounding').first().waitFor();
  await p.waitForTimeout(2000);
  await p.screenshot({ path:`${output}/ink-playing.png` });
  await p.getByRole('button',{ name:'停止',exact:true }).click();
  await p.waitForTimeout(1400);
  await p.screenshot({ path:`${output}/ink-stopped.png` });
  assert.deepEqual(errors,[]);
  await p.waitForTimeout(Math.max(0, 12500 - (Date.now() - started)));
  const video = p.video(); await c.close(); await video.saveAs(`${output}/ink-desktop.webm`); await video.delete();
  for (const [name,options] of [['mobile',{ viewport:{ width:390,height:844 },isMobile:true,hasTouch:true }],['reduced',{ viewport:{ width:1280,height:800 },reducedMotion:'reduce' }],['narrow',{ viewport:{ width:800,height:800 } }]]) {
    const context = await browser.newContext(options); const page = await context.newPage();
    await page.goto(origin); await page.waitForTimeout(4400);
    await page.waitForFunction(() => performance.getEntriesByType('resource').some(r => r.name.endsWith('/site-fx.js')));
    assert.equal(await page.locator('.px-ink-field').count(),0);
    await page.screenshot({ path:`${output}/ink-${name}-no-canvas.png` });
    report[name] = { canvas:0 }; await context.close();
  }
  writeFileSync(`${output}/ink-browser.json`,JSON.stringify(report,null,2));
  console.log(report);
} finally { await browser.close(); }
