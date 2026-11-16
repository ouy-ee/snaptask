# 架构设计:后端数据模型与 API

本文档是 SnapTask 从 Demo 走向生产的第一份正式后端设计，已按此实现（`server/`）。

## 1. 总体架构

```
浏览器(React SPA)
   │  HTTPS
   ▼
nginx(静态资源 + /api 反向代理)
   ▼
snaptask-server(Node 20 + Express)          ┌─ OCR:百度/PaddleOCR(可选)
   ├─ SQLite(better-sqlite3, WAL)           ├─ Vision:GLM-4V-Flash/硅基/Ollama
   ├─ 文件存储:本地磁盘 或 S3(R2/MinIO)      └─ 分析任务队列(进程内, 并发1)
   └─ 定时任务:回收站30天清理 / 孤儿上传清理
```

设计要点：

- **单实例优先**：分析任务为进程内队列（并发 1，控制模型成本与限流），数据库与文件卷持久化。用户量上来后再拆 worker 进程（`analysis_jobs` 表已按任务持久化，天然支持）。
- **供应商可替换**：OCR / Vision / 存储均为适配层，换供应商只改环境变量。
- **服务端为唯一事实源**：登录态下浏览器 localStorage 仅作缓存，所有写操作先落服务端；断网时读缓存降级，恢复后重拉。
- **多标签页同步**：BroadcastChannel 广播变更 + 各标签页向服务端重拉。

## 2. 数据模型（SQLite 表）

所有表含 `user_id` 外键，查询一律按 `user_id` 过滤（防越权）。时间戳一律毫秒（INTEGER）。

| 表 | 字段 | 说明 |
| --- | --- | --- |
| `users` | id(PK), email(UNIQUE), name, password_hash, created_at, updated_at, deleted_at | 账号；deleted_at 为注销标记 |
| `refresh_tokens` | id(PK), user_id, family_id, token_hash, created_at, expires_at, revoked_at, replaced_by, revoked_reason | 刷新令牌轮换；family 复用检测防重放 |
| `folders` | id(PK), user_id, name, parent_id, sort, created_at, updated_at, deleted_at | 文件夹；注册时自动创建 `folder-inbox`（未整理，不可删） |
| `uploads` | id(PK), user_id, storage_key, original_name, mime_type, size, width, height, thumb_key, regions(JSON), ocr_text, quality(JSON), created_at, deleted_at | 原始截图/附件；regions 为 OCR 定位框 |
| `records` | id(PK), user_id, folder_id, title, image_count, content_tags(JSON), saved_at, result(JSON), is_deleted, deleted_at, version, created_at, updated_at | 分析记录（历史记录）。软删除 → 回收站 |
| `record_images` | id(PK), record_id(FK), upload_id(FK, 可空), name, width, height, size_kb, legend_index, quality(JSON), regions(JSON) | 记录↔图幅关联（一张图可被多条记录复用，引用计数防误删） |
| `urgent_tasks` | id(PK), user_id, title, description, assignee, due_date, priority, status, done, src(JSON), source, record_id, created_at, updated_at, deleted_at | 首页待办；record_id 关联来源分析记录 |
| `archives` | id(PK), user_id, title, note, storage_key, link, original_name, mime_type, size, created_at, updated_at, deleted_at | 归档文件（文件或外链二选一） |
| `analysis_jobs` | id(PK), user_id, status, stage_index, stage_label, processed, total, note, error(JSON), result(JSON), scenario, image_ids(JSON), created_at, started_at, finished_at | 分析任务快照（前端轮询）；服务重启时中断任务标记为可恢复失败 |
| `daily_usage` | user_id+kind+day(PK), calls | 每用户每日 OCR/视觉调用计数（防超支） |
| `audit_log` | id(PK), user_id, action, entity, entity_id, created_at | 操作日志 |

`records.result` 的 JSON 结构与前端既有模型完全一致（`scenario / scene_type / content_tags / summary / facts / keyFacts / tasks / comparison / warnings`），`src` 数组在服务端归一化为真实 `uploadId`。该结构详见 `src/mock/data.js` 顶部注释。

## 3. API 设计

统一约定：

- 前缀 `/api`；鉴权：`Authorization: Bearer <accessToken>`（15 分钟）+ 刷新令牌轮换（30 天）。
- 错误格式：`{ "error": { "code", "message", "detail?" } }`，语义化 code（如 `TOKEN_EXPIRED` / `EMAIL_TAKEN` / `QUOTA_EXCEEDED` / `RATE_LIMITED` / `OFFLINE`）。
- 分页：`?cursor=&limit=` 键集分页，响应 `{ items, nextCursor }`。
- 校验：zod，失败 422 附字段错误；限流：全局限 300 次/5 分钟，认证接口 10 次/分钟。

### 3.1 认证 `POST /api/auth/*`

| 接口 | 入参 | 说明 |
| --- | --- | --- |
| `POST /register` | `{name, email, password}` | 建号 + 创建 inbox 文件夹，返回 tokens + user |
| `POST /login` | `{email, password}` | 密码 bcrypt 校验，返回 tokens + user |
| `POST /refresh` | `{refreshToken}` | 轮换：旧令牌作废、签发新对；旧令牌复用 → 撤销整个家族（防重放） |
| `POST /logout` | `{refreshToken}` | 撤销令牌 |
| `GET /me` | — | 用户信息 + 存储用量 + 今日配额 |
| `PATCH /me` | `{name}` | 改昵称 |
| `POST /me/password` | `{currentPassword, newPassword}` | 改密码，撤销全部刷新令牌 |
| `DELETE /me` | — | 注销账号：删除全部数据与文件（隐私合规） |

### 3.2 上传 `POST /api/uploads`

| 接口 | 说明 |
| --- | --- |
| `POST /` | multipart 单文件。服务端双重校验：扩展名白名单（png/jpg/webp）+ **魔数校验**（file-type），≤10MB。返回 `{id, name, url, width, height, sizeKb}` |
| `GET /:id/content` | 鉴权后返回图片（本地流 / S3 预签名 302）。**无公网直链**，防越权访问 |
| `DELETE /:id` | 仅当无任何记录引用时允许删除（409 否则） |

### 3.3 文件夹 `GET/POST /api/folders`、`PATCH/DELETE /api/folders/:id`

删除文件夹为**事务**：其下记录移入 `folder-inbox`；`folder-inbox` 不可删除；重名 409。

### 3.4 记录（历史记录）`/api/records`

| 接口 | 说明 |
| --- | --- |
| `GET /?folderId=&q=&tag=&sort=&cursor=&limit=` | 列表（轻量字段，不含 result），支持搜索/筛选/排序 |
| `GET /:id` | 完整记录：图幅（含鉴权 URL）+ result |
| `POST /` | 保存分析结果：`{title, folderId, savedAt, images:[{id, name, width, height, sizeKb, legendIndex, quality, regions}], result}`；图幅 id 必须属于本人 |
| `PATCH /:id` | 修改 `{title?, folderId?, result?, images?}`——**任务修改真正关联原始分析记录**（version+1，写操作日志） |
| `DELETE /:id` | 软删除 → 回收站 |
| `POST /:id/restore` | 回收站恢复 |
| `DELETE /:id?permanent=true` | 彻底删除（事务：删记录、删关联、引用计数归零的图片文件删除） |

### 3.5 回收站 `/api/recycle-bin`

| 接口 | 说明 |
| --- | --- |
| `GET /` | 已删记录列表 + 剩余保留天数（默认 30 天，`RECYCLE_RETENTION_DAYS`） |
| `POST /:recordId/restore` | 恢复 |
| `DELETE /:recordId` | 彻底删除 |

过期自动清理：定时任务每小时 + 列表访问时惰性清理双保险。

### 3.6 待办 `/api/tasks`

`GET /`（列表）、`POST /`（新建）、`POST /sync`（结果页批量同步，按 id upsert 并关联 record_id）、`PATCH /:id`（勾选/编辑）、`DELETE /:id`。

### 3.7 归档 `/api/archives`

| 接口 | 说明 |
| --- | --- |
| `GET /` | 列表 |
| `POST /` | 两种形式：① multipart 文件（文档类型白名单，≤20MB）② JSON `{title, note, link}`（外链） |
| `GET /:id/download` | 鉴权下载（附件流 / 302 外链） |
| `PATCH /:id` / `DELETE /:id` | 重命名（+note）/ 删除并清理文件 |

### 3.8 分析 `/api/analysis`

| 接口 | 说明 |
| --- | --- |
| `POST /` | `{imageIds:[≤6], names?}` → 202 `{jobId}`。图片必须先上传（服务端校验归属） |
| `GET /:jobId` | 快照：`{status, stageIndex, stageLabel, processed, total, note, error, result, scenario}`。前端每 1.1s 轮询并合成与 Demo 相同的事件流 |
| `POST /:jobId/cancel` | 取消（阶段间检查取消标记） |

**分析流水线（5 阶段，与 Demo 界面一致）**：

1. `load` 读取图幅 —— 校验文件存在与格式；
2. `recognize` 识别注记 —— 逐图 OCR（进度按图推进）；OCR 框 → 图幅 `regions`（**来源区域坐标定位**，归一化 x/y/w/h）；平均置信度 → 图幅质量评分（**真实质量预检**）；
3. `merge` 拼合图景 —— 全部图 + OCR 文本交给视觉模型；
4. `collate` 校勘比对 —— 同一提示词内完成多图语义融合、冲突检测、置信度标注；
5. `compose` 成图 —— 输出结构化 JSON → zod 校验/修复 → `src` 序号映射为真实图 id → 落库。

**失败/重试/限流处理**（`server/src/ai/`）：

- 每次 Provider 调用：超时（视觉 120s / OCR 30s）→ 指数退避重试 2 次；429/限流错误尊重 `Retry-After` 再重试；参数类 4xx 不重试。
- 单图 OCR 失败不拖垮全任务 → 该图标记低质量，结果降级为 `partial_success` 并生成 low-quality 警告；全部图失败 → 任务失败（`recoverable: true`，前端可重试）。
- 视觉模型失败（重试耗尽）→ 任务失败，错误码区分 `RATE_LIMITED` / `VISION_TIMEOUT` / `VISION_PROVIDER_ERROR`，前端失败页展示对应文案，可重试。
- 每日配额：`OCR_DAILY_LIMIT` / `VISION_DAILY_LIMIT` 达到后拒绝调用（429 `QUOTA_EXCEEDED`），防意外账单。
- 服务重启：`queued/processing` 任务标记为 `JOB_INTERRUPTED`（可恢复失败）。

## 4. 安全设计

| 威胁 | 对策 |
| --- | --- |
| 密码泄露 | bcrypt(cost 10)；最短 8 位；改密码撤销全部会话 |
| 令牌窃取/重放 | access 15 分钟短寿；refresh 轮换 + 复用检测（撤销家族） |
| CSRF | 鉴权仅用 Bearer 头，不使用 Cookie |
| 越权访问 | 所有查询按 user_id 过滤 + 资源归属校验（含图片内容接口与下载接口） |
| SQL 注入 | better-sqlite3 全参数化预编译语句 |
| XSS | React 默认转义；图片白名单 + 魔数校验（拒绝 SVG 上传防脚本）；生产 nginx 附 CSP 示例 |
| 恶意上传 | 类型魔数校验、大小限制、路径穿越防护（storage key 由服务端生成） |
| 暴力破解 | 认证接口限流 + 全局限流 |
| 文件探测 | 上传文件一律服务端生成 UUID 文件名，保留原始名仅作展示 |
| 隐私合规 | `DELETE /me` 数据擦除；`docs/PRIVACY.md` 隐私政策模板；操作日志 `audit_log` |

## 5. 前端接入约定

- `src/api/config.js` 启动时探测 `/api/health`：可用 → 云端模式（需登录）；不可用 → 本地 Demo 模式（行为与现在完全一致）。
- `src/api/service.js` 对 `analyzeImages` / `estimateQuality` 保持与 `src/mock/service.js` **相同的函数签名与返回结构**，store 无感切换。
- 登录态下所有持久化动作：先调 API → 更新本地缓存 → BroadcastChannel 广播；API 失败回滚并提示。断网时读缓存。
- 会话过期：401 且刷新失败 → 全局事件 → 清登录态 + 跳登录页 + 提示。
