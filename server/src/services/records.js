/* 记录(历史记录)共享逻辑:序列化、软删/恢复/彻底删除事务 */

import { now, tx, audit } from '../db.js';
import { notFound } from '../errors.js';
import { imageContentUrl } from './imageUrl.js';

function safeParse(text, fallback = null) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

export function computeContentTags(result) {
  if (!result) return [];
  const tags = new Set(
    (Array.isArray(result.content_tags) ? result.content_tags : []).filter((t) => t === '待办' || t === '资料')
  );
  if (tags.size) return [...tags];
  const out = [];
  if (result.tasks?.length || result.summary?.suggestions?.length) out.push('待办');
  if (result.facts?.length || result.keyFacts?.length) out.push('资料');
  return out;
}

export function recordListRow(row) {
  return {
    id: row.id,
    title: row.title || '未命名分析',
    folderId: row.folder_id,
    imageCount: row.image_count,
    contentTags: safeParse(row.content_tags, []),
    savedAt: row.saved_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* 完整记录:图幅(含签名鉴权 URL)+ result */
export function getRecordWithImages(ctx, userId, recordId) {
  const { db } = ctx;
  const row = db.prepare('SELECT * FROM records WHERE id = ? AND user_id = ?').get(recordId, userId);
  if (!row) return null;
  const images = db
    .prepare(
      `SELECT ri.* FROM record_images ri
       WHERE ri.record_id = ? ORDER BY ri.legend_index, ri.created_at`
    )
    .all(recordId)
    .map((ri) => ({
      id: ri.upload_id || null,
      name: ri.name || '',
      url: ri.upload_id ? imageContentUrl(ctx, userId, ri.upload_id) : null,
      width: ri.width,
      height: ri.height,
      sizeKb: ri.size_kb,
      legendIndex: ri.legend_index,
      quality: safeParse(ri.quality, { score: null, label: '', issues: [] }),
      regions: safeParse(ri.regions, []),
    }));
  return {
    ...recordListRow(row),
    isDeleted: !!row.is_deleted,
    deletedAt: row.deleted_at,
    result: safeParse(row.result, null),
    images,
  };
}

/* 软删除 → 回收站 */
export function softDeleteRecord(db, userId, recordId) {
  const changed = db
    .prepare("UPDATE records SET is_deleted = 1, deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND is_deleted = 0")
    .run(now(), now(), recordId, userId).changes;
  if (changed === 0) throw notFound('RECORD_NOT_FOUND', '记录不存在');
  audit(db, userId, 'record.soft_delete', 'record', recordId);
}

/* 回收站恢复(文件夹已被删则移入 inbox) */
export function restoreRecord(db, userId, recordId) {
  const row = db.prepare('SELECT * FROM records WHERE id = ? AND user_id = ?').get(recordId, userId);
  if (!row || !row.is_deleted) throw notFound('RECORD_NOT_FOUND', '记录不存在或不在回收站');
  const folderOk = db
    .prepare('SELECT id FROM folders WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .get(row.folder_id, userId);
  const target = folderOk ? row.folder_id : 'folder-inbox';
  db.prepare('UPDATE records SET is_deleted = 0, deleted_at = NULL, folder_id = ?, updated_at = ? WHERE id = ?')
    .run(target, now(), recordId);
  audit(db, userId, 'record.restore', 'record', recordId);
}

/* 彻底删除:删记录(级联 record_images)→ 引用归零的 uploads 一并删文件 */
export async function hardDeleteRecord(ctx, userId, recordId) {
  const { db, storage } = ctx;
  const row = db.prepare('SELECT * FROM records WHERE id = ? AND user_id = ?').get(recordId, userId);
  if (!row) throw notFound('RECORD_NOT_FOUND', '记录不存在');

  const uploadIds = db
    .prepare('SELECT upload_id FROM record_images WHERE record_id = ? AND upload_id IS NOT NULL')
    .all(recordId)
    .map((r) => r.upload_id);
  const keysToRemove = [];

  tx(db, () => {
    db.prepare('DELETE FROM records WHERE id = ?').run(recordId); // 级联删 record_images
    for (const uid of uploadIds) {
      const refs = db.prepare('SELECT COUNT(*) AS n FROM record_images WHERE upload_id = ?').get(uid).n;
      if (refs === 0) {
        const up = db.prepare('SELECT storage_key FROM uploads WHERE id = ?').get(uid);
        db.prepare('DELETE FROM uploads WHERE id = ?').run(uid);
        if (up) keysToRemove.push(up.storage_key);
      }
    }
    audit(db, userId, 'record.hard_delete', 'record', recordId);
  });

  for (const key of keysToRemove) {
    try {
      await storage.remove(key);
    } catch {
      /* 删除失败仅记录,不影响事务结果 */
    }
  }
}
