# 静态移动构建

里程碑 A 的交付物。把记谱前端打成一份不经过 Nitro 的客户端目录，给 Capacitor 的 `webDir` 用。网页渠道仍走 `npm run build`（TanStack Start + Nitro，`preset: "vercel"`），本构建是加出来的，不替换它。

里程碑 B 已把这个目录接到 iOS 壳，命令和未做的真机项在 [iOS 验证清单](capacitor-ios-verify.md)。本文仍只描述静态目录。不要把 `.output`、`.vercel` 或 Nitro 的服务端目录当成 `webDir`。

## 入口、命令、输出

| 项              | 值                                       |
| --------------- | ---------------------------------------- |
| 源码入口 HTML   | `static/index.html`                      |
| 源码入口脚本    | `static/main.tsx`（挂 `HomeApp` 首页） |
| 构建命令        | `npm run build:static`                   |
| 配置            | `vite.static.config.ts`                  |
| 输出目录        | `dist-static/`                           |
| 构建后的 HTML   | `dist-static/index.html`                 |
| 以后的 `webDir` | `dist-static`                            |

`npm run build:static` 不读取 `.grok/app-env.json`，不执行 `db:migrate`，不启动数据库。`npm run build` 保持原样，仍会构建 Nitro 并迁移数据库。

核对命令（需要 devDependency 里的 Playwright，以及本机 Chromium）：

```bash
npx playwright install chromium
npm run build:static
npm run verify:static
```

`verify:static` 用 `python3 -m http.server` 把 `dist-static/` 当普通静态目录提供，不使用 Vite preview，也不使用 Nitro。

## 首页与草稿

网页 `/` 与静态 SPA 共用 `HomeApp`，使用同页状态切换，不新增 `/edit` 路径，不需要静态服务器配置路由回退。刷新始终回到首页；草稿可通过「继续上次草稿」恢复。没有有效本机草稿时不显示该入口。

选预设或新建空白时，显式初始谱优先于 `puxian-score-v1`；编辑器仍沿用原来的记谱、听写、导出、撤销与草稿能力。返回主页前立即保存最新谱，卸载编辑器时沿用原来的播放与录音清理。浏览器禁用存储时，返回主页会暂存在内存并提示导出备份；刷新不会保留该内存副本。

静态入口文件名和 Capacitor 的 `webDir=dist-static` 均未改变，不需要修改 iOS 工程。

## 资源路径

- Vite `base` 是 `./`。`index.html` 里的脚本、样式和 manifest 都是相对路径，不写死站点域名。
- 脚本、样式、字体落在 `dist-static/assets/`，文件名带内容哈希。
- `public/` 里的 `/__grok/` 安装教程资源不复制进这个目录。动态的 `/__grok/manifest.webmanifest` 也不存在于本包。
- 壳页面链接 `./manifest.webmanifest`。这是构建时写死的静态文件：名称「谱线」，`theme_color` / `background_color` 为 `#f7f3ea`，图标是随包的 `./favicon.svg`。
- `@fontsource/outfit` 与 `@fontsource/newsreader` 的 woff／woff2 打进 `assets/`（很小的文件可能变成 data URL）。页面不请求 `fonts.googleapis.com` 或 `fonts.gstatic.com`。
- 中文走系统字体（`PingFang SC`、`Songti SC`、`Noto Sans SC` 等）。静态包不下载中文字体。Linux 上若没有这些字体，字形会缺，但不会因此去访问网络。
- 第三方许可文本从 `public/third-party/` 复制到 `dist-static/third-party/`，供以后随包声明。它们不是启动请求。

Tailwind 的扫描根写在 `src/styles.css`（`source(".")`）。静态构建的 Vite root 是 `static/`，若按 Vite root 扫描，会丢掉 `src/` 里的工具类。网页构建和静态构建因此扫描同一份 `src/`。

## 服务依赖

静态包冷启动时的依赖。「本地」表示请求只发生在这份目录内部（验证时是 `127.0.0.1` 上的静态服务器，以后是 WebView 里的 `webDir`）。

| 能力                                          | 静态包行为                                                                               |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 首页与编辑器                                  | 本地 `index.html` + 哈希 JS。React 挂上 `HomeApp`；选曲、新建或继续草稿后才加载 `StafflineApp`。HTML 本身不含谱面      |
| 样式与拉丁字体                                | 本地 CSS 与 `@fontsource` 文件                                                           |
| 中文排版                                      | 操作系统字体，无网络                                                                     |
| 五线谱                                        | 动态加载本地 `abcjs` 块，只用于绘制                                                      |
| 简谱                                          | 动态加载本地 `jianpurender` 块。需要时才加载，不在首屏五线谱路径上                       |
| 当前谱与草稿                                  | `localStorage` 键 `puxian-score-v1`、`puxian-drafts-v1`。不上传                          |
| 哼唱 / 试听                                   | 本机 `getUserMedia` 与 Web Audio 振荡器。播放不走 abcjs 音源。本里程碑不改录音和后台音频 |
| 导入 / 导出                                   | 本机文件与 Blob 下载                                                                     |
| `/api/*`、`/api/auth/*`                       | 不导入、不请求                                                                           |
| `/__grok/manifest.webmanifest`、`/?install=1` | 不使用。安装教程仍只在网页 Nitro 上                                                      |
| Better Auth、PGLite、`pg`、数据库 URL         | 构建图拒绝这些模块，不打进包                                                             |
| PreviewHostBridge、根路由 `AuthProvider`      | 静态入口不挂载。网页根布局保持原样                                                       |
| `og.grok.me` 与预览注入                       | 不注入                                                                                   |

网页部署继续提供动态 manifest、安装教程和 Nitro 路由。静态包缺少这些端点是故意的。

构建插件会遍历静态入口能到达的模块。碰到 `src/lib/db.ts`、`src/lib/auth/`、`src/lib/app-data/`、`server/`、`@tanstack/react-start`、`nitro`、`better-auth`、`@electric-sql/pglite` 等会直接让 `build:static` 失败。

冷启动报告里可能出现、但不会被请求的绝对 URL：

- `https://paulrosen.github.io/midi-js-soundfonts/…`：abcjs 自带的默认音源地址。当前播放用 Web Audio 振荡器，不调用 abcjs synth。
- `https://react.dev/errors/`：React 生产报错文案里的说明链接，成功启动时不会打开。
- `https://tailwindcss.com`：生成 CSS 文件头的许可注释。

`verify:static` 会把真正发出的非本机请求判为失败，并把上述残留字符串打在报告里。若以后试听或哼唱真的去拉 soundfont，先去掉或改成本地文件，再进入里程碑 B。

## 怎么核对冷启动

自动（Linux CI 或本机）：

```bash
npm test
npx tsc --noEmit
npm run build
npm run build:static
npx playwright install chromium
npm run verify:static
```

`verify:static` 做这些事：

1. `dist-static/index.html` 存在，状态码 200，`content-type` 含 `text/html`，有 `#root` 和一个相对路径的哈希模块脚本。
2. 这份 HTML 不引用 `/__grok/` 或 `/api/`，也不预先写好编辑器标记。
3. 用无头 Chromium 打开该源。只放行 `data:`、`blob:`，以及这次静态服务器的完整 origin（`http://127.0.0.1:<本次端口>`）。同一主机上的其他端口、`localhost`、以及 `/api` 与 `/__grok/` 都会拦截并判失败。重定向的 `Location` 也先按这个 origin 检查，通过才继续请求。
4. 页面首先出现中文功能介绍、全部四首预设和「新建空白谱」，没有编辑器或 `.staff svg`。桌面与手机截图保存在 `artifacts/static-home-*.png`，手机宽度无横向溢出。
5. 选择「小星星」后才出现曲名与 `.staff svg`。主栏 `max-width` 为 `1024px`（`max-w-5xl`），背景为 `#faf8f4`。点「简谱」，确认 `jianpu-render` 块从本机 200 加载，并出现「第一声部」。
6. 改曲名、等待自动保存后刷新，先回到首页；点击「继续上次草稿」恢复编辑。主页本身不覆盖本机谱。
7. 立即改名再「返回主页」，无需等待自动保存，仍能继续最后的修改。逐一选四首预设，核对曲名、调号与开头音高；「新建空白谱」没有音符、第二声部或上一首的撤销历史。旧谱保留在现有草稿历史中。
8. 损坏草稿不阻塞首页或新建；存储不可用时仍可编辑、回主页并继续内存中的谱，页面提示刷新会丢失未保存内容。

浏览器有时会额外请求 `/favicon.ico`。包里没有这个文件，返回 404。它不是 Nitro 路由，也不影响编辑器。正式图标留到里程碑 B。

### 手动飞行模式

没有 iOS 壳时，做不到「手机飞行模式下打开 App」。桌面上对应的检查是：静态服务器只代表随包文件，浏览器不去别的主机。

1. `npm run build:static`
2. `python3 -m http.server 8091 --bind 127.0.0.1 --directory dist-static`
3. 打开 `http://127.0.0.1:8091/`。开发者工具 → 网络，禁用缓存。
4. 确认文档是 200，随后只有 `127.0.0.1` 上的 `/assets/...`（以及可能的 `/favicon.ico` 404）。没有 `/api/`、`/__grok/`，也没有字体 CDN。
5. 看到「谱线」首页，选曲后出现五线谱。改曲名，等约一秒，刷新回到首页；点「继续上次草稿」，曲名还在。
6. 关掉 Wi-Fi 后再刷新一次。回环地址仍通，页面应同样打开。若要模拟「连本机服务器也没有」的真飞行模式，需要等里程碑 B 把 `dist-static` 放进 WebView；不要用 `file://` 打开这份构建，浏览器会拦住模块脚本。

`npm run verify:static` 覆盖上面这份自动清单。它放行的不是「任意回环地址」，而是这一次静态服务器的 origin（含端口）。其他端口即使也在 `127.0.0.1` 上也会被拒绝，因此比单纯拔网线更接近「包外没有任何源」。

## 这一步明确不做

- 不在本文里重复 iOS 工程步骤。壳、sync 和真机清单见 [iOS 验证清单](capacitor-ios-verify.md)。
- 不合并，不提交商店包，不做 IAP、云同步、后台音频。
- 不改网页 `npm run build` 的 Nitro／Vercel 路径。
- 不把登录或 PreviewHostBridge 做进静态入口。
