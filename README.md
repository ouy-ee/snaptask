# SnapTask — AI 截图任务助手

把单张或多张截图转换为**结构化信息、任务清单、对比表格与 AI 总结**的截图分析助手（视觉模型默认智谱 GLM-4V-Flash，可替换）。核心差异化：每条结果都标注它来自哪张截图——冲突与不确定不会被伪装成事实。

**双模式运行**：

- **云端模式**：后端在线时自动启用——真实注册登录（JWT 轮换）、SQLite 数据层、截图上云、真实 OCR / 视觉模型分析、多设备同步、30 天回收站。
- **本地 Demo 模式**：后端不在时自动回退——无需任何服务，内置演示数据，行为完全自洽。

## 核心功能

| 能力 | 说明 |
| --- | --- |
| 五阶段分析 | 读取图幅 → 识别注记(OCR 可选) → 拼合图景 → 校勘比对 → 成图,进度实时可见,支持暂停/取消/失败重试 |
| 来源溯源 | 每条事实/任务/表格单元格标注来源图幅;OCR 定位框高亮原文区域(点击来源即打开) |
| 冲突与置信度 | 多处来源数值不一致 → 对校展示不掩盖;低置信/未提及显式标注 |
| 结构化结果 | AI 总结(事实/推断/建议)、结构化事实、任务清单、对比表格、风险警告面板,全部可编辑 + 撤销/重做 |
| 云端同步 | 文件夹管理(拖拽移动)、历史记录(搜索/标签/排序/批量操作)、30 天回收站、多标签页实时同步 |
| 文件归档 | 分析结果一键导出归档;归档文件带 Token 预览/下载(文本直读、图片弹窗、其他触发下载) |
| 账号体系 | 注册/登录(令牌轮换+复用检测)、账号设置(改密码/改昵称)、数据导出(JSON)、注销即擦除 |

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 18 + Vite + react-router-dom;设计系统为 CSS 自定义属性(自绘 SVG 图标,无 UI 库依赖) |
| 后端 | Node.js ≥ 20 + Express 4 + better-sqlite3(WAL);zod 校验、helmet/CORS/限流 |
| 鉴权 | JWT(access 15 分钟 + refresh 30 天轮换,复用检测撤销家族)+ bcryptjs;图片/归档走签名 URL 或 Bearer |
| AI | 视觉模型:OpenAI 兼容适配层(智谱 GLM-4V-Flash 默认 / 硅基流动 / Ollama / OpenAI);OCR:百度 / PaddleOCR 自托管 / 关闭直读 |
| 存储 | 本地磁盘默认;S3 兼容适配层(Cloudflare R2 / MinIO) |
| 测试 | Vitest + supertest(后端 31 用例)+ React Testing Library(前端 25 用例);CI 已配 GitHub Actions |

## 本地开发指南

**环境要求**：Node.js ≥ 20、npm ≥ 10;OCR 若用 PaddleOCR 需 Python 3.9+(可选)。

```bash
# 1. 后端(终端 A)
cd server
npm install
cp .env.example .env        # 生成配置文件
# 编辑 .env:至少填 VISION_API_KEY(智谱免费模型 Key,获取与价格见 docs/COSTS.md)
npm run dev                 # http://localhost:8787

# 2. 前端(终端 B,项目根目录)
npm install
npm run dev                 # http://localhost:5173,/api 自动代理到 8787
```

- **环境变量**：全部变量与默认值见 [server/.env.example](server/.env.example);模板里是 `your_api_key_here` 占位符,服务端会把占位符视为未配置,不会误发请求。
- **模式说明**：前端启动时探测 `/api/health`——后端在线 → 云端模式(需注册登录);后端不在 → 本地 Demo 模式,无需任何配置即可体验完整流程。
- 开发模式 JWT_SECRET 使用固定开发密钥(终端有黄色警告),生产环境必须配置随机密钥。

## 测试指南

```bash
npm test              # 前端:client / store reducer / 登录页 / 首页归档 / 记录抽屉 / 文件夹树(25 用例)
npm run server:test   # 后端:认证轮换 / 事务 / 越权隔离 / 上传魔数 / 分析流水线 / 归一化 / 导出(31 用例)
```

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | **用户使用指南**:快速上手、各页面功能、隐私与常见问题(面向网站访客) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 数据模型、REST API 设计、安全设计、分析流水线 |
| [docs/COSTS.md](docs/COSTS.md) | **免费优先方案 + 最便宜付费兜底对照表**(附官网价格页链接,部署前核实) |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Docker Compose 部署、Nginx + HTTPS、上线前安全检查清单、备份 |
| [docs/PRIVACY.md](docs/PRIVACY.md) | 隐私政策模板(含数据删除机制) |
| [docs/VERIFY.md](docs/VERIFY.md) | 本机验证清单(首次运行前必读) |
| [docs/ROADMAP.md](docs/ROADMAP.md) | 已完成 / 待办路线图 |
| [DESIGN.md](DESIGN.md) | 前端设计系统 |

## 许可证与隐私

开源前请补充 LICENSE;上线对外服务前请按 [docs/PRIVACY.md](docs/PRIVACY.md) 完善并公示隐私政策。
