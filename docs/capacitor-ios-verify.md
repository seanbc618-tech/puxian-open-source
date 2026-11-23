# Capacitor iOS 最小验证

里程碑 B 的脚手架。把里程碑 A 的 `dist-static/` 放进 Capacitor iOS 壳，并写明 Mac 上还要亲自做的检查。

本文写于 Linux。这里没有 Xcode，不能签名，不能开 iOS 模拟器，也没有接 iPhone。下面凡是「已入库」的，都可以在仓库里核对。凡是「真机」的，这次都没有跑，不能打勾，也不能写成 TestFlight 或 App Store 已通过。

网页渠道仍是 `npm run build`（TanStack Start + Nitro，`preset: "vercel"`）。壳不读 `.output`、`.vercel`，也不把 `server.url` 指到开发服务器或预览页。

## 已入库

- `@capacitor/core` 与 `@capacitor/ios` **8.6.0**（依赖，MIT）。`@capacitor/cli` **8.6.0**（开发依赖，MIT）。没有 `@capacitor/android`，没有 Filesystem、Share、Preferences 或其他插件。
- `capacitor.config.ts`：`appId` 为 `tech.seanbc618.puxian`，`appName` 为「谱线」，`webDir` 为 `dist-static`，`server.iosScheme` 为 `capacitor`。没有 `server.url`。
- `npx cap add ios --packagemanager SPM` 生成了 `ios/`。`ios/App/CapApp-SPM/Package.swift` 把 `capacitor-swift-pm` 钉在 **8.6.0**。没有 Podfile。Swift 包要等 Mac 上的 Xcode 去解析，这次没有下载或编译它。
- `ios/App/App.xcodeproj/project.pbxproj` 里 `PRODUCT_BUNDLE_IDENTIFIER` 是 `tech.seanbc618.puxian`，`IPHONEOS_DEPLOYMENT_TARGET` 是 `15.0`。这是模板写下来的数字，不是在本机编译过的结果。
- `ios/App/App/Info.plist`：开发区域 `zh-Hans`；麦克风文案见下文；MusicXML、MIDI、`.jpwabc` 以 imported / Viewer / Alternate 登记。没有 `UIBackgroundModes`，没有相机、照片库、语音识别用途字符串。
- 静态入口 `static/main.tsx` 挂载 `HomeApp` 首页；选曲、新建或继续草稿后才加载 `StafflineApp`，不导入 `@capacitor/*`，不挂登录或 PreviewHostBridge。
- 壳内的前台中断只是网页层的一小段：协议为 `capacitor:` 且页面变为 `hidden` 时，停试听并中止尚未完成的哼唱。不是 `AVAudioSession`。网站页（http/https）不走这段。
- Linux 上跑过 `npm run build:static`、`npx cap sync ios`，以及 `node --test scripts/ios-shell.test.mjs`。`cap sync` 之后麦克风文案还在。

许可文本在 `public/third-party/capacitor-LICENSE.txt`，静态构建会抄进 `dist-static/third-party/`。说明见 [第三方](third-party.md)。

## 没有做

- 没有在 Mac、模拟器或 iPhone 上编译、安装、签名。
- 没有测麦克风允许／拒绝、20 秒哼唱、静音键、来电、耳机、后台和 Files。
- 没有把「用谱线打开」接到编辑器。文档类型只是登记，选择文件后不会自动导入。
- 没有分享或「存储到文件」的原生桥。导出仍是网页里的 Blob 和 `a.download`。
- 没有 IAP、iCloud、推送、后台音频。图标和启动页仍是 Capacitor 模板，不是奶油纸正式素材。
- 没有在 App Store Connect 建立 `tech.seanbc618.puxian` 这条记录。若这个 bundle id 已被占用，要同时改 `capacitor.config.ts` 和 Xcode 里的 bundle id，再 `npx cap sync ios`。不要为了改 id 删掉 `ios/` 后重来，除非准备再跑 `node scripts/apply-ios-plist.mjs`。
- `ios/debug.xcconfig` 里 `CAPACITOR_DEBUG = true` 是模板留给 Debug 构建的，不代表可以拿去送审。

Capacitor 8 的环境说明（2026-11-09 查阅）写的是 Xcode 26.0 或更新，iOS 15 起。打开工程前再看一遍 [环境](https://capacitorjs.com/docs/getting-started/environment-setup) 和 [iOS](https://capacitorjs.com/docs/ios)，不要只靠这里的数字。本机 Node 需满足 CLI 的 `>=22`。

## Mac 命令

在仓库根目录：

```bash
npm install
npm run build:static
npx cap sync ios
npx cap open ios
```

`npm install` 会装 CLI。`build:static` 只产出 `dist-static/`，不跑 `db:migrate`，不读数据库 URL。`cap sync ios` 把该目录拷到 `ios/App/App/public`（这个目录在 `ios/.gitignore` 里，不要提交）。然后用 Xcode 打开 `ios/App/App.xcodeproj`。`npx cap open ios` 就是这一步。

改完记谱前端之后，再执行一次 `npm run build:static` 和 `npx cap sync ios`，然后在 Xcode 里重新 Run。不要用 `file://` 打开 `dist-static`。不要把 `webDir` 改成 `.output` 或 `.vercel`。不要在 `capacitor.config.ts` 里加 `server.url`。

Xcode 里：

1. 打开后等 Swift Package 解析完 `capacitor-swift-pm` 8.6.0。解析失败就停，不要改用一套来源不明的二进制。
2. Scheme 选 App。签名选自己的 Apple Development 团队，自动签名即可。不要勾选 Background Modes、iCloud、Push、In-App Purchase。
3. 目标选一台真机。模拟器没有可靠的麦克风、静音键和「文件」App 行为，不能代替下面的出口。
4. Run。确认打开的是随包页面，不是一台开发机上的 Vite。飞行模式检查见清单。

`ios/App/App/capacitor.config.json` 由 sync 从 `capacitor.config.ts` 重写，并已提交，方便核对 `webDir`。若两边不一致，以 `capacitor.config.ts` 为准再 sync 一次。

若将来删掉 `ios/` 再 `npx cap add ios --packagemanager SPM`，模板会丢掉麦克风文案和文档类型。生成之后执行：

```bash
node scripts/apply-ios-plist.mjs
```

## 麦克风文案

`NSMicrophoneUsageDescription`：

> 用于在你点击「开始哼唱」之后，在本机录下哼唱，并识别音高和节奏以写成曲谱。


网页只在 `startRecord` 里调用 `getUserMedia({ audio: true })`，入口是按钮「开始哼唱」。Capacitor 8.6.0 的 `WebViewDelegationHandler` 对媒体捕获调用 `decisionHandler(.grant)`，这是上游默认实现，本 PR 没有改 Swift。它的意思是允许 WKWebView 把这次请求交给系统，不是启动时就打开麦克风。系统对话框会不会在点击之后出现，必须在真机上看。

## 文档类型

只登记下面三种，角色都是 Viewer，`LSHandlerRank` 为 Alternate，`LSSupportsOpeningDocumentsInPlace` 为 false。没有 `UTExportedTypeDeclarations`。谱线不拥有这些格式，也不做原地编辑。

| 格式 | 打开用的类型 | 扩展名 | 说明 |
| --- | --- | --- | --- |
| MusicXML | `org.musicxml.musicxml`（imported，conforms to `public.xml`） | `.musicxml`、`.mxl` | 不登记 `.xml`，不把 `public.xml` 放进 `LSItemContentTypes` |
| MIDI | 系统类型 `public.midi-audio` | 沿用系统 | 不另造 exported 类型，不登记 `public.audio` 或全部音频 |
| JP-Word | `app.puxian.import.jpwabc`（imported，conforms to `public.data`） | `.jpwabc` | 上游 Dolce 没有公开 UTI。这个标识只用于导入，不是谱线自有格式 |

应用内的文件选择仍接受 `.xml`（MusicXML）和 `audio/*`（拿来听写）。那两条不进系统「用谱线打开」。`.jly` 只是文本导出，不登记文档类型，也不把 LilyPond 打进包。

## 前台中断现在会做什么

只在打包壳里生效：`location.protocol === "capacitor:"` 且 `visibilityState === "hidden"`。

- 正在试听：停掉 Web Audio，光标回到起点。
- 正在哼唱：走中止，不把已录的半段拿去转写，并松开麦克风。
- 然后提示：「已离开前台，试听和哼唱已停下。回到谱线后请再点一次，不会自动接着录。」
- 回到前台不会自动再录、不会自动接着放。

静音键、来电、Siri、耳机拔插不会稳定地变成 `visibilitychange`。这些没有原生会话处理。网站标签页切走也不走这段，避免把网页行为改成壳的策略。

## 真机出口

每一项都还是空的。做完才打勾，并把机型、iOS 版本、日期写在该项后面。模拟器结果单独注明，不能顶替真机。

### 启动与离线

- [ ] 全新安装后，飞行模式下强制退出再冷启动，进入记谱页，能看到「谱线」和谱面。
- [ ] 冷启动的请求里没有 `/api/`、`/__grok/`，也没有字体 CDN。页面不要求登录。
- [ ] 冷启动、浏览谱面、点导入时都不出现麦克风对话框。

### 麦克风与 20 秒

- [ ] 第一次点「开始哼唱」才出现系统麦克风说明，文案与上面的 plist 一致。
- [ ] 允许之后能哼一段并出谱。界面有「正在听，最长二十秒。」满 20 秒会自己停，麦克风指示消失。
- [ ] 第一次就拒绝：谱还在，出现「没有拿到麦克风。可以改上传一段音频。」不反复弹窗。改用文件或文本仍能编辑。
- [ ] 在系统设置里关掉麦克风后再回来，行为与拒绝相同，谱不丢。
- [ ] 授权还没完成时点停止，或连点开始，没有残留录音。

### 试听与打断

- [ ] 点试听能听见振荡器旋律（不是 abcjs 音源）。切到后台后声音停、光标停，并出现「已离开前台…」那句。回到 App 不会自动接着放。
- [ ] 哼唱过程中切到后台：录音停，麦克风指示消失，这段半成品不会被写成新谱。回来后要再点「开始哼唱」。
- [ ] 记下静音键、来电或 Siri、拔插耳机时试听和哼唱各自发生了什么。只记录，不要为了这一轮去改 `AVAudioSession`。

### 文件

- [ ] 在 App 里导入带中文文件名的 `.musicxml` 或 `.mxl`、`.mid`、`.jpwabc`（UTF-16LE）。取消选择时谱不变。
- [ ] 从「文件」App 选「用谱线打开」时，预期是 App 打开但**不会**自动载入该文件。若真的载入了，写下来；若只是回到当前谱，这项导入不算通过，通过的是上一条应用内选择。
- [ ] 导出 MIDI、MusicXML、`.jly`。记下文件是否出现在「文件」或分享单里、文件名是否正确、用别的程序能否再打开。Blob 下载若无反应，记为缺口，不要在这次顺便加分享插件。
- [ ] `.xml` 和音频文件只能从 App 内的选择器读入，系统「打开方式」里不应把所有 XML 或所有音频都交给谱线。

### 草稿

- [ ] 改曲名，等自动保存，强制退出再打开，曲名还在。键是 `puxian-score-v1` 与 `puxian-drafts-v1`，只属于这个壳的 origin，不和网站草稿互通。
- [ ] 卸载后重装，草稿可以不见。不要把它写成云同步。

## 怎样才算里程碑 B 做完

脚手架这一半，以本文件「已入库」和 Linux 上的 `scripts/ios-shell.test.mjs` 为准。

设备这一半，以上面每一条都有真机记录为准。缺任何一条，都不能开始 TestFlight、隐私营养标签或送审。静音键和来电若只是「记下了缺口」，可以结束这一轮验证，但要单独立项，不在本轮用后台音频或新插件补上。
