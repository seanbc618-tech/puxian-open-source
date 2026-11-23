import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { pythonServerArgs } from './static-server.mjs';
import { chromium, firefox } from 'playwright';
const server = spawn('python3', pythonServerArgs(18765, '127.0.0.1', 'dist-static'), { stdio:'ignore' });
try {
  for (let i=0;i<100;i++) { try { if ((await fetch('http://127.0.0.1:18765')).ok) break; } catch {} await new Promise(r=>setTimeout(r,100)); }
  for (const engine of [chromium, firefox]) {
    const browser = await engine.launch({headless:true});
    try {
      const page = await browser.newPage({viewport:{width:1100,height:800}});
      const external = [], errors = [];
      await page.route('**/*', route => { if (!route.request().url().startsWith('http://127.0.0.1:18765') && !route.request().url().startsWith('data:')) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
      page.on('pageerror', e=>errors.push(String(e)));
      await page.goto('http://127.0.0.1:18765');
      await page.getByRole('button',{name:'新建空白谱',exact:true}).click();
      await page.getByRole('textbox',{name:'曲名',exact:true}).fill('Before GP5');
      await page.waitForTimeout(700);
      const before = await page.evaluate(()=>localStorage.getItem('puxian-score-v1'));
      const input = page.getByLabel('选择 Guitar Pro 5 文件');
      await input.setInputFiles('src/lib/music/fixtures/gp5/original-study.gp5');
      const preview = page.getByRole('region',{name:'GP5 导入预览'});
      await preview.waitFor();
      await preview.locator('svg').first().waitFor();
      assert.equal(await page.getByRole('textbox',{name:'曲名',exact:true}).inputValue(),'Before GP5');
      assert.equal(await page.evaluate(()=>localStorage.getItem('puxian-score-v1')), before);
      await page.getByRole('button',{name:'取消预览',exact:true}).click();
      assert.equal(await preview.count(),0);
      await input.setInputFiles('src/lib/music/fixtures/gp5/original-study.gp5');
      await page.getByRole('button',{name:'确认整谱导入 GP5',exact:true}).click();
      assert.equal(await page.getByRole('textbox',{name:'曲名',exact:true}).inputValue(),'Puxian original GP5 study');
      await page.getByRole('button',{name:/^撤销/}).click();
      assert.equal(await page.getByRole('textbox',{name:'曲名',exact:true}).inputValue(),'Before GP5');
      await input.setInputFiles({name:'broken.gp5',mimeType:'application/octet-stream',buffer:Buffer.from('bad')});
      await page.getByText('请选择 Guitar Pro 5（.gp5）文件。',{exact:true}).waitFor();
      assert.equal(await page.getByRole('textbox',{name:'曲名',exact:true}).inputValue(),'Before GP5');
      assert.deepEqual(external,[]); assert.deepEqual(errors,[]);
      console.log(`${engine.name()}: GP5 preview/cancel/confirm/undo/malformed/local-only passed`);
    } finally { await browser.close(); }
  }
} finally { server.kill(); }
