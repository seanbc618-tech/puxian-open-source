// Original public-domain exercise, generated locally with abcjs; no scanned score.
import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1100, height: 600 },
    deviceScaleFactor: 1,
  });
  await page.setContent(`<body style="margin:0;background:white"><div id="score"></div></body>`);
  await page.addScriptTag({ path: "node_modules/abcjs/dist/abcjs-basic-min.js" });
  await page.evaluate(() =>
    ABCJS.renderAbc(
      "score",
      `X:1\nM:4/4\nL:1/4\n%%score { RH | LH }\nK:C\nV:RH clef=treble\nC4 | D4 | E4 | F4 |]\nV:LH clef=bass\nC,4 | D,4 | E,4 | F,4 |]`,
      { staffwidth: 900, stretchlast: true, paddingtop: 15, paddingbottom: 15 },
    ),
  );
  await mkdir(".omr-dev", { recursive: true });
  await page.locator("svg").screenshot({ path: ".omr-dev/scale.png" });
  await page.evaluate(() => {
    const host = document.getElementById("score");
    const svg = host.querySelector("svg");
    host.style.cssText = "width:930px;height:auto;padding:0;position:static";
    svg.style.cssText = "display:block;position:static;width:930px;height:162px";
    const second = svg.cloneNode(true);
    second.style.marginTop = "40px";
    host.appendChild(second);
  });
  await page.locator("#score").screenshot({ path: ".omr-dev/two-systems.png" });
  await page.setContent(
    '<body style="margin:0;background:white"><div style="width:500px;height:300px"></div></body>',
  );
  await page.locator("div").screenshot({ path: ".omr-dev/blank.png" });
  const png = (await readFile(".omr-dev/scale.png")).toString("base64");
  await page.setContent(
    `<body style="margin:0"><img style="display:block;width:930px;height:162px" src="data:image/png;base64,${png}"></body>`,
  );
  await page.pdf({
    path: ".omr-dev/scale.pdf",
    width: "930px",
    height: "162px",
    printBackground: true,
    margin: { top: 0, bottom: 0, left: 0, right: 0 },
  });
} finally {
  await browser.close();
}
