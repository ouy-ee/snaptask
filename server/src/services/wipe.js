/* 账号注销:数据擦除(隐私合规,DELETE /api/me) */

import { now, tx, audit } from '../db.js';

export async function wipeUserData(ctx, userId) {
  const { db, storage, logger } = ctx;

  const uploadKeys = db.prepare('SELECT storage_key FROM uploads WHERE user_id = ? AND storage_key IS NOT NULL').all(userId);
  const archiveKeys = db.prepare('SELECT storage_key FROM archives WHERE user_id = ? AND storage_key IS NOT NULL').all(userId);

  tx(db, () => {
    db.prepare('DELETE FROM records WHERE user_id = ?').run(userId); // 级联 record_images
    db.prepare('DELETE FROM uploads WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM folders WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM urgent_tasks WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM archives WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM analysis_jobs WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM daily_usage WHERE user_id = ?').run(userId);
    db.prepare('UPDATE users SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), userId);
    audit(db, userId, 'user.wipe', 'user', userId);
  });

  const keys = [...uploadKeys.map((r) => r.storage_key), ...archiveKeys.map((r) => r.storage_key)];
  for (const key of keys) {
    try {
      await storage.remove(key);
    } catch (err) {
      logger.warn({ err: err.message, key }, '注销数据擦除失败');
    }
  }
}
