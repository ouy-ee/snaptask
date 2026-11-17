/* Express 应用装配:安全头、CORS、限流、路由挂载 */

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { requestLogger, notFoundHandler, errorHandler, createAuthMiddleware } from './middleware.js';
import { authRouter, meRouter } from './routes/auth.js';
import { foldersRouter } from './routes/folders.js';
import { recordsRouter } from './routes/records.js';
import { recycleRouter } from './routes/recycle.js';
import { tasksRouter } from './routes/tasks.js';
import { archivesRouter } from './routes/archives.js';
import { uploadsRouter, uploadsContentRouter } from './routes/uploads.js';
import { analysisRouter } from './routes/analysis.js';

export const VERSION = '0.2.0';

export function createApp(ctx) {
  const { config, logger, ocr, vision, storage, queue } = ctx;
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(
    helmet({
      // 纯 API 服务;前端 HTML 由 nginx/Vite 提供并附 CSP(见 docs/DEPLOY.md)
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );
  app.use(
    cors({
      origin: config.corsOrigin,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 86400,
    })
  );
  app.use(express.json({ limit: '12mb' }));
  app.use(requestLogger(logger));

  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      service: 'snaptask-server',
      version: VERSION,
      providers: {
        ocr: ocr.provider,
        vision: `${vision.provider}/${vision.model}`,
        storage: storage.kind,
      },
      time: new Date().toISOString(),
    });
  });

  const authLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: config.rateLimit.authMax,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: '登录或注册尝试过于频繁,请稍后再试',
        },
      });
    },
  });
  const apiLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use('/api/auth', authLimiter, authRouter(ctx));

  const requireAuth = createAuthMiddleware(config);
  app.use('/api/me', requireAuth, meRouter(ctx));
  app.use('/api/folders', requireAuth, apiLimiter, foldersRouter(ctx));
  app.use('/api/records', requireAuth, apiLimiter, recordsRouter(ctx));
  app.use('/api/recycle-bin', requireAuth, apiLimiter, recycleRouter(ctx));
  app.use('/api/tasks', requireAuth, apiLimiter, tasksRouter(ctx));
  app.use('/api/archives', requireAuth, apiLimiter, archivesRouter(ctx));
  // 图片内容:<img> 标签无法带 Bearer 头,走签名 URL 鉴权(挂载在 auth 路由之前)
  app.use('/api/uploads', uploadsContentRouter(ctx));
  app.use('/api/uploads', requireAuth, apiLimiter, uploadsRouter(ctx));
  app.use('/api/analysis', requireAuth, apiLimiter, analysisRouter(ctx));

  app.use(notFoundHandler);
  app.use(errorHandler(logger, config.isProd));
  return app;
}
