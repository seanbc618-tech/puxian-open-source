# 第三方许可与归属

根目录 MIT 只覆盖本仓库原创代码，不授予第三方代码、字体、模型权重或示例谱任何额外权利。

## 简谱渲染组件（Step A）

- **JianpuRender / jianpurender 1.8.1**：Apache-2.0，Copyright 2025 flufy3d. All rights reserved.
  [上游](https://github.com/flufy3d/JianpuRender)；[完整许可](../public/third-party/jianpurender-LICENSE.txt)。
  npm 发布包包含 LICENSE，未包含单独 NOTICE；保留完整版权和许可文本。没有修改或复制上游实现源码。
- **path-browserify 1.0.1**：JianpuRender 的间接依赖，MIT，Copyright (c) 2013 James Halliday。
  [完整许可](../public/third-party/path-browserify-LICENSE.txt)。

上述文本随网站静态资源一起分发，可通过 `/third-party/jianpurender-LICENSE.txt` 与
`/third-party/path-browserify-LICENSE.txt` 访问。适配层和界面为本仓库新增实现。

simple-notation 1.0.27（MIT，Encaik）仅在临时目录下载发布包作对比，未安装到项目、未分发其代码。
Step A 没有引入 GPL、Dolce 或原琴源码。

## MIDI 量化（Step C）

参考并改编 [StarryCosmosPiano/genshin-jianpu-editor](https://github.com/StarryCosmosPiano/genshin-jianpu-editor)
快照 `c92ab225991a84ff6685ff44ce6826f8cea21142` 的 `src/midi/importer.ts`
`markTriplets` / `classifyDuration`（局部三连音与普通网格优先原则）、
`inferHands` / `splitHands`（轨名与音域分配思路）。
谱线重写于 `src/lib/music/midi-quantize.ts`、`midi.ts`，没有复制上游数据模型；
`gestures.ts`、`types.ts` 仅作只读接口参考。
MIT：Original work Copyright (c) 2026 lodebar2026；
Modifications Copyright (c) 2026 StarryCosmosPiano。
[完整上游声明](../public/third-party/genshin-jianpu-editor-LICENSE.txt)随网站分发。
只采用 MIDI 算法思路，没有引入 Bravura、字体、模型、Dolce 或 GPL/AGPL 代码。

## jianpu-ly 文本互通（Step D）

[jianpu-ly](https://github.com/ssb22/jianpu-ly)，作者 **Silas S. Brown**，许可 **Apache-2.0**。
参考只读快照 `b3c2bbb` 的 README 与语法实现，独立编写 Score → `.jly` 适配器；没有复制或分发 `jianpu-ly.py`，不强制安装 Python 包。用户在本机通过 pipx／pip 或上游安装，许可随上游发行。
LilyPond 是独立的本机工具，其许可不属于 jianpu-ly 的 Apache-2.0；没有引入 GPL 源码、npm 依赖或将 LilyPond 打入前端／商店包。本版本只下载 `.jly`，不提供在线 PDF。

## JP-Word 导入（Step E）

[Dolce](https://github.com/lodebar2026/dolce)，快照 `6b1d3fc`，MIT，Copyright (c) 2026 lodebar2026。
只参考 `docs/格式/jpwabc.md`、`src/jpword/lex.ts`、`src/jpword/jpwfile.ts` 的段结构、编码、时值和歌词对齐规格，
`src/convert/jpwabc.ts` 仅核对接口；独立实现 `src/lib/music/jpwabc-import.ts`，未复制上游函数。
Step E2 另参考 `docs/格式/123格式.md`、`docs/实现/文本谱.md`、`docs/模块/源格式-文本谱.md`、`src/fanqie/dialect.ts`、`src/editor/formats.ts` 的语法与注册表规格，独立实现 `jpwabc-export.ts`、`j123-import.ts`、`fanqie-import.ts`、`text-score-util.ts`、`text-formats.ts`；未复制上游函数或测试数据。
测试夹具摘取规格中的短 token 并合成为新旋律，见夹具 README。
[完整许可](../public/third-party/dolce-LICENSE.txt)随网站分发，其中字体例外声明一并保留；没有引入对应字体资源、模型或 GPL 代码。

## Capacitor iOS 壳（里程碑 B）

只加了 iOS 壳，没有 Android，也没有 Filesystem、Share、Preferences 或其他插件。

- **@capacitor/core 8.6.0**、**@capacitor/ios 8.6.0**：MIT，Copyright (c) 2017-present Drifty Co.
  [上游](https://github.com/ionic-team/capacitor)；[完整许可](../public/third-party/capacitor-LICENSE.txt)。
  core 与 ios 的 npm 包使用同一份 MIT 文本。记谱页面没有 `import` 这些包；原生运行时由 Xcode 通过 Swift Package 拉取。
- **@capacitor/cli 8.6.0**：MIT，同一份许可。只在开发机上执行 `cap sync` / `cap open`，不是 App 目标里的产品代码。
- **capacitor-swift-pm 8.6.0**：`ios/App/CapApp-SPM/Package.swift` 钉死 `https://github.com/ionic-team/capacitor-swift-pm.git` 的 exact 8.6.0，与上述 npm 包同一上游、同一 MIT。本仓库没有把 Swift 源码再复制一份。Mac 上由 Xcode 解析，这次没有在 Linux 上编译。

没有把 LilyPond、GPL 或 AGPL 运行时放进 `ios/` 或 `dist-static/`。静态包原有的第三方文本仍从 `public/third-party/` 进入 `dist-static/third-party/`。

## fflate — 压缩 MusicXML 导入

- 来源：https://github.com/101arrowz/fflate ，npm `fflate@0.8.2`（精确锁定）。
- 作者与版权：Copyright (c) 2023 Arjun Barrett；MIT。
- 使用包内 `Inflate`，只在浏览器本机解压经过目录限额检查的 container 与 rootfile；未修改上游代码，无运行时传递依赖。
- 随包许可证：[`public/third-party/fflate-LICENSE.txt`](../public/third-party/fflate-LICENSE.txt)。未引入 GPL/AGPL 依赖。

## Guitar Pro 5 import

GP5 import uses unmodified `@coderline/alphatab` **1.8.3**, licensed under MPL-2.0.
Copyright © 2026, Daniel Kuschny and Contributors, All rights reserved.

Source for this release: https://github.com/CoderLine/alphaTab/tree/v1.8.3
Package: https://registry.npmjs.org/@coderline/alphatab/-/alphatab-1.8.3.tgz

The distributed app includes the MPL and integrated-library notices in
[MPL-2.0](../public/licenses/alphatab-MPL-2.0.txt) and
[integrated-library notices](../public/licenses/alphatab-integrated.txt).
No alphaTab source files are modified. Any future modifications to covered files
must retain their copyright headers, remain MPL-2.0 and be made available in source.
The importer does not load fonts, soundfonts, remote scores or alphaTab playback.
Integrated code notices list MIT and BSD-3-Clause components; no GPL/AGPL dependency is added.

### PDF.js / pdfjs-dist 5.4.624

- 来源：https://github.com/mozilla/pdf.js
- 许可：Apache-2.0（含分发包内各资源许可声明）。许可全文随本站 `licenses/pdfjs-LICENSE` 分发。
- 用途：仅在用户选择 PDF 后，在本机按页渲染为对照图片；不做 OMR，不上传文件。解析模块懒加载，worker、CMap、字体、WASM 和色彩资源均由本站提供，不使用 CDN。

## Outfit 与 Newsreader 字体

- **@fontsource/outfit 5.3.0**，SIL Open Font License 1.1（`OFL-1.1`），Copyright 2021 The Outfit Project Authors。[随站分发的许可和版权声明](../public/licenses/outfit-OFL-1.1.txt)
- **@fontsource/newsreader 5.3.0**，SIL Open Font License 1.1（`OFL-1.1`），Copyright 2020 The Newsreader Project Authors。[随站分发的许可和版权声明](../public/licenses/newsreader-OFL-1.1.txt)

以上声明来自锁定版本的 npm 发布包。再分发字体时须随附对应的字体版权声明和 OFL 文本。

## 示例谱

[示例谱来源](pd-examples.md) 列出底本、转录版本及对应条款。作品本身进入公有领域后，其现代转录或编配仍可能有独立许可。对应 CC BY／CC BY-SA 示例谱沿用文件原许可。再分发时保留版权、署名、来源及许可，按适用许可标明修改，CC BY-SA 改编按适用的相同方式共享条款分发。

## 音频听写与印刷谱识别

- **Spotify Basic Pitch**（`@spotify/basic-pitch@1.0.1`），Copyright 2022 Spotify AB，Apache-2.0。仓库随源代码分发原样复制的 TF.js 模型及权重。推理和音符解码代码有本仓库改编，文件头注明来源和修改。TensorFlow.js 4.22.0 采用 Apache-2.0。[完整声明与模型校验和](../public/third-party/basic-pitch-LICENSE.txt)
- **SMT 与 SMT GrandStaff**。下载和导出脚本使用固定版本的 SMT 模型定义，MIT，Copyright (c) 2023 Antonio Ríos-Vila。固定版本的 GrandStaff 权重由上游模型卡标注 MIT。原始及导出的权重均不随 Git 分发。准备权重后，可由构建复制到站点资源，或另行静态托管，分发时保留适用的上游许可和归属。[SMT MIT](../public/licenses/smt-MIT.txt) · [版本与转换说明](local-omr.md)
- **ONNX Runtime Web 1.24.3**，MIT，Copyright (c) Microsoft Corporation。浏览器使用其 WASM CPU 后端。部署包保留 [MIT 许可](../public/licenses/onnxruntime-MIT.txt)和[上游集成组件声明](../public/licenses/onnxruntime-ThirdPartyNotices.txt)。
- **谱线 OMR 转换**。谱表系统切分、Worker 协议及 kern 到 MusicXML 的转换属于本仓库原创 MIT 实现。[转换代码许可](../public/licenses/puxian-omr-MIT.txt)
