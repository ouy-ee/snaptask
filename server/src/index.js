/* 服务入口:装配上下文 → 启动 → 定时清理 → 优雅退出 */

import 'dotenv/config';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { openDb } from './db.js';
import { createStorage } from './storage/index.js';
import { createOcr } from './ai/ocr.js';
import { createVision } from './ai/vision.js';
import { createAnalysisQueue } from './ai/pipeline.js';
import { createApp } from './app.js';
import { purgeRecycle, orphanUploadCleanup, purgeExpiredTokens } from './services/cleanup.js';

const config = loadConfig(process.env);

/* AI 配置不应阻断认证、文件夹和历史记录服务。
   未配置 Key 时仅在真正发起分析请求时返回 VISION_NOT_CONFIGURED，
   这样用户仍可注册、登录并管理云端数据。 */
if (config.vision.provider !== 'ollama' && !config.vision.apiKey) {
  console.warn('⚠️ 未配置 VISION_API_KEY，AI 分析暂不可用；认证与数据接口仍会启动。');
  console.warn('   请在需要分析前配置 server/.env 中的 VISION_API_KEY。');
}

if (config.jwt.secretIsDefault) {
  console.warn('[warn] 正在使用开发用 JWT_SECRET。生产环境必须设置 JWT_SECRET(见 .env.example)。');
}

const logger = createLogger(config.logLevel);
const db = openDb(config.dbPath);
const storage = createStorage(config, logger);
const ocr = createOcr(config, db, logger);
const vision = createVision(config, db, logger);
const queue = createAnalysisQueue({ db, config, logger, storage, ocr, vision });
queue.recoverStuck(); // 服务重启:中断任务标记为可恢复失败

const ctx = { config, logger, db, storage, ocr, vision, queue };
const app = createApp(ctx);

const server = app.listen(config.port, config.host, () => {
  logger.info(
    {
      port: config.port,
      env: config.env,
      providers: { ocr: ocr.provider, vision: `${vision.provider}/${vision.model}`, storage: storage.kind },
    },
    'snaptask-server 已启动'
  );
});

/* 定时清理:回收站过期 / 孤儿上传 / 过期令牌 */
const hourly = setInterval(() => {
  purgeRecycle(ctx).catch((err) => logger.warn({ err: err.message }, '回收站清理出错'));
  orphanUploadCleanup(ctx).catch((err) => logger.warn({ err: err.message }, '孤儿上传清理出错'));
  purgeExpiredTokens(ctx);
}, 3600 * 1000);
hourly.unref();

function shutdown(signal) {
  logger.info({ signal }, '收到退出信号,正在关闭…');
  clearInterval(hourly);
  server.close(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    logger.info('已关闭');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
