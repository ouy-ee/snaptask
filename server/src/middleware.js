/* 鉴权、校验、限流、错误处理中间件 */

import multer from 'multer';
import { verifyAccessToken } from './auth/jwt.js';
import { AppError, unauthorized } from './errors.js';

/* Bearer access token → req.user */
export function createAuthMiddleware(config) {
  return function requireAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) return next(unauthorized());
    const { userId, expired } = verifyAccessToken(config.jwt.secret, match[1]);
    if (expired) return next(unauthorized('TOKEN_EXPIRED', '登录已过期'));
    if (!userId) return next(unauthorized('TOKEN_INVALID', '登录凭证无效'));
    req.user = { id: userId };
    next();
  };
}

/* zod 校验请求体,通过后以解析结果替换 req.body */
export function validate(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      return res.status(422).json({ error: { code: 'VALIDATION', message: '参数校验失败', detail } });
    }
    req.body = parsed.data;
    next();
  };
}

/* multipart 单文件(内存)。大小限制与白名单在下游路由做二次校验。 */
export function memoryUpload(field, maxBytes) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1 },
  }).single(field);
}

export function requestLogger(logger) {
  return (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      if (req.path.startsWith('/api')) {
        logger.info({ method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start }, 'http');
      }
    });
    next();
  };
}

export function notFoundHandler(req, res, next) {
  next(new AppError(404, 'NOT_FOUND', '接口不存在'));
}

export function errorHandler(logger, isProd = true) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof AppError) {
      if (err.status >= 500) logger.error({ err: err.message, code: err.code, stack: err.cause?.stack }, '请求处理失败');
      return res.status(err.status).json(err.toPayload());
    }
    if (err?.name === 'ZodError') {
      return res.status(422).json({
        error: {
          code: 'VALIDATION',
          message: '参数校验失败',
          detail: err.issues?.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
    }
    if (err?.name === 'MulterError') {
      const overSize = err.code === 'LIMIT_FILE_SIZE';
      return res.status(overSize ? 413 : 400).json({
        error: { code: 'UPLOAD_INVALID', message: overSize ? '文件超过大小限制' : `上传失败:${err.message}` },
      });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: '请求体过大' } });
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'BAD_JSON', message: 'JSON 解析失败' } });
    }
    logger.error({ err: err?.stack || err?.message }, '未处理异常');
    // 开发/测试环境暴露真实错误信息,便于定位;生产环境只返回通用文案
    res.status(500).json({
      error: {
        code: 'INTERNAL',
        message: '服务器内部错误',
        ...(isProd ? {} : { detail: err?.message || String(err) }),
      },
    });
  };
}
