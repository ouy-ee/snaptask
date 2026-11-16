# SnapTask Server

SnapTask 后端服务:注册登录(JWT 轮换)、SQLite 数据层、截图上传(魔数校验)、分析流水线(OCR + 视觉模型)、回收站、待办、归档、操作日志。

详细设计见 [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md),成本方案见 [../docs/COSTS.md](../docs/COSTS.md)。

## 快速开始(开发)

```bash
cd server
npm install
cp .env.example .env     # 开发默认即可启动;生产必须设置 JWT_SECRET
npm run dev              # http://localhost:8787
```

前端联调:根目录 `npm run dev`(Vite 已配置 /api 代理到 8787)。

## 配置 AI(全部免费方案,见 docs/COSTS.md)

| 能力 | 最小配置 |
| --- | --- |
| 视觉模型 | `VISION_API_KEY=<智谱 API Key>`(默认 GLM-4V-Flash)。也可 `VISION_PROVIDER=siliconflow|ollama|openai` + 对应 `VISION_BASE_URL` / `VISION_MODEL` |
| OCR(可选) | 百度:`OCR_PROVIDER=baidu` + `BAIDU_OCR_API_KEY/SECRET_KEY`;自托管:`OCR_PROVIDER=paddle` + 运行 `server/ocr/paddle_server.py` 或 docker compose --profile ocr |

> 即使不配 OCR(`none`),视觉模型也会直接读图,只是没有文字坐标定位与 OCR 质量预检。

## 测试

```bash
npm test
```

覆盖:认证(含刷新轮换/复用检测)、文件夹事务、记录软删恢复/彻底删除/引用计数、上传魔数校验、待办同步、分析流水线(成功/失败/取消/重启恢复)、结果归一化。

## 部署

```bash
docker compose up -d
```

生产部署(HTTPS + 环境变量 + 数据备份)完整步骤见 [../docs/DEPLOY.md](../docs/DEPLOY.md)。
