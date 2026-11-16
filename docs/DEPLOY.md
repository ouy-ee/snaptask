# 部署指南

目标拓扑:nginx(HTTPS + 前端静态资源 + /api 反代)→ snaptask-server(Docker 或 Node 直跑)→ 可选 PaddleOCR。

## 一、本机开发(两步)

```bash
# 1. 后端
cd server && npm install && cp .env.example .env && npm run dev

# 2. 前端(自动代理 /api → localhost:8787)
cd .. && npm install && npm run dev
```

前端启动时会探测 `/api/health`:后端在线 → 云端模式(需注册登录);后端不在 → 自动回退本地 Demo 模式。

## 二、服务器部署(Docker)

前置:一台 Linux 服务器(免费/廉价方案见 [COSTS.md](./COSTS.md))、已安装 Docker 与 docker compose 插件。

```bash
# 1. 传代码到服务器
git clone <你的仓库> && cd <仓库>/server

# 2. 配置环境变量(生产必填 JWT_SECRET)
cp .env.example .env
# 生成密钥: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
# 编辑 .env:NODE_ENV=production、JWT_SECRET=<上面生成的值>、
#   CORS_ORIGIN=https://snaptask.example.com、TRUST_PROXY=true、
#   VISION_API_KEY=<智谱免费模型 API Key,见 docs/COSTS.md>

# 3. 启动后端
docker compose up -d --build

# 4. 前端构建 + nginx
cd .. && npm ci && npm run build
sudo mkdir -p /var/www/snaptask && sudo cp -r dist /var/www/snaptask/
sudo cp deploy/nginx.conf /etc/nginx/sites-available/snaptask
sudo sed -i 's/snaptask.example.com/你的域名/g' /etc/nginx/sites-available/snaptask
sudo ln -s /etc/nginx/sites-available/snaptask /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## 三、HTTPS(certbot,免费证书)

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d snaptask.example.com   # 自动申请并配置 443 与自动续期
```

国内服务器需先完成域名 ICP 备案才能用 80/443 端口对外提供服务。

## 四、环境变量清单

全部变量与默认值见 `server/.env.example`。关键项:

| 变量 | 必须 | 说明 |
| --- | --- | --- |
| `JWT_SECRET` | 生产必须 | ≥32 位随机串;泄露后可伪造任意用户 |
| `VISION_API_KEY` | 要 AI 则必须 | 智谱开放平台免费模型 Key(见 COSTS.md) |
| `STORAGE_DRIVER` | 否 | `local`(默认,存 `server/data/uploads`)或 `s3`(R2/MinIO) |
| `CORS_ORIGIN` | 生产必须 | 你的 https 域名 |
| `TRUST_PROXY` | nginx 后建议 | `true` 时限流按真实 IP 计数 |
| `OCR_PROVIDER` | 否 | `none` 也能用(视觉模型直读);`baidu`/`paddle` 见 COSTS.md |

环境变量只放服务器(或 CI Secret),**绝不提交到 git**(`.env` 已在 .gitignore)。

## 五、上线前安全检查清单(逐条执行)

```bash
# 1. 敏感文件未入库:应输出「无任何输出」或确认只有 .env.example
git status --short | grep -i "\.env$" || echo "✓ 真实 .env 未出现在 git 状态"
git check-ignore server/.env && echo "✓ server/.env 已被 .gitignore 排除"

# 2. 全仓扫描是否泄露真实密钥(应无输出;记得先换掉你曾在聊天/工单里暴露过的 Key)
grep -rniE "(api[_ -]?key\s*=|secret\s*=\s*['\"][a-z0-9]{16,})" --include="*.env*" --include="*.json" --include="*.js" . | grep -v "your_api_key_here" || echo "✓ 未发现疑似真实密钥"

# 3. 模板文件必须是占位符(输出应为 your_api_key_here 或空)
grep -E "VISION_API_KEY|BAIDU_OCR" server/.env.example

# 4. 生产密钥强度:JWT_SECRET ≥ 32 位随机串(生成命令见上文),且已写入服务器 .env

# 5. 依赖安全审计(有高危项先升级)
npm audit --omit=dev
```

> 特别提醒:API Key 一旦出现在聊天记录、工单、commit 历史中,应视为已泄露,立即到对应平台**作废重签**,新 Key 只放服务器 `server/.env`。

## 六、数据备份与恢复

```bash
# SQLite + 上传文件都在 server/data/ 一个目录
tar czf snaptask-backup-$(date +%F).tar.gz -C server data
# 恢复:停服 → 还原目录 → 起服
```

建议 cron 每日备份到异地(如 R2 免费档)。

## 七、可观测性

- 访问日志:pino JSON 输出到 stdout,`docker logs snaptask-snaptask-1 -f` 查看。
- 错误监控:免费档 Sentry(约 5k events/月)或自托管 GlitchTip;在 `src/index.js` 增加 transport 即可接入,不侵入业务代码。
- 健康检查:`GET /api/health`(已配 Docker HEALTHCHECK 与 CI)。

## 八、扩容路线(用户量上来后)

1. SQLite → PostgreSQL:数据访问集中在 `server/src/db.js` 与路由层 SQL,可平移(推荐 Supabase 免费档起步)。
2. 单进程分析队列 → 独立 worker:任务状态已持久化在 `analysis_jobs`,多 worker 争抢消费即可(`ANALYSIS_CONCURRENCY` 调大)。
3. 本地磁盘 → Cloudflare R2:改 `STORAGE_DRIVER=s3` 即可,旧文件迁移脚本一次即可。
