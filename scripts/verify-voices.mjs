import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { pythonServerArgs } from './static-server.mjs';
import { chromium, firefox } from 'playwright';
const server = spawn('python3', pythonServerArgs(18766, '127.0.0.1', 'dist-static'),{stdio:'ignore'});
try {
  for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:18766')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  for (const engine of [chromium,firefox]) {
    const browser = await engine.launch({headless:true});
    try {
      const page = await browser.newPage({viewport:{width:1100,height:800}});
      const errors=[], external=[];
      page.on('pageerror',e=>errors.push(String(e)));
      await page.route('**/*',r=>{const url=r.request().url();if(!url.startsWith('http://127.0.0.1:18766')&&!url.startsWith('data:')&&!url.startsWith('blob:')){external.push(url);return r.abort();}return r.continue();});
      await page.goto('http://127.0.0.1:18766');
      await page.getByRole('button',{name:'新建空白谱',exact:true}).click();
      await page.locator('#jianpu').fill('1 2 3 4');
      await page.getByRole('button',{name:'加上第二声部',exact:true}).click();
      await page.locator('#jianpu').fill('5, - 6, -');
      await page.getByRole('button',{name:'加上第三声部',exact:true}).click();
      await page.locator('#jianpu').fill('3 4 5 6');
      await page.getByRole('button',{name:'加上第四声部',exact:true}).click();
      await page.locator('#jianpu').fill('1, - - -');
      await page.locator('#jianpu').blur();
      await page.waitForTimeout(800);
      const snapshot=await page.evaluate(()=>JSON.parse(localStorage.getItem('puxian-score-v1')).score);
      assert.equal(snapshot.extraVoices.length,2);
      await page.getByRole('radio',{name:'声部三',exact:true}).click();
      await page.locator('#jianpu').fill('7 6 5 4');
      await page.locator('#jianpu').blur();
      await page.waitForTimeout(800);
      const edited=await page.evaluate(()=>JSON.parse(localStorage.getItem('puxian-score-v1')).score);
      assert.deepEqual(edited.notes,snapshot.notes);assert.deepEqual(edited.voice2,snapshot.voice2);assert.deepEqual(edited.extraVoices[1],snapshot.extraVoices[1]);
      assert.notDeepEqual(edited.extraVoices[0],snapshot.extraVoices[0]);
      await page.getByRole('button',{name:/^撤销/}).click();
      await page.waitForTimeout(800);
      assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('puxian-score-v1')).score),snapshot);
      await page.getByRole('button',{name:'五线',exact:true}).click();
      await page.waitForFunction(()=>document.querySelectorAll('.staff-slot:not(.jianpu-staff-backup) .abcjs-note').length>=8);
      await page.getByRole('button',{name:'简谱',exact:true}).click();
      await page.waitForFunction(()=>document.querySelectorAll('.score-stage .jianpu-line').length>=4);
      await page.getByRole('radio',{name:'声部三',exact:true}).click();
      await page.getByRole('button',{name:'去掉声部三',exact:true}).click();
      await page.waitForTimeout(800);
      const removed=await page.evaluate(()=>JSON.parse(localStorage.getItem('puxian-score-v1')).score);
      assert.equal(removed.extraVoices.length,1);assert.deepEqual(removed.extraVoices[0],snapshot.extraVoices[1]);
      await page.getByRole('button',{name:/^撤销/}).click();
      await page.waitForTimeout(800);
      await page.reload();
      await page.getByRole('button',{name:'继续上次草稿',exact:true}).click();
      await page.getByRole('radio',{name:'声部四',exact:true}).waitFor();
      assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('puxian-score-v1')).score),snapshot);
      assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
      console.log(`${engine.name()}: four voices edit/isolation/undo/delete/restore/jianpu/staff passed`);
    }finally{await browser.close();}
  }
}finally{server.kill();}
