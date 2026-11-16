/* 认证链路:注册/登录/刷新轮换/复用检测/登出/账号管理 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeCtx, registerUser, authHeader } from './helpers.js';

describe('auth', () => {
  it('注册 → 登录 → 访问受保护接口 → 登出', async () => {
    const { app, cleanup } = makeCtx();
    try {
      const reg = await request(app).post('/api/auth/register').send({ name: '林晓', email: 'lin@test.local', password: 'password123' });
      expect(reg.status).toBe(201);
      expect(reg.body.user.name).toBe('林晓');
      expect(reg.body.accessToken).toBeTruthy();
      expect(reg.body.refreshToken).toBeTruthy();

      // 未登录访问 → 401
      const noAuth = await request(app).get('/api/folders');
      expect(noAuth.status).toBe(401);

      // 登录成功
      const login = await request(app).post('/api/auth/login').send({ email: 'lin@test.local', password: 'password123' });
      expect(login.status).toBe(200);
      const me = await request(app).get('/api/me').set(authHeader(login.body));
      expect(me.status).toBe(200);
      expect(me.body.user.email).toBe('lin@test.local');

      // 登出后 refresh 被撤销
      const logout = await request(app).post('/api/auth/logout').send({ refreshToken: login.body.refreshToken });
      expect(logout.status).toBe(204);
      const refreshAfter = await request(app).post('/api/auth/refresh').send({ refreshToken: login.body.refreshToken });
      expect(refreshAfter.status).toBe(401);
    } finally {
      cleanup();
    }
  });

  it('注册默认创建「未整理」文件夹,重复邮箱 409', async () => {
    const { app, cleanup } = makeCtx();
    try {
      await registerUser(app, { email: 'dup@test.local' });
      const dup = await request(app).post('/api/auth/register').send({ name: '别人', email: 'dup@test.local', password: 'password123' });
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('EMAIL_TAKEN');

      const tokens = await registerUser(app);
      const folders = await request(app).get('/api/folders').set(authHeader(tokens));
      expect(folders.body.items.map((f) => f.id)).toContain('folder-inbox');
    } finally {
      cleanup();
    }
  });

  it('密码错误 401;弱密码 422', async () => {
    const { app, cleanup } = makeCtx();
    try {
      await registerUser(app, { email: 'pw@test.local' });
      const bad = await request(app).post('/api/auth/login').send({ email: 'pw@test.local', password: 'wrong-password' });
      expect(bad.status).toBe(401);
      expect(bad.body.error.code).toBe('INVALID_CREDENTIALS');

      const weak = await request(app).post('/api/auth/register').send({ name: 'x', email: 'weak@test.local', password: '123' });
      expect(weak.status).toBe(422);
    } finally {
      cleanup();
    }
  });

  it('refresh 轮换:旧令牌作废,新令牌可用', async () => {
    const { app, cleanup } = makeCtx();
    try {
      const tokens = await registerUser(app);
      const rotated = await request(app).post('/api/auth/refresh').send({ refreshToken: tokens.refreshToken });
      expect(rotated.status).toBe(200);
      expect(rotated.body.accessToken).toBeTruthy();
      expect(rotated.body.refreshToken).not.toBe(tokens.refreshToken);

      // 旧令牌已被轮换 → 按防重放设计返回 403(旧令牌不可再用;
      // 该动作同时撤销整个家族,家族级验证见下一个用例)
      const oldAgain = await request(app).post('/api/auth/refresh').send({ refreshToken: tokens.refreshToken });
      expect(oldAgain.status).toBe(403);
      expect(oldAgain.body.error.code).toBe('REFRESH_REUSE');
    } finally {
      cleanup();
    }
  });

  it('refresh 复用检测:轮换后旧令牌再次出现 → 撤销整个家族', async () => {
    const { app, cleanup } = makeCtx();
    try {
      const tokens = await registerUser(app);
      const first = await request(app).post('/api/auth/refresh').send({ refreshToken: tokens.refreshToken });
      expect(first.status).toBe(200);

      // 攻击者重放旧令牌 → 403 + 家族撤销
      const replay = await request(app).post('/api/auth/refresh').send({ refreshToken: tokens.refreshToken });
      expect(replay.status).toBe(403);
      expect(replay.body.error.code).toBe('REFRESH_REUSE');

      // 家族内最新令牌也一并失效
      const newest = await request(app).post('/api/auth/refresh').send({ refreshToken: first.body.refreshToken });
      expect(newest.status).toBe(401);
    } finally {
      cleanup();
    }
  });

  it('数据导出:包含文件夹/记录/待办/归档,不含密码哈希', async () => {
    const { app, cleanup } = makeCtx();
    try {
      const tokens = await registerUser(app);
      await request(app).post('/api/folders').set(authHeader(tokens)).send({ name: '工作' });
      await request(app).post('/api/tasks').set(authHeader(tokens)).send({ title: '写周报' });
      const res = await request(app).get('/api/me/export').set(authHeader(tokens));
      expect(res.status).toBe(200);
      expect(res.body.app).toBe('snaptask');
      expect(res.body.folders.some((f) => f.name === '工作')).toBe(true);
      expect(res.body.tasks.some((t) => t.title === '写周报')).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain('password');
    } finally {
      cleanup();
    }
  });

  it('改密码后旧 refresh 全部撤销;注销后数据清空且无法登录', async () => {
    const { app, ctx, cleanup } = makeCtx();
    try {
      const tokens = await registerUser(app, { email: 'wipe@test.local' });
      // 造一点数据
      await request(app).post('/api/folders').set(authHeader(tokens)).send({ name: '工作' });
      const recordsBefore = await request(app).get('/api/records').set(authHeader(tokens));
      expect(recordsBefore.status).toBe(200);

      const pw = await request(app).post('/api/me/password').set(authHeader(tokens)).send({ currentPassword: 'password123', newPassword: 'newpassword456' });
      expect(pw.status).toBe(200);
      const oldRefresh = await request(app).post('/api/auth/refresh').send({ refreshToken: tokens.refreshToken });
      expect(oldRefresh.status).toBe(401);

      // 用新密码登录 → 注销
      const login = await request(app).post('/api/auth/login').send({ email: 'wipe@test.local', password: 'newpassword456' });
      expect(login.status).toBe(200);
      const del = await request(app).delete('/api/me').set(authHeader(login.body));
      expect(del.status).toBe(204);

      // 注销后:登录 401、数据表已清空
      const relogin = await request(app).post('/api/auth/login').send({ email: 'wipe@test.local', password: 'newpassword456' });
      expect(relogin.status).toBe(401);
      expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM folders WHERE user_id = ?').get(login.body.user.id).n).toBe(0);
    } finally {
      cleanup();
    }
  });
});
