/* 认证:注册 / 登录 / 刷新 / 登出 / 账号管理 */

import express from 'express';
import { z } from 'zod';
import { now, tx, audit } from '../db.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import { signAccessToken, issueRefreshToken, rotateRefreshToken, revokeRefreshToken, revokeAllForUser } from '../auth/jwt.js';
import { validate } from '../middleware.js';
import { AppError, unauthorized, conflict, badRequest } from '../errors.js';
import { wipeUserData } from '../services/wipe.js';
import { recordListRow } from '../services/records.js';

const registerSchema = z.object({
  name: z.string().trim().min(1, '请输入称呼').max(32, '称呼最长 32 字'),
  email: z.string().trim().email('邮箱格式不正确').max(120),
  password: z.string().min(8, '密码至少 8 位').max(72, '密码最长 72 位'),
});
const loginSchema = z.object({
  email: z.string().trim().min(1, '请输入邮箱'),
  password: z.string().min(1, '请输入密码'),
});
const refreshSchema = z.object({ refreshToken: z.string().min(10) });
const nameSchema = z.object({ name: z.string().trim().min(1).max(32) });
const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, '新密码至少 8 位').max(72),
});

function publicUser(row) {
  return { id: row.id, name: row.name, email: row.email };
}

function tokenPair(ctx, userId) {
  const accessToken = signAccessToken(ctx.config.jwt.secret, userId, ctx.config.jwt.accessTtlSec);
  const refresh = issueRefreshToken(ctx.db, userId, ctx.config.jwt.refreshTtlDays);
  return { accessToken, refreshToken: refresh.token, expiresIn: ctx.config.jwt.accessTtlSec };
}

function findActiveUser(db, email) {
  return db.prepare('SELECT * FROM users WHERE email = ? AND deleted_at IS NULL').get(email.trim());
}

export function authRouter(ctx) {
  const router = express.Router();
  const { db, config } = ctx;

  router.post('/register', validate(registerSchema), async (req, res, next) => {
    try {
      const { name, email, password } = req.body;
      const exists = findActiveUser(db, email);
      if (exists) throw conflict('EMAIL_TAKEN', '该邮箱已注册,请直接登录');
      const passwordHash = await hashPassword(password);
      const userId = crypto.randomUUID();
      try {
        tx(db, () => {
          db.prepare('INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES (?,?,?,?,?,?)')
            .run(userId, email, name, passwordHash, now(), now());
          // 默认文件夹:未整理(前端约定 id 固定,不可删除)
          db.prepare('INSERT INTO folders (id, user_id, name, sort, created_at, updated_at) VALUES (?,?,?,?,?,?)')
            .run('folder-inbox', userId, '未整理', 0, now(), now());
          audit(db, userId, 'user.register', 'user', userId);
        });
      } catch (err) {
        if (String(err.message).includes('UNIQUE')) throw conflict('EMAIL_TAKEN', '该邮箱已注册,请直接登录');
        throw err;
      }
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      res.status(201).json({ user: publicUser(user), ...tokenPair(ctx, userId) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/login', validate(loginSchema), async (req, res, next) => {
    try {
      const { email, password } = req.body;
      const user = findActiveUser(db, email);
      if (!user) throw unauthorized('USER_NOT_FOUND', '该邮箱尚未注册,请先注册');
      const ok = await verifyPassword(password, user.password_hash);
      if (!ok) throw unauthorized('INVALID_PASSWORD', '密码不正确');
      audit(db, user.id, 'user.login', 'user', user.id);
      res.json({ user: publicUser(user), ...tokenPair(ctx, user.id) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/refresh', validate(refreshSchema), (req, res, next) => {
    try {
      const nextPair = rotateRefreshToken(db, req.body.refreshToken, config.jwt.refreshTtlDays);
      const user = db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(nextPair.userId);
      if (!user) throw unauthorized('ACCOUNT_DELETED', '账号已注销');
      const accessToken = signAccessToken(config.jwt.secret, user.id, config.jwt.accessTtlSec);
      res.json({ accessToken, refreshToken: nextPair.token, expiresIn: config.jwt.accessTtlSec, user: publicUser(user) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/logout', validate(refreshSchema), (req, res) => {
    revokeRefreshToken(db, req.body.refreshToken);
    res.status(204).end();
  });

  return router;
}

/* 需要登录的账号接口 */
export function meRouter(ctx) {
  const router = express.Router();
  const { db, config } = ctx;

  router.get('/', (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(req.user.id);
    if (!user) throw unauthorized();
    const storageBytes =
      db.prepare("SELECT COALESCE(SUM(size),0) AS s FROM uploads WHERE user_id = ? AND deleted_at IS NULL").get(user.id).s +
      db.prepare("SELECT COALESCE(SUM(size),0) AS s FROM archives WHERE user_id = ? AND deleted_at IS NULL").get(user.id).s;
    const day = new Date().toISOString().slice(0, 10);
    const usage = Object.fromEntries(
      db.prepare('SELECT kind, calls FROM daily_usage WHERE user_id = ? AND day = ?').all(user.id, day).map((r) => [r.kind, r.calls])
    );
    res.json({
      user: publicUser(user),
      storage: { usedBytes: storageBytes },
      quotas: {
        ocr: { used: usage.ocr || 0, limit: config.ocr.dailyLimit },
        vision: { used: usage.vision || 0, limit: config.vision.dailyLimit },
      },
    });
  });

  router.patch('/', validate(nameSchema), (req, res) => {
    db.prepare('UPDATE users SET name = ?, updated_at = ? WHERE id = ?').run(req.body.name, now(), req.user.id);
    audit(db, req.user.id, 'user.update', 'user', req.user.id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({ user: publicUser(user) });
  });

  router.post('/password', validate(passwordSchema), async (req, res, next) => {
    try {
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
      const ok = await verifyPassword(req.body.currentPassword, user.password_hash);
      if (!ok) throw badRequest('WRONG_PASSWORD', '当前密码不正确');
      const passwordHash = await hashPassword(req.body.newPassword);
      tx(db, () => {
        db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, now(), user.id);
        revokeAllForUser(db, user.id);
        audit(db, user.id, 'user.password_change', 'user', user.id);
      });
      // 改密后重新签发令牌,当前会话保持
      res.json({ ...tokenPair(ctx, user.id) });
    } catch (err) {
      next(err);
    }
  });

  /* 数据导出:全量结构化数据(记录含 result;原图文件不包含,见 docs/ROADMAP.md) */
  router.get('/export', (req, res) => {
    const userId = req.user.id;
    const parse = (text, fallback) => {
      try {
        return text ? JSON.parse(text) : fallback;
      } catch {
        return fallback;
      }
    };
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    const folders = db
      .prepare('SELECT id, name, parent_id AS parentId, sort, created_at AS createdAt FROM folders WHERE user_id = ? AND deleted_at IS NULL ORDER BY sort, created_at')
      .all(userId);
    const recordRow = (r) => ({ ...recordListRow(r), result: parse(r.result, null), isDeleted: !!r.is_deleted, deletedAt: r.deleted_at });
    const records = db
      .prepare('SELECT * FROM records WHERE user_id = ? AND is_deleted = 0 ORDER BY saved_at DESC')
      .all(userId)
      .map(recordRow);
    const recycle = db
      .prepare('SELECT * FROM records WHERE user_id = ? AND is_deleted = 1 ORDER BY deleted_at DESC')
      .all(userId)
      .map(recordRow);
    const tasks = db
      .prepare('SELECT * FROM urgent_tasks WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC')
      .all(userId)
      .map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        assignee: t.assignee,
        dueDate: parse(t.due_date, null),
        priority: t.priority,
        status: t.status,
        done: !!t.done,
        src: parse(t.src, []),
        source: t.source,
        recordId: t.record_id,
        createdAt: t.created_at,
      }));
    const archives = db
      .prepare('SELECT * FROM archives WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC')
      .all(userId)
      .map((a) => ({ id: a.id, title: a.title, note: a.note, link: a.link, originalName: a.original_name, mimeType: a.mime_type, size: a.size, createdAt: a.created_at }));
    audit(db, userId, 'user.export', 'user', userId);
    res.json({
      app: 'snaptask',
      version: 1,
      exportedAt: new Date().toISOString(),
      user: publicUser(user),
      folders,
      records,
      recycle,
      tasks,
      archives,
    });
  });

  router.delete('/', async (req, res, next) => {
    try {
      await wipeUserData(ctx, req.user.id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
