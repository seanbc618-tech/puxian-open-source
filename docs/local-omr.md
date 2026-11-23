# 本机印刷体五线谱识谱第一刀

印刷体西方五线谱，优先端正清晰的钢琴双谱表。图片只通过 ImageBitmap 传入本机 Worker，无图片上传接口、云端推理或遥测。输出先作为独立草稿预览，只有点击「确认替换当前乐谱」才调用编辑器 publish，可撤销；刷新后的持久化不是本轮范围。

## 引擎和许可

- SMT: https://github.com/antoniorv6/smt ，MIT，Copyright (c) 2023 Antonio Ríos-Vila；开发时固定 `fdeb7c371e1614f57a041a2e77895f47ff22e619` 的 `smt_model/`。仅使用模型定义，不安装上游训练、合成、渲染工具链。新版 master 解码器不兼容已发布权重，禁止忽略 missing/unexpected keys 导出。
- 权重: https://huggingface.co/antoniorv6/smt-grandstaff ，模型卡标注 MIT；固定 revision `2eb5a45c29d63bdf063cd0427175f57675e7da9e`。约 21.4M 参数，原始 safetensors 85544056 B（以下载文件为准），不随 git 分发。
- ONNX Runtime Web `1.24.3`: https://github.com/microsoft/onnxruntime ，MIT，Copyright (c) Microsoft Corporation。浏览器使用 WASM CPU 后端，单线程，不需跨源隔离；`public/licenses/onnxruntime-MIT.txt` 和上游 ThirdPartyNotices 随站分发。ThirdPartyNotices 中 MPL 的 Secondary Licenses 定义不是本项目引入 GPL 代码的授权。
- kern → MusicXML 转换、系统切分和 Worker 协议为本仓库原创 MIT 实现，不使用 Humdrum 库、Verovio 或其它识谱项目胶水。转换许可见 `public/licenses/puxian-omr-MIT.txt`。
- Audiveris、SumisoraOMR、homr/homr-web 及其衍生一律不采用，也没有后续接入路径。

## 下载与复现

需要 Node/npm、Python 3.11、uv、curl、git。全部长命令有 timeout，开发环境下载与导出仅运行在开发者机器：

```sh
timeout 1200 bash scripts/omr/download-export.sh
timeout 30 node scripts/omr/fixture.mjs
timeout 180 npm test
timeout 120 npm run build:static
timeout 900 npm run verify:static
timeout 240 npm run test:omr
```

下载脚本检查原始权重和配置 SHA-256，导出时检查每个张量都匹配，然后核对提交的 `src/lib/omr/manifest.json`。ONNX 编码器 25,388,661 B，解码器 64,916,437 B，词表 375,582 B，总计 90,680,680 B（86.5 MiB），WASM 另约 11.8 MiB。文件在忽略的 `public/models/omr/`，构建时仅按可选静态资源复制，不进入 JS chunk；没有权重时构建仍成功，识别会中文报下载失败。原始上游下载可设 `OMR_UPSTREAM_BASE`（需提供相同校验和文件）。

产品默认从同域 `models/omr/` 下载，支持 `VITE_OMR_MODEL_BASE` 指定静态托管根 URL（以 `/` 结尾）。不要依赖用户能够访问 Hugging Face。运行时文件来自同一站点的构建资源，没有 CDN fallback。每个模型文件校验后才放入 CacheStorage，残缺下载不缓存；缓存可能被浏览器清理，届时须重新联网下载。此编辑会话内完成一次识别后，即使断网也可重新识别；刷新后离线打开整站不是此功能承诺。

`fixture.mjs` 用已有 abcjs 生成原创、公有领域练习图（C 大调，4/4，上下谱表各 C–D–E–F 全音符），不提交扫描谱或权重。可选浏览器集成测试有权重才执行，无权重明确跳过。音高/时值断言来自真实 Worker 返回并经过转换的结果；也覆盖一页两个系统的真实切分推理与 8 小节顺序拼接，以及 pdf.js 渲染页的实际识别、图片与 PDF 混合列表逐页串行识别、确认与撤销。PDF 夹具由同一份原创谱图在本机生成。额外幻觉声部仍须人工复核。测速读取 `/proc/uptime`。

## 已知限制

整页先用横向像素投影找到五线谱，成对分组为钢琴系统，逐系统串行识别，再拼成 MusicXML 小节，走现有导入器。当前作者发布列表以单系统 GrandStaff / camera 为主，没有稳定同名 smt-fp 可直接复用；选择 GrandStaff 匹配印刷谱，不使用面向照片的 camera 权重。未来全页模型需独立验证。

手写谱、简谱、斜拍或弯曲的谱页、复杂总谱、非成对谱表、过长系统、装饰音和部分复杂 kern 操作会失败。严格转换接口仍拒绝不支持的结构和无法对齐的节奏；识谱预览显式启用恢复模式，节奏冲突的音符顺延到本声部前音结束处并提示必须校对，结构错误仅保留可转换前缀；力度、装饰和版式未完整保留。模型可能错读拍号、漏音、增加音符、漏掉声部拆分标记；没有经过校准的逐音置信度，界面明确提示，不伪造百分数。

已接入多图与多页 PDF 对照：多选、追加的原始图片和 pdf.js（Apache-2.0，见 third-party.md）在本机渲染的 PNG 页图，统一保存为 `pages: File[]`，由当前页索引 `currentPage` 驱动「识别此页」。所有页均显示主按钮「识别全部页并合并预览」，按对照页序串行处理。翻页、追加或删除导致页列表/索引变化时，取消进行中的任务并丢弃旧预览；空闲 Worker 保留以复用已加载模型，已验证断网翻页后仍可识别。关闭对照面板会释放 Worker。预览明确显示合并页数；只有点「确认写入主谱（替换当前乐谱，可撤销）」才通过 publish 写入主编辑器，单次撤销恢复导入前的谱。确认后提供「去主谱改音符 / 途中转调」和「去移调与乐器（整首移调）」入口，继续复用现有 transposeScore / KeyMarkBar。转换时省略重复的调号和拍号声明，保留真正的页间变化，避免重复声明重置用户的途中转调。失败不再丢掉已有结果：Worker 每个系统结束即返回谱符，单个系统失败或截断也交付已生成前缀并继续后续系统；某页失败后继续下一页。部分草稿显示已恢复页号、系统数、逐页结果和精确到页／系统的错误，未识别区域不计入草稿，仍须明确确认后替换主谱并可撤销。未完成的原始 kern 谱符可展开查看，取消后也可恢复已生成的可转换前缀。仅检测到奇数谱表时保留成对系统，明确报告未配对区域；无法定位时报告候选线／完整谱表数量，不将合格五线谱和不支持的简谱混为一谈。


图片 / PDF 对照卡片右下角支持 Pointer Events 拖动调整宽高（含触屏），聚焦手柄后方向键每次调整 20 px；宽度受当前容器约束，图片区域独立滚动，放大与翻页仍可用。尺寸只记在当前面板会话，翻页沿用；关闭面板后重置，无新增动画库或首屏依赖。

`verify:static` 新增确定性 Worker 边界夹具，覆盖两张图片与两页 PDF 的串行识别、合并预览不改原谱、确认写入主谱、所有声部整首移调、途中转调、撤销，以及卡片拖拽与键盘缩放。它验证交互和转换，不代表模型准确率；`test:omr` 另用本机真实权重验证图片 + PDF 识别合并，确认后在主谱通过既有 UI 移调并核对每个声部。简单大谱表仍可能读错谱号和产生多余声部，必须人工校对。本轮无新增外部代码或依赖，沿用上述既有许可。


