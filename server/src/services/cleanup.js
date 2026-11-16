/* 定时清理:回收站过期记录、孤儿上传(未被任何记录引用) */

import { now } from '../db.js';
import { hardDeleteRecord } from './records.js';

/* 回收站:超过保留期的记录彻底删除 */
export async function purgeRecycle(ctx) {
  const { db, config, logger } = ctx;
  const cutoff = now() - (config.business.recycleRetentionDays || 30) * 24 * 3600 * 1000;
  const expired = db
    .prepare('SELECT id, user_id FROM records WHERE is_deleted = 1 AND deleted_at IS NOT NULL AND deleted_at < ?')
    .all(cutoff);
  for (const row of expired) {
    try {
      await hardDeleteRecord(ctx, row.user_id, row.id);
    } catch (err) {
      logger.warn({ err: err.message, record: row.id }, '回收站清理失败');
    }
  }
  if (expired.length > 0) logger.info({ count: expired.length }, '回收站自动清理完成');
  return expired.length;
}

/* 孤儿上传:超过 TTL 小时且无任何记录引用 → 删除文件与行 */
export async function orphanUploadCleanup(ctx) {
  const { db, storage, config, logger } = ctx;
  const cutoff = now() - (config.business.orphanUploadTtlHours || 24) * 3600 * 1000;
  const rows = db
    .prepare(
      `SELECT u.id, u.storage_key FROM uploads u
       WHERE u.created_at < ? AND u.deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM record_images ri WHERE ri.upload_id = u.id)`
    )
    .all(cutoff);
  for (const row of rows) {
    try {
      db.prepare('UPDATE uploads SET deleted_at = ? WHERE id = ?').run(now(), row.id);
      await storage.remove(row.storage_key);
    } catch (err) {
      logger.warn({ err: err.message, upload: row.id }, '孤儿上传清理失败');
    }
  }
  if (rows.length > 0) logger.info({ count: rows.length }, '孤儿上传清理完成');
  return rows.length;
}

/* 过期刷新令牌清理(防止表无限膨胀) */
export function purgeExpiredTokens(ctx) {
  const { db } = ctx;
  const changed = db.prepare("DELETE FROM refresh_tokens WHERE expires_at < ? OR revoked_at < ?").run(now(), now() - 30 * 24 * 3600 * 1000).changes;
  if (changed > 0) ctx.logger.info({ count: changed }, '过期令牌清理完成');
  return changed;
}
