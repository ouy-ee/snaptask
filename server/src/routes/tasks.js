/* 首页待办:CRUD + 结果页批量同步(按 id upsert,关联 record_id) */

import express from 'express';
import { z } from 'zod';
import { now, tx, audit } from '../db.js';
import { validate } from '../middleware.js';
import { notFound } from '../errors.js';

const taskSchema = z.object({
  title: z.string().trim().min(1, '请输入待办名称').max(200),
  description: z.string().max(1000).optional().default(''),
  assignee: z.string().max(50).nullable().optional(),
  dueDate: z.union([z.string(), z.object({ conflict: z.literal(true), values: z.array(z.any()) })]).nullable().optional(),
  priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
  status: z.enum(['todo', 'doing', 'done']).optional().default('todo'),
  done: z.boolean().optional().default(false),
  source: z.string().max(50).optional(),
  recordId: z.string().optional(),
});

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  assignee: z.string().max(50).nullable().optional(),
  dueDate: z.union([z.string(), z.object({ conflict: z.literal(true), values: z.array(z.any()) })]).nullable().optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  status: z.enum(['todo', 'doing', 'done']).optional(),
  done: z.boolean().optional(),
  source: z.string().max(50).optional(),
});

const syncSchema = z.object({ tasks: z.array(z.object({ id: z.string().optional(), title: z.string().min(1).max(200), description: z.string().optional().default(''), assignee: z.string().nullable().optional(), dueDate: z.any().nullable().optional(), priority: z.string().optional().default('medium'), status: z.string().optional().default('todo'), done: z.boolean().optional().default(false), source: z.string().optional(), recordId: z.string().optional() })).max(200) });

function serializeDue(d) {
  return typeof d === 'string' ? d : d == null ? null : JSON.stringify(d);
}
function parseDue(text) {
  if (!text) return null;
  if (text.startsWith('{')) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  return text;
}

function rowToTask(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    assignee: row.assignee,
    dueDate: parseDue(row.due_date),
    priority: row.priority,
    status: row.status,
    done: !!row.done,
    src: JSON.parse(row.src || '[]'),
    source: row.source,
    recordId: row.record_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function insertTask(db, userId, data, id = crypto.randomUUID()) {
  const done = data.done === true || data.status === 'done';
  const status = done ? 'done' : ['todo', 'doing', 'done'].includes(data.status) ? data.status : 'todo';
  db.prepare(
    `INSERT INTO urgent_tasks (id, user_id, title, description, assignee, due_date, priority, status, done, src, source, record_id, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id,
    userId,
    data.title,
    data.description || '',
    data.assignee ?? null,
    serializeDue(data.dueDate ?? null),
    data.priority || 'medium',
    status,
    done ? 1 : 0,
    JSON.stringify(data.src || []),
    data.source ?? null,
    data.recordId ?? null,
    now(),
    now()
  );
  return id;
}

export function tasksRouter(ctx) {
  const router = express.Router();
  const { db } = ctx;

  router.get('/', (req, res) => {
    const rows = db
      .prepare('SELECT * FROM urgent_tasks WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 500')
      .all(req.user.id);
    res.json({ items: rows.map(rowToTask) });
  });

  router.post('/', validate(taskSchema), (req, res) => {
    const id = insertTask(db, req.user.id, req.body);
    audit(db, req.user.id, 'task.create', 'task', id);
    const row = db.prepare('SELECT * FROM urgent_tasks WHERE id = ?').get(id);
    res.status(201).json(rowToTask(row));
  });

  /* 结果页批量同步:按 id upsert(仅限本人已有任务),无 id 或不存在则新建 */
  router.post('/sync', validate(syncSchema), (req, res, next) => {
    try {
      tx(db, () => {
        for (const t of req.body.tasks) {
          const existing = t.id
            ? db.prepare('SELECT id FROM urgent_tasks WHERE id = ? AND user_id = ?').get(t.id, req.user.id)
            : null;
          if (existing) {
            const done = t.done === true || t.status === 'done';
            db.prepare(
              `UPDATE urgent_tasks SET title=?, description=?, assignee=?, due_date=?, priority=?, status=?, done=?, source=?, record_id=?, updated_at=?
               WHERE id=? AND user_id=?`
            ).run(
              t.title,
              t.description || '',
              t.assignee ?? null,
              serializeDue(t.dueDate ?? null),
              t.priority || 'medium',
              done ? 'done' : ['todo', 'doing', 'done'].includes(t.status) ? t.status : 'todo',
              done ? 1 : 0,
              t.source ?? null,
              t.recordId ?? null,
              now(),
              t.id,
              req.user.id
            );
          } else {
            insertTask(db, req.user.id, t, t.id); // 保留客户端传入的 id(如结果页 t-1)
          }
        }
        audit(db, req.user.id, 'task.sync', 'task', null);
      });
      const rows = db.prepare('SELECT * FROM urgent_tasks WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 500').all(req.user.id);
      res.json({ items: rows.map(rowToTask) });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id', validate(patchSchema), (req, res, next) => {
    try {
      const row = db.prepare('SELECT * FROM urgent_tasks WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(req.params.id, req.user.id);
      if (!row) throw notFound('TASK_NOT_FOUND', '待办不存在');
      const p = req.body;
      const done = p.done !== undefined ? p.done : p.status !== undefined ? p.status === 'done' : row.done === 1;
      const status = p.status !== undefined
        ? (p.status === 'done' ? 'done' : p.status)
        : done ? 'done' : row.status;
      db.prepare(
        `UPDATE urgent_tasks SET title=?, description=?, assignee=?, due_date=?, priority=?, status=?, done=?, source=?, updated_at=?
         WHERE id=? AND user_id=?`
      ).run(
        p.title !== undefined ? p.title : row.title,
        p.description !== undefined ? p.description : row.description,
        p.assignee !== undefined ? p.assignee : row.assignee,
        p.dueDate !== undefined ? serializeDue(p.dueDate) : row.due_date,
        p.priority || row.priority,
        status,
        done ? 1 : 0,
        p.source !== undefined ? p.source : row.source,
        now(),
        row.id,
        req.user.id
      );
      audit(db, req.user.id, 'task.update', 'task', row.id);
      const updated = db.prepare('SELECT * FROM urgent_tasks WHERE id = ?').get(row.id);
      res.json(rowToTask(updated));
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', (req, res, next) => {
    try {
      const changed = db
        .prepare('UPDATE urgent_tasks SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
        .run(now(), req.params.id, req.user.id).changes;
      if (changed === 0) throw notFound('TASK_NOT_FOUND', '待办不存在');
      audit(db, req.user.id, 'task.delete', 'task', req.params.id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
