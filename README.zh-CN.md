# 谱线（Puxian）

[English](README.md)

这是清理后的开源发行快照，从全新的 Git 历史开始。正式站为 [818189.xyz](https://818189.xyz/)。本发行包以纯文字安装指南替代原有品牌素材，以自编练习替换两首短例曲，并省去内部开发材料。

谱线是一款在浏览器里记谱和练习的工具。可以用来写一段短旋律、给移调乐器准备分谱，或把哼唱整理成可编辑的草稿。草稿默认保存在当前浏览器，不会跨设备同步。清除浏览器数据或换设备之前，可以导出要保留的内容。

## 功能

- 用简谱、音名或屏幕键盘输入音符。可查看五线谱和简谱，并编辑和弦、声部、歌词和表情记号。
- 可移调整曲的实际音高，也可选择移调乐器，只改变记谱，保留实际音高。
- 可播放乐谱、循环练习片段或使用节拍器。可导出 PNG、SVG、MIDI 和 MusicXML，复制简谱，或在浏览器中打印和另存为 PDF。
- 支持导入 MusicXML（含压缩的 MXL）、MIDI 和 Guitar Pro 5（GP5）。不同格式的导入可能省略或简化部分内容。支持范围见 [GP5 导入](docs/gp5-import.md)。
- 可在浏览器里对短录音或音频文件进行听写。适合从清晰的独奏旋律开始，再核对草稿的音高、起点和时值。
- 配置可选模型后，可以在浏览器里识别图片或 PDF 页中的印刷体五线谱。图片和 PDF 页在本机处理。预览确认后才会替换当前乐谱。

## 本地运行

需要 Node.js 22（22.x 系列的 22.12 或以上版本）和 npm。

```sh
npm ci
npm run dev
```

打开 Vite 输出的本地网址。

## 可选识谱模型

印刷体五线谱识别使用 [SMT GrandStaff 模型](https://huggingface.co/antoniorv6/smt-grandstaff)，模型卡标注为 MIT。权重不随 Git 分发。安装 Python 3.11、uv、curl 和 git 后运行：

```sh
bash scripts/omr/download-export.sh
```

脚本校验固定版本的上游文件、导出 ONNX 资源，并与仓库中的清单核对。文件放在 Git 忽略的 `public/models/omr/` 目录。没有该目录也能构建。如果配置的托管位置也未提供权重，识谱会因模型加载失败而无法运行。版本、校验和、缓存及限制见[本机识谱](docs/local-omr.md)。

## 环境变量

以下是可选的 Vite 公开设置，可能随客户端构建公开。

```dotenv
VITE_AUTH_ENABLED=false
VITE_OMR_MODEL_BASE=/models/omr/
```

第一项关闭网页版可选的登录入口。第二项设置模型资源的根 URL，末尾须有斜杠。默认从同源路径加载模型。服务端 Grok OAuth 仅在同时配置 `GROK_AUTH_CLIENT_ID` 和 `GROK_AUTH_CLIENT_SECRET` 时启用。请勿在 `VITE_*` 变量中填入秘密，也不要提交本机 `.env` 文件。

## 测试

```sh
npm test
npm run build:static
npx playwright install chromium firefox
npm run verify:static
npm run test:omr
```

`npm test` 运行 Node 测试。静态验证需要 Python 3、Playwright 浏览器及当前操作系统所需的浏览器系统库，其中识谱流程使用模拟 Worker。`test:omr` 使用静态构建、Python 3、Playwright Chromium 和真实模型文件。真实模型检查需要权重和带有 `timeout`、`/proc/uptime` 的 Linux 环境。缺少权重时仍执行浏览器检查。详见[静态构建指南](docs/static-mobile-build.md)和[识谱测试说明](docs/local-omr.md)。

## 构建与打包

- `npm run build` 使用 Nitro 构建带服务端的网页版，并调用数据库迁移脚本。未配置数据库连接时跳过迁移。需要支持网页服务端运行时及其可选服务端功能的托管环境。
- `npm run build:static` 生成 `dist-static/`，可用于 HTTP 静态托管或 iOS 壳。构建无需数据库或迁移。静态包没有服务端 API、托管登录或服务端数据功能。本地检查可通过 HTTP 提供，线上托管使用 HTTPS。
- Capacitor 将静态构建包在 iOS 壳中。Xcode 设置和设备检查见 [iOS 验证说明](docs/capacitor-ios-verify.md)。部分真机检查仍待完成，尚未完成 App Store 分发。

## 已知限制

- 识谱和听写生成的是需要人工校对的草稿。请核对音高、起点、时值和整段结果。复杂节奏和伴奏会影响听写准确性。印刷谱识别适合端正、清晰的成对谱表。手写谱、简谱、变形照片和复杂总谱可能识别失败。识谱可能漏音、多音、错读拍号或声部，也可能丢失部分记号和版式。
- 正式站曾在部分 Mac Chrome 和高分屏环境中因加载特效出现 GPU 卡死。本快照包含缓解措施，仍待在受影响的真机上确认稳定性。

## 许可

谱线的原创代码采用 [MIT 许可](LICENSE)。第三方代码、字体、模型权重和示例谱沿用各自条款，包括采用 MPL-2.0 的 alphaTab 及其集成库声明、采用 SIL OFL 的字体，以及须保留署名的 CC BY 或 CC BY-SA 示例谱。见[第三方声明](docs/third-party.md)和[示例谱来源](docs/pd-examples.md)。
