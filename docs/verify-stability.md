# verify:static 稳定性（第 9 轮）

## 两个偶发超时的根因

r6「继续上次草稿」与 r8「上传谱子图片 → 曲名」两处超时都发生在**等懒加载块**的地方：
首页按需 `import("./staffline-app")`，编辑器（曲名框）和返回主页后的按钮都依赖这些块按时到达。

verify 用的是 `python3 -m http.server`。它的 `ThreadingHTTPServer` 监听队列只有 5，
而且每个请求都是 HTTP/1.0 短连接。几个浏览器（或几轮 verify）同时加载时队列满，
Linux 丢弃 SYN，客户端按 1s/3s/7s… 重传，个别请求被拖到几十秒甚至失败；
失败的动态 import 会被 React.lazy 记住，于是曲名框永远不出现 → 超时。

本机实测（300 个并发请求同一个 JS 块）：

| 服务器 | 失败 | p50 | p99 |
| --- | --- | --- | --- |
| `python3 -m http.server`（队列 5） | 106 / 300 | 4.4 s | 107 s |
| 同一 stdlib 服务器，队列 128 | 0 / 300 | 1.0 s | 1.4 s |

## 修复

- `scripts/verify-static-client.mjs` 仍用 Python 标准库服务器，只把 `request_queue_size` 提到 128。
  断言和超时都没改。
- browse() 失败时会打印：还没返回的请求和已等待时长、最近 30 行控制台、页面状态。
  以后再出现超时，能直接看出是哪个块没回来。
- 修复后 3 轮 verify:static 并发全跑，全部通过（修复前 4 + 3 轮并发也都通过：这类超时本来就少见）。

## 布局走查（scripts/verify-layout-walk.mjs）

在 390×844 和 1280×800 下检查：视图切换和谱面工具都在屏内；收起的和弦指法栏不超过 60 / 70 px；
简谱反复、跳转记号不压和弦名；页面不横向溢出；调音器一行放得下。截图写到 `PUXIAN_WALK_SHOTS`（默认 artifacts/walk）。

## 第 10 轮补充
- 服务器参数抽到 `scripts/static-server.mjs`，verify-static-client、verify-gp5、verify-voices 都用它。
- 产品里的懒加载块失败会重试（见 docs/practice-log.md「同轮顺带」）。真实用户网络抖一下时，不会再卡在「正在打开乐谱…」。
