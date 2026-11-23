# 简谱 SVG 视图（Step A）

奶油纸谱面中的「简谱 / 五线」按钮切换视图，默认保持原五线。
五线继续由 `engraveAbc(score, instrumentShift)` 与 abcjs 渲染。
简谱由 `scoreToJianpu` → JianpuRender SVG 渲染，按需加载。
不改 Score、undo、draft、MusicXML、MIDI、听写、改编和播放音源。

## 两库实测与选择

使用 `src/lib/music/examples.ts` 的完整小星星（C、4/4、88 BPM）测试 npm 发布包，
而非仅查看参考仓库 README。两库均在 jsdom（补 SVG 测量与 SMIL 空实现）实际生成 SVG：

| 候选                                | 实测结果                                                                                   | Score 接入成本                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| jianpurender **1.8.1** / Apache-2.0 | 2 个 SVG（主图 + 固定调拍号浮层）、48 个节拍 block，文本以 `1=C4/4♩=881155665…` 开始       | MIDI pitch、start/length 与 Score 四分音符单位相同；和弦输入可建模，但原生 SVG 会重叠；支持歌词、点击、高亮；声部分实例渲染 |
| simple-notation **1.0.27** / MIT    | `new SimpleNotation(host).loadData(...)` 生成 1 个 SVG，含小星星标题、调拍号和完整旋律数字 | 输入为 `1,1,5,5\|6,6,5,-…` 的另一套文本谱语法；独立声部、任意时值、和弦还需额外编码与索引映射                               |

**选择仅安装 `jianpurender: "1.8.1"`**，版本与完整依赖图锁定在 package-lock.json。
simple-notation 通过 `npm pack simple-notation@1.0.27 --pack-destination /tmp/...` 解包测试，
未加入 package.json。未声称其不支持双声部；本阶段优先复用 Score 的时间模型，减少文本转译。

JianpuRender 发布包有实际兼容问题，已验证并处理：

1. `module` 指向 UMD，而非真正 ESM。明确导入 `jianpurender/node/index.js` 的默认 CommonJS 导出，
   只从主入口导入类型。该 UMD 使用 `global`，Vite 使用 `define: { global: "globalThis" }` 映射，
   不在运行时修改浏览器全局对象。
2. 原生只从音符之间的空隙推导休止，无法表达尾部或全休止谱的长度。
   适配层为休止生成 intensity=0 的内部占位，扩展公开 `JianpuModel.update`，
   在每次模型计算后移除这些占位的 block.notes，再让原库画真正的 `0`。
   保留 block 的时值和位置；不把休止当成发声音。覆盖首部、中间、尾部、全休止与空声部测试。
3. `voice2` 是独立时间线。每声部单独 SVG，使用相同每拍像素尺度，各自横向滚动，
   不强行按 note index 对齐、不补写 Score 尾部休止。空的第二声部保留声部标题。

## 点击与播放

- 用独立声部的 `{voice, index, start, end, pitches}` 命中表，将 SVG `data-id=start-pitch`
  还原为现有编辑器的 voice + note index。跨拍拆分的延音也回到同一原始音符。
- 数字点击接现有 `pickRef`，保留 Shift 连选与跨声部选择规则。
  采用事件代理保留 MouseEvent.shiftKey；休止符和小节线暂不支持点击选中。
- 接现有 playback-clock 产出的 `sounding: FollowSlot[]`，同时着色两个声部各自正在发声的可见音。
  播放停止、休止与空 slots 会清除颜色；选中音有阴影提示。
  使用 SVG 分段索引着色，避免库 `redraw(activeNote)` 一次只能保留一个活跃音的限制。
- 不另开 simple-notation/SNPlayer 等音源。暂不自动跟随滚动，也不在切换时改变播放位置。

## 能力边界

- 屏幕编辑简谱仍为横排长卷；打印/图片使用独立 `jianpu-print.ts` 按纸宽换行与完整系统分页。
- 1.8.1 的同一 block 多音会绘在同一坐标，实测和弦数字互相覆盖。因此简谱明确降级为
  **屏幕编辑视图仅显示和弦最高音**，界面在含和弦时提示；转换层保留全和弦与原始索引，公开 block 模型
  选最高音绘制。完整和弦的存储、播放、五线谱和导出不变。
- 保留基本时值、休止、歌词文本、调号与拍号。表情、装饰音、歌词延音线、超音域标记
  暂仍以五线视图为准；小调按主音对应的大调级数加变化音呈现，八度点基准采用库默认，
  不承诺与文本简谱的 `tonicOctave` 或拼写选择完全相同。
- 打印与导出面板可选简谱/五线谱，默认跟随编辑视图；手选不切换编辑器。简谱打印/PDF/PNG/SVG 含标题、记谱调、拍号、速度、对齐的第 1 段歌词与完整纵向和弦；多页图片合成一个文件。纸张、页边、大小与系统不拆页规则复用打印布局。五线屏幕备份保留，五线图片仍用原管线。
- 简谱打印采用独立 SVG 排版，八度与小调级数使用现有 theory 转换；不绘表情、装饰音、歌词延音线和音域颜色。非标准时值显式附注四分音符拍数。详见 [打印说明](print.md)。
- 本 PR 不包含 B/C/D/E、Capacitor 或壳，也不合并。

## 验证记录

- 新增 `jianpu-render.test.ts`：4 项通过；转换/不改 Score、和弦/歌词/移调、休止、
  独立 voice2、跨拍命中、真实 jsdom SVG、和弦最高音降级、播放高亮与清除、销毁。
- 真实 Chrome：Vite 单独生产打包适配层（约 45.4 kB / gzip 11.9 kB，非整站增量测量），
  完整小星星 + 和弦第二声部生成 4 个 SVG；点击回到 voice=0/index=0；高亮为预期颜色；
  destroy 后 SVG 数为 0。
- 真实应用 Chrome 冒烟：点击「简谱」生成 2 个 SVG，原五线隐藏，点击「五线」恢复，
  新增第二声部后生成 4 个 SVG；实际点击播放出现 clock 高亮，停止后清除；
  和弦输入显示最高音提示并可选中最高音。无 pageerror。
  首次浏览器测试发现 UMD 的 global 缺失，修复后通过。
- `npm test`：脚本测试 128 通过、4 跳过；音乐等测试 308 通过、1 失败。
  唯一失败为既有 `voices.test.ts` 的 MusicXML schema 校验，环境没有 `xmllint`，
  spawnSync 状态为 null；与本次适配无关。
- `npx tsc --noEmit`、`npm run build`、`git diff --check`：通过。
  build 的数据库迁移因未配置 DATABASE_URL 按原脚本跳过。
