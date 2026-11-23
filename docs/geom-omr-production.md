# 正式站几何识谱服务

这条路径把 copisteria 检测 + `geom_from_dets` 谱线重建接到正式站的 `/api/geom-omr`。前端在接口可用时把它当作线上识谱引擎；接口关闭时才退回浏览器内 SMT 后备。不要把 Transcoda（AGPL）或 rokot（NC）部署到公开站点。权重文件不得进入 git 或静态站点包。

## 进程

- 用 systemd 单元 `preview/puxian-geom-omr.service`（安装到 `/etc/systemd/system/`），不要长期用 nohup。
- 只绑定 `127.0.0.1` 上的空闲本机端口（默认 18096）。不要对局域网开放。
- `GEOM_PRODUCTION=1`、`GEOM_API_ONLY=1`、`GEOM_KEEP_LAST_JOB=0`、`GEOM_DEVICE=cpu`（仅当机器确有可用 GPU 时再改）。
- 上传在临时目录处理，请求结束后删除。不要在公开服务器上留下 `logs/last-geom-upload.*` 或 `logs/last-geom-job.json`。
- 默认限制：单文件 20 MB、同时只跑 1 个识别任务、同一来源 10 分钟内最多 6 次。超限返回 HTTP 429。

## 权重

把 copisteria 28m 检测权重放到单元里写明的 `GEOM_WEIGHTS` 路径，单独拷贝，不要打进静态 tarball。安装后核对该文件 sha256（本仓库使用的 28m 权重为 `9f1db282271fb1064461387da4a2e15de14b099c49b619c21429cdc45be85cfe`）。

## nginx

先备份站点配置，再把 `preview/nginx-geom-omr.snippet.conf` 放进 HTTPS server，并为上传设置 `client_max_body_size 20m`。读超时至少 180 秒（CPU 推理可能需要一两分钟）。该片段同时关闭 `server_tokens`，并把 `/manifest.webmanifest` 标成 `application/manifest+json`。站点文件权限保持 `www-data:www-data`。

明文 HTTP 不在这个 HTTPS 片段里。把 `preview/nginx-http-redirect.snippet.conf` 放进 `http { }`（不要放进已有的 443 server），让 `http://818189.xyz` 和 `http://www.818189.xyz` 301 到 `https://818189.xyz`。如果边缘（Pingora）在连到本机 80 端口之前就返回空的 500，这份片段到不了那一层，需要在边缘放行或改写，仓库里没有那份配置。

静态目录里要有真实的 `robots.txt` 和 `privacy.html`（`npm run build:static` 会从 `public/` 抄进 `dist-static/`）。把 `preview/nginx-site-static.snippet.conf` 放在 SPA 回退之前，这样 `/robots.txt` 以 `text/plain` 返回文件本身，未知的客户端路径仍回首页。

## 回滚

- 静态站点：把切前快照 rsync 回 `/var/www/puxian`，并 `chown -R www-data:www-data`。
- API / nginx：恢复切前的 nginx 配置快照并 reload；`systemctl stop puxian-geom-omr` 后，前端会改走 SMT 后备路径。
