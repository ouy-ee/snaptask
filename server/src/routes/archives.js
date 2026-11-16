/* 归档文件:文件上传(白名单+魔数校验)或外链;鉴权下载 */

import express from 'express';
import { z } from 'zod';
import { fileTypeFromBuffer } from 'file-type';
import { now, audit } from '../db.js';
import { memoryUpload, validate } from '../middleware.js';
import { badRequest, notFound } from '../errors.js';
import { storageKeyFor } from '../storage/index.js';

/* 归档允许的文档类型(扩展名 → mime) */
const ALLOWED_DOCS = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

const ARCHIVE_MAX_BYTES = 20 * 1024 * 1024;
const linkSchema = z.object({
  title: z.string().trim().min(1, '请输入标题').max(200),
  note: z.string().max(2000).optional().default(''),
  link: z.string().url('链接格式不正确').refine((v) => /^https?:\/\//i.test(v), '仅支持 http/https 链接'),
});
const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  note: z.string().max(2000).optional(),
});

function extOf(filename) {
  const m = /\.([a-zA-Z0-9]+)$/.exec(filename || '');
  return m ? m[1].toLowerCase() : null;
}

function rowToArchive(row) {
  return {
    id: row.id,
    title: row.title,
    note: row.note || '',
    link: row.link,
    size: row.size,
    originalName: row.original_name,
    mimeType: row.mime_type,
    format: row.link ? '外链' : row.original_name ? `${(extOf(row.original_name) || 'file').toUpperCase()}` : '文件',
    hasFile: !!row.storage_key,
    downloadUrl: row.storage_key ? `/api/archives/${row.id}/download` : row.link || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function archivesRouter(ctx) {
  const router = express.Router();
  const { db, storage } = ctx;

  router.get('/', (req, res) => {
    const rows = db
      .prepare('SELECT * FROM archives WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC')
      .all(req.user.id);
    res.json({ items: rows.map(rowToArchive) });
  });

  /* 两种提交形式:multipart(带文件)或 JSON(外链)。按 Content-Type 区分。 */
  router.post('/', (req, res, next) => {
    memoryUpload('file', ARCHIVE_MAX_BYTES)(req, res, (err) => {
      if (err) return next(err);
      (async () => {
        try {
          const isMultipart = !!req.file || (req.headers['content-type'] || '').startsWith('multipart/form-data');
          if (isMultipart) {
            if (!req.file) throw badRequest('ARCHIVE_NO_FILE', '请选择要上传的文件');
            const ext = extOf(req.file.originalname);
            if (!ext || !ALLOWED_DOCS[ext]) {
              throw badRequest('ARCHIVE_TYPE_FORBIDDEN', `不支持的文件类型 .${ext || '?'},支持:${Object.keys(ALLOWED_DOCS).join('/')}`);
            }
            const detected = await fileTypeFromBuffer(req.file.buffer);
            if (detected && ['exe', 'dll', 'js', 'html', 'svg', 'bat', 'sh'].includes(detected.ext)) {
              throw badRequest('ARCHIVE_TYPE_FORBIDDEN', '检测到可执行/脚本内容,已拒绝');
            }
            const title = (req.body?.title || '').trim() || req.file.originalname.replace(/\.[^.]+$/, '');
            const note = (req.body?.note || '').trim();
            const id = crypto.randomUUID();
            const key = storageKeyFor(req.user.id, ext);
            await storage.put(key, req.file.buffer, ALLOWED_DOCS[ext]);
            db.prepare(
              `INSERT INTO archives (id, user_id, title, note, storage_key, original_name, mime_type, size, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)`
            ).run(id, req.user.id, title.slice(0, 200), note, key, req.file.originalname, ALLOWED_DOCS[ext], req.file.size, now(), now());
            audit(db, req.user.id, 'archive.create', 'archive', id);
            const row = db.prepare('SELECT * FROM archives WHERE id = ?').get(id);
            return res.status(201).json(rowToArchive(row));
          }
          const parsed = linkSchema.safeParse(req.body ?? {});
          if (!parsed.success) {
            return res.status(422).json({
              error: { code: 'VALIDATION', message: '参数校验失败', detail: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
            });
          }
          const { title, note, link } = parsed.data;
          const id = crypto.randomUUID();
          db.prepare(
            `INSERT INTO archives (id, user_id, title, note, link, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`
          ).run(id, req.user.id, title, note, link, now(), now());
          audit(db, req.user.id, 'archive.create_link', 'archive', id);
          const row = db.prepare('SELECT * FROM archives WHERE id = ?').get(id);
          res.status(201).json(rowToArchive(row));
        } catch (e) {
          next(e);
        }
      })();
    });
  });

  router.get('/:id/download', async (req, res, next) => {
    try {
      const row = db.prepare('SELECT * FROM archives WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(req.params.id, req.user.id);
      if (!row) throw notFound('ARCHIVE_NOT_FOUND', '归档文件不存在');
      if (row.link) return res.redirect(row.link);
      if (!row.storage_key) throw notFound('ARCHIVE_NOT_FOUND', '该归档没有可下载的文件');
      const buf = await storage.get(row.storage_key);
      if (!buf) throw notFound('ARCHIVE_NOT_FOUND', '文件已丢失');
      const encoded = encodeURIComponent(row.original_name || row.title || 'download');
      const mime = row.mime_type || 'application/octet-stream';
      // 文本类必须带 charset=utf-8,否则浏览器/系统记事本按本地编码(如 GBK)解析 → 中文乱码
      const isText = mime.startsWith('text/') || mime === 'application/json';
      const contentType = isText && !mime.includes('charset') ? `${mime}; charset=utf-8` : mime;
      // 文本类 inline(浏览器直接预览),其余 attachment(下载)
      const disposition = isText ? 'inline' : 'attachment';
      res
        .set('Content-Type', contentType)
        .set('Content-Disposition', `${disposition}; filename*=UTF-8''${encoded}`)
        .send(buf);
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id', validate(patchSchema), (req, res, next) => {
    try {
      const row = db.prepare('SELECT * FROM archives WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(req.params.id, req.user.id);
      if (!row) throw notFound('ARCHIVE_NOT_FOUND', '归档文件不存在');
      db.prepare('UPDATE archives SET title = ?, note = ?, updated_at = ? WHERE id = ?')
        .run(req.body.title !== undefined ? req.body.title : row.title, req.body.note !== undefined ? req.body.note : row.note, now(), row.id);
      audit(db, req.user.id, 'archive.update', 'archive', row.id);
      const updated = db.prepare('SELECT * FROM archives WHERE id = ?').get(row.id);
      res.json(rowToArchive(updated));
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const row = db.prepare('SELECT * FROM archives WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(req.params.id, req.user.id);
      if (!row) throw notFound('ARCHIVE_NOT_FOUND', '归档文件不存在');
      db.prepare('UPDATE archives SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), row.id);
      if (row.storage_key) await storage.remove(row.storage_key);
      audit(db, req.user.id, 'archive.delete', 'archive', row.id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
