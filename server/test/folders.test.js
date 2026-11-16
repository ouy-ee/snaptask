/* 文件夹:CRUD、重名冲突、删除事务(记录移入未整理)、inbox 保护、越权隔离 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeCtx, registerUser, authHeader, uploadPng } from './helpers.js';

async function saveRecord(app, tokens, folderId) {
  const up = await uploadPng(app, tokens);
  const res = await request(app)
    .post('/api/records')
    .set(authHeader(tokens))
    .send({
      title: '测试分析',
      folderId,
      images: [{ id: up.body.id, name: 'shot.png', width: 4, height: 3, sizeKb: 1, legendIndex: 1 }],
      result: { scenario: 'success', content_tags: ['待办'], summary: { oneLiner: { text: 'x', src: [] }, facts: [], inferences: [], suggestions: [] }, facts: [], keyFacts: [], tasks: [], comparison: { dims: [], rows: [] }, warnings: [] },
    });
  return { record: res.body, uploadId: up.body.id };
}

describe('folders', () => {
  it('创建/重命名/重名冲突', async () => {
    const { app, cleanup } = makeCtx();
    try {
      const tokens = await registerUser(app);
      const created = await request(app).post('/api/folders').set(authHeader(tokens)).send({ name: '工作' });
      expect(created.status).toBe(201);

      const dup = await request(app).post('/api/folders').set(authHeader(tokens)).send({ name: '工作' });
      expect(dup.status).toBe(409);

      const renamed = await request(app).patch(`/api/folders/${created.body.id}`).set(authHeader(tokens)).send({ name: '工作2' });
      expect(renamed.status).toBe(200);
      expect(renamed.body.name).toBe('工作2');
    } finally {
      cleanup();
    }
  });

  it('删除文件夹:其下记录移入未整理(事务)', async () => {
    const { app, cleanup } = makeCtx();
    try {
      const tokens = await registerUser(app);
      const folder = (await request(app).post('/api/folders').set(authHeader(tokens)).send({ name: '项目A' })).body;
      const { record } = await saveRecord(app, tokens, folder.id);

      const del = await request(app).delete(`/api/folders/${folder.id}`).set(authHeader(tokens));
      expect(del.status).toBe(200);
      expect(del.body.movedToInbox).toBe(1);

      const moved = await request(app).get(`/api/records/${record.id}`).set(authHeader(tokens));
      expect(moved.body.folderId).toBe('folder-inbox');
    } finally {
      cleanup();
    }
  });

  it('inbox 不可删除;他人文件夹 404(越权隔离)', async () => {
    const { app, cleanup } = makeCtx();
    try {
      const a = await registerUser(app);
      const b = await registerUser(app);
      const inboxDel = await request(app).delete('/api/folders/folder-inbox').set(authHeader(a));
      expect(inboxDel.status).toBe(400);
      expect(inboxDel.body.error.code).toBe('INBOX_PROTECTED');

      const folderOfA = (await request(app).post('/api/folders').set(authHeader(a)).send({ name: 'A的文件夹' })).body;
      const bTries = await request(app).delete(`/api/folders/${folderOfA.id}`).set(authHeader(b));
      expect(bTries.status).toBe(404);
    } finally {
      cleanup();
    }
  });
});
