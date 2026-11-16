/* 回收站:列表(含剩余天数)、恢复、彻底删除。访问前先惰性清理过期项。 */

import express from 'express';
import { now } from '../db.js';
import { notFound } from '../errors.js';
import { restoreRecord, hardDeleteRecord } from '../services/records.js';
import { purgeRecycle } from '../services/cleanup.js';

export function recycleRouter(ctx) {
  const router = express.Router();
  const { db, config } = ctx;

  router.get('/', async (req, res, next) => {
    try {
      await purgeRecycle(ctx);
      const retentionMs = (config.business.recycleRetentionDays || 30) * 24 * 3600 * 1000;
      const rows = db
        .prepare('SELECT * FROM records WHERE user_id = ? AND is_deleted = 1 ORDER BY deleted_at DESC')
        .all(req.user.id);
      const items = rows.map((r) => ({
        id: r.id,
        title: r.title || '未命名分析',
        folderId: r.folder_id,
        imageCount: r.image_count,
        savedAt: r.saved_at,
        deletedAt: r.deleted_at,
        daysLeft: r.deleted_at ? Math.max(0, Math.ceil((r.deleted_at + retentionMs - now()) / 86400000)) : null,
      }));
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:recordId/restore', (req, res, next) => {
    try {
      restoreRecord(db, req.user.id, req.params.recordId);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:recordId', (req, res, next) => {
    const row = db.prepare('SELECT id FROM records WHERE id = ? AND user_id = ? AND is_deleted = 1').get(req.params.recordId, req.user.id);
    if (!row) return next(notFound('RECORD_NOT_FOUND', '记录不存在或不在回收站'));
    hardDeleteRecord(ctx, req.user.id, req.params.recordId)
      .then(() => res.status(204).end())
      .catch(next);
  });

  return router;
}
