/* 文件夹 CRUD。删除文件夹 = 事务:其下记录移入未整理。 */

import express from 'express';
import { z } from 'zod';
import { now, tx, audit } from '../db.js';
import { validate } from '../middleware.js';
import { notFound, conflict, badRequest } from '../errors.js';

const createSchema = z.object({ name: z.string().trim().min(1, '请输入文件夹名称').max(30, '文件夹名称最长 30 字') });
const renameSchema = createSchema;

export function foldersRouter(ctx) {
  const router = express.Router();
  const { db } = ctx;

  router.get('/', (req, res) => {
    const folders = db
      .prepare(
        `SELECT f.id, f.name, f.parent_id AS parentId, f.sort, f.created_at AS createdAt,
                (SELECT COUNT(*) FROM records r WHERE r.folder_id = f.id AND r.is_deleted = 0) AS recordCount
         FROM folders f WHERE f.user_id = ? AND f.deleted_at IS NULL ORDER BY f.sort, f.created_at`
      )
      .all(req.user.id)
      .map((f) => ({ id: f.id, name: f.name, parentId: f.parentId, sort: f.sort, recordCount: f.recordCount, createdAt: f.createdAt }));
    res.json({ items: folders });
  });

  router.post('/', validate(createSchema), (req, res, next) => {
    try {
      const name = req.body.name;
      const dup = db.prepare('SELECT id FROM folders WHERE user_id = ? AND name = ? AND deleted_at IS NULL').get(req.user.id, name);
      if (dup) throw conflict('FOLDER_DUP', '文件夹名称已存在');
      const id = crypto.randomUUID();
      tx(db, () => {
        db.prepare('INSERT INTO folders (id, user_id, name, sort, created_at, updated_at) VALUES (?,?,?,?,?,?)')
          .run(id, req.user.id, name, now(), now(), now());
        audit(db, req.user.id, 'folder.create', 'folder', id);
      });
      const row = db.prepare('SELECT * FROM folders WHERE id = ?').get(id);
      res.status(201).json({ id: row.id, name: row.name, parentId: row.parent_id, recordCount: 0, createdAt: row.created_at });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id', validate(renameSchema), (req, res, next) => {
    try {
      const name = req.body.name;
      const folder = db.prepare('SELECT * FROM folders WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(req.params.id, req.user.id);
      if (!folder) throw notFound('FOLDER_NOT_FOUND', '文件夹不存在');
      const dup = db
        .prepare('SELECT id FROM folders WHERE user_id = ? AND name = ? AND deleted_at IS NULL AND id != ?')
        .get(req.user.id, name, folder.id);
      if (dup) throw conflict('FOLDER_DUP', '文件夹名称已存在');
      db.prepare('UPDATE folders SET name = ?, updated_at = ? WHERE id = ?').run(name, now(), folder.id);
      audit(db, req.user.id, 'folder.rename', 'folder', folder.id);
      res.json({ id: folder.id, name });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', (req, res, next) => {
    try {
      const id = req.params.id;
      if (id === 'folder-inbox') throw badRequest('INBOX_PROTECTED', '默认文件夹不能删除');
      const folder = db.prepare('SELECT * FROM folders WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(id, req.user.id);
      if (!folder) throw notFound('FOLDER_NOT_FOUND', '文件夹不存在');
      const moved = tx(db, () => {
        const movedCount = db
          .prepare("UPDATE records SET folder_id = 'folder-inbox', updated_at = ? WHERE user_id = ? AND folder_id = ? AND is_deleted = 0")
          .run(now(), req.user.id, id).changes;
        db.prepare('UPDATE folders SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id);
        audit(db, req.user.id, 'folder.delete', 'folder', id);
        return movedCount;
      });
      res.json({ deleted: true, movedToInbox: moved });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
