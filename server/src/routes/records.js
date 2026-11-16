/* 记录(历史记录)CRUD:列表分页/详情/保存/编辑/软删/恢复/彻底删除 */

import express from 'express';
import { z } from 'zod';
import { now, tx, audit } from '../db.js';
import { validate } from '../middleware.js';
import { notFound, badRequest } from '../errors.js';
import { computeContentTags, getRecordWithImages, recordListRow, softDeleteRecord, restoreRecord, hardDeleteRecord } from '../services/records.js';

const imageRefSchema = z.object({
  id: z.string().nullable().optional(),
  name: z.string().optional().default(''),
  width: z.number().int().nullable().optional(),
  height: z.number().int().nullable().optional(),
  sizeKb: z.number().nullable().optional(),
  legendIndex: z.number().int().nullable().optional(),
  quality: z.any().optional(),
  regions: z.array(z.any()).optional().default([]),
});

const saveSchema = z.object({
  title: z.string().max(200).optional(),
  folderId: z.string().optional(),
  savedAt: z.number().int().optional(),
  images: z.array(imageRefSchema).max(6).optional().default([]),
  result: z.record(z.string(), z.any()).default({}),
});

const patchSchema = z.object({
  title: z.string().max(200).optional(),
  folderId: z.string().optional(),
  result: z.record(z.string(), z.any()).optional(),
  images: z.array(imageRefSchema).max(6).optional(),
});

function ensureFolder(db, userId, folderId) {
  if (!folderId) return 'folder-inbox';
  const folder = db.prepare('SELECT id FROM folders WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(folderId, userId);
  return folder ? folder.id : 'folder-inbox';
}

function assertUploadsOwned(db, userId, images) {
  for (const img of images) {
    if (!img.id) continue; // 纯文本记录允许无图
    const up = db.prepare('SELECT id FROM uploads WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(img.id, userId);
    if (!up) throw badRequest('UPLOAD_NOT_FOUND', `图幅 ${img.id} 不存在或不属于当前账号`);
  }
}

function insertRecordImages(db, recordId, images) {
  const insert = db.prepare(
    `INSERT INTO record_images (id, record_id, upload_id, name, width, height, size_kb, legend_index, quality, regions, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  );
  images.forEach((img, idx) => {
    insert.run(
      crypto.randomUUID(),
      recordId,
      img.id || null,
      img.name || '',
      img.width ?? null,
      img.height ?? null,
      img.sizeKb ?? null,
      img.legendIndex ?? idx + 1,
      img.quality ? JSON.stringify(img.quality) : null,
      JSON.stringify(img.regions || []),
      now()
    );
  });
}

/* 键集分页游标:[savedAt, id] */
function encodeCursor(savedAt, id) {
  return Buffer.from(JSON.stringify([savedAt, id])).toString('base64url');
}
function decodeCursor(cursor) {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    return Array.isArray(parsed) && parsed.length === 2 ? parsed : null;
  } catch {
    return null;
  }
}

export function recordsRouter(ctx) {
  const router = express.Router();
  const { db } = ctx;

  /* 列表:搜索/筛选/排序/分页 */
  router.get('/', (req, res, next) => {
    try {
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50', 10) || 50));
      const sort = req.query.sort === 'oldest' ? 'oldest' : 'newest';
      const conditions = ['r.user_id = ?', 'r.is_deleted = 0'];
      const params = [req.user.id];
      if (req.query.folderId) {
        conditions.push('r.folder_id = ?');
        params.push(req.query.folderId);
      }
      if (req.query.q) {
        conditions.push('(r.title LIKE ? OR r.result LIKE ?)');
        params.push(`%${req.query.q}%`, `%${req.query.q}%`);
      }
      if (req.query.tag === 'task') {
        conditions.push("r.content_tags LIKE '%待办%'");
      } else if (req.query.tag === 'info') {
        conditions.push("r.content_tags LIKE '%资料%'");
      }
      const cursor = decodeCursor(req.query.cursor || '');
      if (cursor) {
        const [savedAt, id] = cursor;
        conditions.push(
          sort === 'newest'
            ? '(r.saved_at < ? OR (r.saved_at = ? AND r.id < ?))'
            : '(r.saved_at > ? OR (r.saved_at = ? AND r.id > ?))'
        );
        params.push(savedAt, savedAt, id);
      }
      const where = conditions.join(' AND ');
      const order = sort === 'newest' ? 'r.saved_at DESC, r.id DESC' : 'r.saved_at ASC, r.id ASC';
      const rows = db
        .prepare(`SELECT * FROM records r WHERE ${where} ORDER BY ${order} LIMIT ?`)
        .all(...params, limit + 1);
      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit).map(recordListRow);
      const nextCursor = hasMore && items.length ? encodeCursor(items[items.length - 1].savedAt, items[items.length - 1].id) : null;
      res.json({ items, nextCursor });
    } catch (err) {
      next(err);
    }
  });

  /* 详情:图幅 + result */
  router.get('/:id', (req, res, next) => {
    try {
      const record = getRecordWithImages(ctx,req.user.id, req.params.id);
      if (!record) throw notFound('RECORD_NOT_FOUND', '记录不存在');
      res.json(record);
    } catch (err) {
      next(err);
    }
  });

  /* 保存分析结果 */
  router.post('/', validate(saveSchema), (req, res, next) => {
    try {
      const { title, folderId, savedAt, images, result } = req.body;
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        throw badRequest('RESULT_INVALID', '分析结果不能为空');
      }
      assertUploadsOwned(db, req.user.id, images);
      const folder = ensureFolder(db, req.user.id, folderId);
      const id = crypto.randomUUID();
      const savedAtFinal = savedAt || now();
      const contentTags = computeContentTags(result);
      tx(db, () => {
        db.prepare(
          `INSERT INTO records (id, user_id, folder_id, title, image_count, content_tags, saved_at, result, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`
        ).run(
          id,
          req.user.id,
          folder,
          title || '未命名分析',
          images.length,
          JSON.stringify(contentTags),
          savedAtFinal,
          JSON.stringify(result),
          now(),
          now()
        );
        insertRecordImages(db, id, images);
        audit(db, req.user.id, 'record.create', 'record', id);
      });
      res.status(201).json(getRecordWithImages(ctx,req.user.id, id));
    } catch (err) {
      next(err);
    }
  });

  /* 编辑:标题/移动/结果更新(任务修改关联原始记录)/图幅替换 */
  router.patch('/:id', validate(patchSchema), (req, res, next) => {
    try {
      const record = db.prepare('SELECT * FROM records WHERE id = ? AND user_id = ? AND is_deleted = 0').get(req.params.id, req.user.id);
      if (!record) throw notFound('RECORD_NOT_FOUND', '记录不存在');
      const { title, folderId, result, images } = req.body;
      if (images) assertUploadsOwned(db, req.user.id, images);
      const folder = folderId !== undefined ? ensureFolder(db, req.user.id, folderId) : record.folder_id;
      const nextVersion = record.version + 1;

      tx(db, () => {
        db.prepare(
          `UPDATE records SET
             title = ?, folder_id = ?, result = ?, image_count = ?, content_tags = ?, version = ?, updated_at = ?
           WHERE id = ?`
        ).run(
          title !== undefined ? title : record.title,
          folder,
          result !== undefined ? JSON.stringify(result) : record.result,
          images ? images.length : record.image_count,
          result !== undefined ? JSON.stringify(computeContentTags(result)) : record.content_tags,
          nextVersion,
          now(),
          record.id
        );
        if (images) {
          db.prepare('DELETE FROM record_images WHERE record_id = ?').run(record.id);
          insertRecordImages(db, record.id, images);
        }
        audit(db, req.user.id, 'record.update', 'record', record.id);
      });
      res.json(getRecordWithImages(ctx,req.user.id, record.id));
    } catch (err) {
      next(err);
    }
  });

  /* 软删除 → 回收站 */
  router.delete('/:id', (req, res, next) => {
    try {
      if (req.query.permanent === 'true') {
        return hardDeleteRecord(ctx, req.user.id, req.params.id)
          .then(() => res.status(204).end())
          .catch(next);
      }
      softDeleteRecord(db, req.user.id, req.params.id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  /* 恢复 */
  router.post('/:id/restore', (req, res, next) => {
    try {
      restoreRecord(db, req.user.id, req.params.id);
      res.json(getRecordWithImages(ctx,req.user.id, req.params.id));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
