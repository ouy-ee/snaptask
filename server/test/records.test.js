/* 记录:保存/详情/编辑(版本)/分页/软删恢复/彻底删除(引用计数)/越权隔离 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import { makeCtx, registerUser, authHeader, uploadPng } from './helpers.js';

function sampleResult(overrides = {}) {
  return {
    scenario: 'success',
    scene_type: 'TASK',
    content_tags: ['待办'],
    summary: { oneLiner: { text: '测试总结', src: [1] }, facts: [], inferences: [], suggestions: [] },
    facts: [],
    keyFacts: [],
    tasks: [{ id: 't-1', title: '任务一', description: '', assignee: null, dueDate: null, priority: 'high', status: 'todo', done: false, src: [1] }],
    comparison: { id: 'cmp-1', title: '', dims: [], rows: [] },
    warnings: [],
    ...overrides,
  };
}

describe('records', () => {
  it('保存 → 详情(图幅带鉴权 URL) → 编辑结果(version+1)', async () => {
    const { app, cleanup } = makeCtx();
    try {
      const tokens = await registerUser(app);
      const up = await uploadPng(app, tokens);
      const saved = await request(app).post('/api/records').set(authHeader(tokens)).send({
        title: '第一次分析',
        images: [{ id: up.body.id, name: 'shot.png', width: 4, height: 3, sizeKb: 1, legendIndex: 1 }],
        result: sampleResult(),
      });
      expect(saved.status).toBe(201);
      expect(saved.body.version).toBe(1);
      // 图片 URL 携带短时签名令牌(<img> 标签无法带 Bearer 头)
      expect(saved.body.images[0].url).toContain(`/api/uploads/${up.body.id}/content?token=`);

      const got = await request(app).get(`/api/records/${saved.body.id}`).set(authHeader(tokens));
      expect(got.body.result.tasks[0].title).toBe('任务一');

      // 任务修改 → PATCH result(真正关联原始分析记录)
      const next = sampleResult();
      next.tasks[0].title = '任务一(已改)';
      const patched = await request(app).patch(`/api/records/${saved.body.id}`).set(authHeader(tokens)).send({ result: next });
      expect(patched.status).toBe(200);
      expect(patched.body.version).toBe(2);
      expect(patched.body.result.tasks[0].title).toBe('任务一(已改)');
    } finally {
      cleanup();
    }
  });

  it('列表分页(键集游标)与筛选', async () => {
    const { app, cleanup } = makeCtx();
    try {
      const tokens = await registerUser(app);
      const up = await uploadPng(app, tokens);
      for (let i = 0; i < 5; i++) {
        await request(app).post('/api/records').set(authHeader(tokens)).send({
          title: `记录${i}`,
          images: [{ id: up.body.id, name: 'shot.png', legendIndex: 1 }],
          result: sampleResult(),
        });
      }
      const page1 = await request(app).get('/api/records?limit=3').set(authHeader(tokens));
      expect(page1.body.items.length).toBe(3);
      expect(page1.body.nextCursor).toBeTruthy();
      const page2 = await request(app).get(`/api/records?limit=3&cursor=${page1.body.nextCursor}`).set(authHeader(tokens));
      expect(page2.body.items.length).toBe(2);
      expect(page2.body.nextCursor).toBeNull();

      const q = await request(app).get('/api/records?q=记录3').set(authHeader(tokens));
      expect(q.body.items.length).toBe(1);
      expect(q.body.items[0].title).toBe('记录3');
    } finally {
      cleanup();
    }
  });

  it('软删除 → 回收站(含剩余天数) → 恢复 → 彻底删除并清理图片文件', async () => {
    const { app, ctx, cleanup } = makeCtx();
    try {
      const tokens = await registerUser(app);
      const up = await uploadPng(app, tokens);
      const saved = (await request(app).post('/api/records').set(authHeader(tokens)).send({
        title: '要删的记录',
        images: [{ id: up.body.id, name: 'shot.png', legendIndex: 1 }],
        result: sampleResult(),
      })).body;

      // 软删除
      const soft = await request(app).delete(`/api/records/${saved.id}`).set(authHeader(tokens));
      expect(soft.status).toBe(204);

      // 列表不含已删;回收站含
      const list = await request(app).get('/api/records').set(authHeader(tokens));
      expect(list.body.items.length).toBe(0);
      const trash = await request(app).get('/api/recycle-bin').set(authHeader(tokens));
      expect(trash.body.items.length).toBe(1);
      expect(typeof trash.body.items[0].daysLeft).toBe('number');

      // 恢复
      const restore = await request(app).post(`/api/recycle-bin/${saved.id}/restore`).set(authHeader(tokens));
      expect(restore.status).toBe(204);
      const list2 = await request(app).get('/api/records').set(authHeader(tokens));
      expect(list2.body.items.length).toBe(1);

      // 软删 → 彻底删除
      await request(app).delete(`/api/records/${saved.id}`).set(authHeader(tokens));
      const filesBefore = fs.readdirSync(ctx.config.uploadsDir, { recursive: true }).filter((f) => typeof f === 'string' && f.includes('-'));
      const hard = await request(app).delete(`/api/records/${saved.id}?permanent=true`).set(authHeader(tokens));
      expect(hard.status).toBe(204);
      // 引用归零的图片文件已删除
      const remaining = ctx.db.prepare('SELECT COUNT(*) AS n FROM uploads').get().n;
      expect(remaining).toBe(0);
      expect(filesBefore.length).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });

  it('越权隔离:他人记录 404;引用他人图片保存被拒', async () => {
    const { app, cleanup } = makeCtx();
    try {
      const a = await registerUser(app);
      const b = await registerUser(app);
      const up = await uploadPng(app, a);
      const saved = (await request(app).post('/api/records').set(authHeader(a)).send({
        title: 'A 的记录',
        images: [{ id: up.body.id, name: 'shot.png', legendIndex: 1 }],
        result: sampleResult(),
      })).body;

      const bGets = await request(app).get(`/api/records/${saved.id}`).set(authHeader(b));
      expect(bGets.status).toBe(404);

      const bSaves = await request(app).post('/api/records').set(authHeader(b)).send({
        title: '偷 A 的图',
        images: [{ id: up.body.id, name: 'shot.png', legendIndex: 1 }],
        result: sampleResult(),
      });
      expect(bSaves.status).toBe(400);
      expect(bSaves.body.error.code).toBe('UPLOAD_NOT_FOUND');

      // 图片内容接口同样隔离
      const bGetsContent = await request(app).get(`/api/uploads/${up.body.id}/content`).set(authHeader(b));
      expect(bGetsContent.status).toBe(404);
    } finally {
      cleanup();
    }
  });
});
