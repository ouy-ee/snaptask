/* 截图上传:扩展名白名单 + 魔数校验 + 尺寸探测。
   访问控制:
   - 上传/删除走 Bearer 鉴权(uploadsRouter,由 app.js 挂 requireAuth)
   - 图片内容走「短时签名 URL」(uploadsContentRouter,无需 Bearer):
     <img> 标签无法携带 Authorization 头,URL 中的 ?token= 由服务端签发,
     校验签名 + 资源属主一致;S3 模式下再换预签名重定向。 */

import express from 'express';
import { fileTypeFromBuffer } from 'file-type';
import { imageSize } from 'image-size';
import { now, audit } from '../db.js';
import { memoryUpload } from '../middleware.js';
import { badRequest, notFound, conflict, unauthorized } from '../errors.js';
import { storageKeyFor } from '../storage/index.js';
import { verifyImageToken, verifyAccessToken } from '../auth/jwt.js';
import { imageContentUrl } from '../services/imageUrl.js';

/* 仅允许位图截图。SVG 明确拒绝(可内嵌脚本,XSS 风险)。 */
const ALLOWED_IMAGE_EXT = ['png', 'jpg', 'webp'];

export function uploadsRouter(ctx) {
  const router = express.Router();
  const { db, storage, config } = ctx;
  const maxBytes = config.storage.maxUploadBytes;

  router.post('/', (req, res, next) => {
    memoryUpload('file', maxBytes)(req, res, (err) => {
      if (err) return next(err);
      (async () => {
        try {
          if (!req.file) throw badRequest('UPLOAD_NO_FILE', '请选择要上传的截图');
          const buffer = req.file.buffer;
          if (!buffer || buffer.length === 0) throw badRequest('UPLOAD_EMPTY', '文件为空');

          const ext = /\.([a-zA-Z0-9]+)$/.exec(req.file.originalname || '')?.[1]?.toLowerCase();
          const detected = await fileTypeFromBuffer(buffer);
          // 双重校验:扩展名白名单 + 魔数
          if (!ext || !ALLOWED_IMAGE_EXT.includes(ext)) {
            throw badRequest('UPLOAD_TYPE_FORBIDDEN', '仅支持 PNG / JPG / WEBP 截图');
          }
          if (!detected || !ALLOWED_IMAGE_EXT.includes(detected.ext)) {
            throw badRequest('UPLOAD_TYPE_FORBIDDEN', '文件内容与扩展名不符或不是受支持的图片格式');
          }

          let dims = null;
          try {
            dims = imageSize(buffer);
          } catch {
            throw badRequest('UPLOAD_BROKEN', '图片损坏或无法读取');
          }

          const id = crypto.randomUUID();
          const key = storageKeyFor(req.user.id, detected.ext);
          await storage.put(key, buffer, detected.mime);
          db.prepare(
            `INSERT INTO uploads (id, user_id, storage_key, original_name, mime_type, size, width, height, created_at)
             VALUES (?,?,?,?,?,?,?,?,?)`
          ).run(id, req.user.id, key, req.file.originalname, detected.mime, buffer.length, dims.width, dims.height, now());
          audit(db, req.user.id, 'upload.create', 'upload', id);

          res.status(201).json({
            id,
            name: req.file.originalname,
            url: imageContentUrl(ctx, req.user.id, id),
            width: dims.width,
            height: dims.height,
            sizeKb: Math.max(1, Math.round(buffer.length / 1024)),
            mime: detected.mime,
          });
        } catch (e) {
          next(e);
        }
      })();
    });
  });

  /* 删除(仅当无记录引用时) */
  router.delete('/:id', async (req, res, next) => {
    try {
      const row = db.prepare('SELECT * FROM uploads WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(req.params.id, req.user.id);
      if (!row) throw notFound('UPLOAD_NOT_FOUND', '图片不存在');
      const refs = db.prepare('SELECT COUNT(*) AS n FROM record_images WHERE upload_id = ?').get(row.id).n;
      if (refs > 0) throw conflict('UPLOAD_IN_USE', '该图片正被分析记录引用,不能删除');
      await storage.remove(row.storage_key);
      db.prepare('UPDATE uploads SET deleted_at = ? WHERE id = ?').run(now(), row.id);
      audit(db, req.user.id, 'upload.delete', 'upload', row.id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/* 图片内容路由:签名 token 或 Bearer 任一有效即可(无公网直链,防越权访问) */
export function uploadsContentRouter(ctx) {
  const router = express.Router();
  const { db, storage, config } = ctx;

  router.get('/:id/content', async (req, res, next) => {
    try {
      const row = db.prepare('SELECT * FROM uploads WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
      if (!row) throw notFound('UPLOAD_NOT_FOUND', '图片不存在');

      // 鉴权通道一:Bearer(API 客户端)
      let authed = false;
      let bearerUserId = null; // 通过 Bearer 认证的用户(可能不是资源属主)
      const header = req.headers.authorization || '';
      const match = header.match(/^Bearer\s+(.+)$/i);
      if (match) {
        const { userId } = verifyAccessToken(config.jwt.secret, match[1]);
        bearerUserId = userId || null;
        authed = !!userId && userId === row.user_id;
      }
      // 鉴权通道二:签名 URL(<img> 标签)
      if (!authed && req.query.token) {
        authed = verifyImageToken(config.jwt.secret, String(req.query.token), row.id, row.user_id);
      }
      if (!authed) {
        // 已登录但资源不属于当前用户 → 404(与资源不存在完全一致,防止越权探测);
        // 未认证 / 令牌无效 → 401
        if (bearerUserId) throw notFound('UPLOAD_NOT_FOUND', '图片不存在');
        throw unauthorized('UNAUTHORIZED', '未登录或登录已失效');
      }

      if (storage.kind === 's3') {
        const url = await storage.getUrl(row.storage_key);
        if (!url) throw notFound('UPLOAD_NOT_FOUND', '图片不存在');
        return res.redirect(url);
      }
      const buf = await storage.get(row.storage_key);
      if (!buf) throw notFound('UPLOAD_NOT_FOUND', '图片文件已丢失');
      res
        .set('Content-Type', row.mime_type)
        .set('Cache-Control', 'private, max-age=86400')
        .send(buf);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
