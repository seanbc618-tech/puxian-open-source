# 开源许可红线


- **可评估拷贝／依赖：MIT、Apache-2.0、BSD、0BSD。** 商店优先 MIT／Apache。引入前确认具体版本、文件与传递依赖的许可，保留版权、许可证文本及适用的 NOTICE；Apache 修改文件注明修改，BSD 保留相应声明。0BSD 无保留声明义务，仍记录来源以便追溯。
- 每次引入记录上游 URL、commit／包版本、具体文件或包、作者版权、许可、修改说明及随包声明位置。代码、字体、音色、模型权重、图片和运行时分别审查；Dolce／原琴的 MIT 不覆盖所有第三方资源。参考仓只读，不整仓搬运。
- **GPL／AGPL 项目只学 UX 与功能规格，不拷代码、不链进商店包。** 包括 Audiveris（AGPL）、MuseScore、mattuylee/numerical-notation-editor，以及 djempu、OctoPus、SumisoraOMR 等。该限制是本项目的采用红线，不依赖进程拆分或网络接口规避。
- **禁止把 AGPL OMR 引擎嵌入 puxian**，不以 WASM、原生库、后台子进程或随包服务方式带入。本机 OMR 仅采用已核验 MIT 的 SMT 与 ONNX Runtime Web；禁止 Audiveris、SumisoraOMR、homr/homr-web 及衍生，不以 WASM 或接口绕过。
- jianpu-ly 为 Apache-2.0；LilyPond 是独立工具，不能据此当作 Apache 组件打包。专业 PDF 先规划用户本机工具链，服务部署与商店捆绑另审；不在本轮引入。
- 来源或许可不明、第三方声明不完整时，停止引入该项并记录缺口；不能用主仓库 LICENSE 推断所有文件均可用。

## 本轮引入记录（2026-11-10）

`fflate@0.8.2`，https://github.com/101arrowz/fflate ，MIT，Copyright (c) 2023 Arjun Barrett。使用 npm 包的浏览器 Inflate 实现，未修改上游，无运行时依赖；许可证随包放在 `public/third-party/fflate-LICENSE.txt`。用途为本机 `.mxl` 解包，详见 [第三方声明](third-party.md)。

## 2026-11-12：本机 OMR

SMT 与 smt-grandstaff 权重为 MIT，ONNX Runtime Web 1.24.3 为 MIT，kern 转换为原创 MIT。权重不随 git 分发，首次从可配置的同域静态目录下载并校验后缓存在浏览器，图片不上传。具体版权、固定版本、来源和分发边界见 [本机识谱说明](local-omr.md)，原文声明在 `public/licenses/smt-MIT.txt`、`onnxruntime-MIT.txt`、`onnxruntime-ThirdPartyNotices.txt`、`puxian-omr-MIT.txt`。
