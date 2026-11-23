import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';

const origin = process.env.FX_ORIGIN || 'http://127.0.0.1:8090/';
const output = process.env.FX_OUTPUT || '/tmp/puxian-site-fx';
mkdirSync(output, { recursive:true });
const browser = await chromium.launch({ headless:true });
const report = {};
try {
  for (const [name, width, height] of [['desktop',1280,800], ['mobile',390,844]]) {
    const context = await browser.newContext({ viewport:{ width,height }, recordVideo:{ dir:output, size:{ width,height } } });
    const page = await context.newPage();
    const requests = [], errors = [];
    page.on('requestfinished', r => requests.push(new URL(r.url()).pathname));
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      if (!document.startViewTransition) return;
      const start = document.startViewTransition.bind(document);
      document.startViewTransition = update => {
        const transition = start(update);
        transition.ready.then(() => { document.documentElement.dataset.pxTransitionReady = 'yes'; });
        return transition;
      };
    });
    await page.goto(origin);
    await page.locator('.px-overture').waitFor({ state:'attached' });
    const opening = await page.evaluate(() => document.getAnimations().filter(a => a.effect?.target.closest?.('.px-overture,#home-title')).map(a => ({ time:a.currentTime, delay:a.effect.getTiming().delay })));
    assert.ok(opening.length > 40, 'overture is animating immediately after the first render');
    assert.ok(opening.some(a => a.delay === 0 && a.time < 500));
    await page.waitForTimeout(480);
    await page.screenshot({ path:`${output}/home-${name}-0.5s.png` });
    await page.waitForTimeout(650);
    await page.screenshot({ path:`${output}/home-${name}-1.2s.png` });
    await page.waitForTimeout(1000);
    await page.screenshot({ path:`${output}/home-${name}-end.png` });
    await page.waitForTimeout(600);
    assert.equal(requests.length, 8);
    assert.ok(!requests.some(p => p.endsWith('/site-fx.js')));
    const bytes = requests.reduce((sum,p) => sum + statSync('dist-static'+(p==='/'?'/index.html':p)).size, 0);
    assert.ok(bytes <= 391586, `${bytes} exceeds first screen budget`);
    report[name] = { requests:requests.length, bytes, immediateAnimations:opening.length };
    await page.waitForFunction(() => performance.getEntriesByType('resource').some(r=>r.name.endsWith('/site-fx.js')));
    await page.getByRole('button', { name:'打开小星星', exact:true }).scrollIntoViewIfNeeded();
    await page.getByRole('button', { name:'打开小星星', exact:true }).evaluate(el => el.click());
    await page.waitForFunction(() => document.documentElement.dataset.pxTransitionReady === 'yes');
    await page.waitForTimeout(220);
    if(name==='desktop') await page.screenshot({ path:`${output}/card-expansion-mid.png` });
    const play = page.getByRole('button', { name:'播放', exact:true });
    await play.waitFor();
    await play.click();
    await page.locator('.px-halo').first().waitFor();
    if(name==='desktop') {
      await page.screenshot({ path:`${output}/playback-sweep.png` });
      const keys = page.getByRole('button', { name:'琴键 展开', exact:true });
      await keys.click();
      await page.waitForFunction(() => document.querySelector('[data-visual-keyboard] [data-active="true"]'));
      await page.screenshot({ path:`${output}/keyboard-ripple.png` });
      const identities = [];
      for (let i=0;i<5;i++) {
        identities.push(await page.locator('.is-sounding').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-id') || n.outerHTML.slice(0,180))));
        await page.waitForTimeout(400);
      }
      assert.ok(new Set(identities.map(JSON.stringify)).size > 1);
      report.playback = identities;
    }
    await page.waitForTimeout(name==='desktop'?0:3200);
    assert.deepEqual(errors, []);
    const video = page.video();
    await context.close();
    await video.saveAs(`${output}/${name}-opening-editor-playback.webm`);
    await video.delete();
  }
  const context = await browser.newContext({ reducedMotion:'reduce' });
  const page = await context.newPage();
  await page.goto(origin);
  await page.locator('.px-overture').waitFor();
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
  await page.getByRole('button', { name:'打开小星星', exact:true }).click();
  await page.getByRole('button', { name:'播放', exact:true }).click();
  await page.waitForTimeout(4500);
  assert.equal(await page.locator('.px-halo,.px-ripple').count(), 0);
  assert.equal(await page.evaluate(() => document.getAnimations().filter(a=>a.effect?.getKeyframes().some(f=>f.transform && f.transform!=='none')).length), 0);
  await context.close();
  for (const type of [chromium,firefox]) {
    const fallbackBrowser = await type.launch();
    const fallback = await fallbackBrowser.newPage();
    await fallback.addInitScript(() => { document.startViewTransition = undefined; });
    await fallback.goto(origin);
    await fallback.getByRole('button', { name:'打开小星星', exact:true }).click();
    await fallback.getByRole('button', { name:'播放', exact:true }).waitFor();
    report[`${type.name()}Fallback`] = true;
    await fallbackBrowser.close();
  }
  writeFileSync(`${output}/site-fx-browser.json`, JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
} finally { await browser.close(); }
