/* 待办:CRUD + 结果页同步 upsert */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeCtx, registerUser, authHeader } from './helpers.js';

describe('tasks', () => {
  it('新建 → 勾选 → 编辑 → 删除', async () => {
    const { app, cleanup } = makeCtx();
    try {
      const tokens = await registerUser(app);
      const created = await request(app).post('/api/tasks').set(authHeader(tokens)).send({ title: '写周报', priority: 'high', source: '首页' });
      expect(created.status).toBe(201);
      expect(created.body.priority).toBe('high');

      const toggled = await request(app).patch(`/api/tasks/${created.body.id}`).set(authHeader(tokens)).send({ done: true });
      expect(toggled.body.done).toBe(true);
      expect(toggled.body.status).toBe('done');

      const renamed = await request(app).patch(`/api/tasks/${created.body.id}`).set(authHeader(tokens)).send({ title: '写月报' });
      expect(renamed.body.title).toBe('写月报');

      const del = await request(app).delete(`/api/tasks/${created.body.id}`).set(authHeader(tokens));
      expect(del.status).toBe(204);
      const list = await request(app).get('/api/tasks').set(authHeader(tokens));
      expect(list.body.items.length).toBe(0);
    } finally {
      cleanup();
    }
  });

  it('sync:已有 id 更新,新任务插入,返回全量列表', async () => {
    const { app, cleanup } = makeCtx();
    try {
      const tokens = await registerUser(app);
      const existing = (await request(app).post('/api/tasks').set(authHeader(tokens)).send({ title: '旧标题' })).body;

      const synced = await request(app).post('/api/tasks/sync').set(authHeader(tokens)).send({
        tasks: [
          { id: existing.id, title: '改过的标题', status: 'todo', done: false, recordId: 'rec-1' },
          { id: 't-new-1', title: '全新任务', priority: 'medium', status: 'todo', done: false },
        ],
      });
      expect(synced.status).toBe(200);
      const items = synced.body.items;
      expect(items.length).toBe(2);
      expect(items.find((t) => t.id === existing.id).title).toBe('改过的标题');
      expect(items.find((t) => t.id === existing.id).recordId).toBe('rec-1');
      expect(items.find((t) => t.title === '全新任务').id).toBe('t-new-1');
    } finally {
      cleanup();
    }
  });
});
