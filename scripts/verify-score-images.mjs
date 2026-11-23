import { verifyImportMerge } from "./verify-import-merge.mjs";
import assert from "node:assert/strict";
import { join } from "node:path";

export function makePdf(count = 2) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${count} /Kids [${Array.from({ length: count }, (_, i) => `${i * 2 + 3} 0 R`).join(" ")}] >>`,
  ];
  for (let i = 0; i < count; i++) {
    const stream = `0 0 0 RG 2 w 20 ${40 + i * 10} m 260 ${40 + i * 10} l S`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << >> /Contents ${i * 2 + 4} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  }
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(pdf);
}
export async function verifyScoreImages(page, title, artifacts) {
  const picker = page.getByLabel("上传谱子图片文件", { exact: true });
  assert.equal(
    await page.getByRole("button", { name: "识别图片", exact: true }).isVisible(),
    true,
  );
  const accept = ".png,.jpg,.jpeg,.webp,.pdf,application/pdf";
  assert.equal(await picker.getAttribute("accept"), accept);
  assert.notEqual(await picker.getAttribute("multiple"), null);
  const imageData = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 320;
    const context = canvas.getContext("2d");
    context.fillStyle = "#fffdf7";
    context.fillRect(0, 0, 800, 320);
    context.fillStyle = "#222";
    context.font = "28px serif";
    context.fillText("Local reference", 40, 50);
    for (let i = 0; i < 5; i++) {
      context.beginPath();
      context.moveTo(40, 100 + i * 20);
      context.lineTo(760, 100 + i * 20);
      context.stroke();
    }
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const png = (name) => ({ name, mimeType: "image/png", buffer: Buffer.from(imageData, "base64") });
  await picker.setInputFiles([png("Z.png"), png("A.png")]);
  await title.waitFor();
  assert.equal(
    await page.getByRole("button", { name: "识别图片", exact: true }).isVisible(),
    true,
  );
  const panel = page.getByRole("complementary", { name: "谱子图片对照" });
  const count = (x, y) => panel.getByText(`第 ${x} 页 / 共 ${y} 页`, { exact: true }).waitFor();
  await count(1, 2);
  await panel
    .getByText(
      "支持本机识别印刷体西方五线谱，优先钢琴大谱表；识别会有错，需校对，确认前不会覆盖当前乐谱。",
      { exact: true },
    )
    .waitFor();
  assert.equal(await picker.getAttribute("accept"), accept);
  assert.notEqual(await picker.getAttribute("multiple"), null);
  await panel.getByRole("button", { name: "识别此页", exact: true }).waitFor();
  await panel.getByRole("button", { name: "识别全部页并合并预览", exact: true }).waitFor();
  await panel.getByText(/首次需联网下载约 86.5 MB 模型和推理运行时/).waitFor();
  const oldTitle = await title.inputValue();
  assert.equal(await panel.getByRole("img").getAttribute("alt"), "谱子图片：Z.png");
  await panel.getByRole("button", { name: "下一页", exact: true }).click();
  await count(2, 2);
  assert.equal(await panel.getByRole("img").getAttribute("alt"), "谱子图片：A.png");
  await panel.getByRole("button", { name: "放大谱面", exact: true }).click();
  assert.equal(await panel.getByRole("img").evaluate((img) => img.style.width), "180%");
  await panel.getByRole("button", { name: "适合宽度", exact: true }).click();
  assert.equal(await panel.getByRole("img").evaluate((img) => img.style.width), "100%");
  const card = panel.locator(".score-image-card");
  const handle = panel.getByRole("button", { name: "调整图片卡片大小", exact: true });
  const before = await card.boundingBox();
  await handle.scrollIntoViewIfNeeded();
  const grip = await handle.boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 - 100, grip.y + grip.height / 2 + 80, {
    steps: 12,
  });
  await page.mouse.up();
  const after = await card.boundingBox();
  assert.ok(
    after.width < before.width - 80 && after.height > before.height + 60,
    "pointer resizes both dimensions",
  );
  await handle.focus();
  await page.keyboard.press("ArrowDown");
  assert.equal(Math.round((await card.boundingBox()).height), Math.round(after.height + 20));
  await panel.getByRole("button", { name: "上一页", exact: true }).click();
  assert.equal(
    Math.round((await card.boundingBox()).height),
    Math.round(after.height + 20),
    "size survives page switch",
  );
  await panel.getByRole("button", { name: "下一页", exact: true }).click();
  await card.screenshot({ path: join(artifacts, "score-card-resized.png") });
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  const narrow = await card.boundingBox();
  await handle.focus();
  await page.keyboard.press("ArrowLeft");
  assert.equal(
    Math.round((await card.boundingBox()).width),
    Math.round(narrow.width - 20),
    "resize uses the visible width on phones",
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    "resized card fits 390px",
  );
  await card.screenshot({ path: join(artifacts, "score-card-resized-mobile.png") });
  await page.setViewportSize(viewport);

  await panel.screenshot({ path: join(artifacts, "score-images-multiple.png") });
  await panel.focus();
  await page.keyboard.press("ArrowLeft");
  await count(1, 2);
  await picker.setInputFiles(png("追加.png"));
  await count(1, 3);
  await panel.getByRole("button", { name: "删除当前页", exact: true }).click();
  await count(1, 2);
  assert.equal(await panel.getByRole("img").getAttribute("alt"), "谱子图片：A.png");
  await panel.screenshot({ path: join(artifacts, "score-images-append-delete.png") });
  await picker.setInputFiles({
    name: "坏图.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("invalid"),
  });
  await panel.getByText(/坏图.jpg：图片无法打开/).waitFor();
  await count(1, 2);
  await picker.setInputFiles({ name: "两页.pdf", mimeType: "application/pdf", buffer: makePdf() });
  await count(1, 4);
  await panel.getByRole("button", { name: "3", exact: true }).click();
  await count(3, 4);
  assert.match(await panel.getByRole("img").getAttribute("alt"), /两页.pdf · 第 1 页/);
  await panel.getByRole("button", { name: "下一页", exact: true }).click();
  await count(4, 4);
  assert.match(await panel.getByRole("img").getAttribute("alt"), /两页.pdf · 第 2 页/);
  await panel.screenshot({ path: join(artifacts, "score-pdf-next.png") });
  await picker.setInputFiles({
    name: "超大.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(20 * 1024 * 1024 + 1),
  });
  await panel.getByText(/超大.png：超过 20 MB，未加入/).waitFor();
  await count(4, 4);
  await picker.setInputFiles({
    name: "超大.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.alloc(40 * 1024 * 1024 + 1),
  });
  await panel.getByText(/超大.pdf：超过 40 MB，未加入/).waitFor();
  await count(4, 4);
  await picker.setInputFiles({
    name: "长谱.pdf",
    mimeType: "application/pdf",
    buffer: makePdf(38),
  });
  await panel.getByText(/长谱.pdf：合计最多 40 页，第 37–38 页未加入/).waitFor();
  await count(4, 40);
  assert.equal(await title.inputValue(), oldTitle);
  await panel.getByRole("button", { name: "关闭图片", exact: true }).click();
  await picker.setInputFiles(png("删除.png"));
  await count(1, 1);
  await panel.getByRole("button", { name: "删除当前页", exact: true }).click();
  assert.equal(await panel.count(), 0);
  await verifyImportMerge(page, picker, png("谱子.png"), title, artifacts);
  return { imagePicker: picker, png: png("谱子.png") };
}
