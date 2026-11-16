/* 分析流水线:成功(假 Vision)/失败可恢复/取消/重启恢复/结果归一化 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeCtx, registerUser, authHeader, uploadPng, waitJobDone } from './helpers.js';

const FAKE_RESULT_JSON = JSON.stringify({
  scenario: 'success',
  scene_type: 'TASK',
  content_tags: ['待办'],
  summary: { oneLiner: { text: '总结', src: [1] }, facts: [], inferences: [], suggestions: [] },
  facts: [{ id: 'f-1', label: '标题', value: '会议纪要', confidence: 0.9, status: 'identified', src: [1] }],
  keyFacts: [],
  tasks: [{ id: 't-1', title: '完成任务', description: '', assignee: '张三', dueDate: '2026-12-01', priority: 'high', status: 'todo', done: false, src: [1] }],
  comparison: { id: 'cmp-1', title: '', dims: [], rows: [] },
  warnings: [],
});

describe('analysis', () => {
  it('完整链路:上传 → 创建任务 → 轮询至成功 → src 映射为真实图片 id', async () => {
    const { app, cleanup } = makeCtx({
      vision: { provider: 'fake', model: 'fake', complete: async () => FAKE_RESULT_JSON },
      ocr: { provider: 'none', recognize: async () => ({ lines: [], fullText: '', skipped: true }) },
    });
    try {
      const tokens = await registerUser(app);
      const up = await uploadPng(app, tokens);
      const created = await request(app).post('/api/analysis').set(authHeader(tokens)).send({ imageIds: [up.body.id] });
      expect(created.status).toBe(202);

      const snap = await waitJobDone(app, tokens, created.body.jobId);
      expect(snap.status).toBe('success');
      expect(snap.result.tasks[0].src).toEqual([up.body.id]); // src 已映射为真实 id
      expect(snap.result.tasks[0].dueDate).toBe('2026-12-01');
      expect(snap.images[0].id).toBe(up.body.id);
    } finally {
      cleanup();
    }
  });

  it('Vision 失败 → 任务失败(recoverable);再次创建可重试', async () => {
    const { app, cleanup } = makeCtx({
      vision: {
        provider: 'fake',
        model: 'fake',
        complete: async () => {
          const err = new Error('AI 服务响应超时(>120s)');
          err.code = 'VISION_TIMEOUT';
          throw err;
        },
      },
    });
    try {
      const tokens = await registerUser(app);
      const up = await uploadPng(app, tokens);
      const created = await request(app).post('/api/analysis').set(authHeader(tokens)).send({ imageIds: [up.body.id] });
      const snap = await waitJobDone(app, tokens, created.body.jobId);
      expect(snap.status).toBe('failed');
      expect(snap.error.recoverable).toBe(true);
      expect(snap.error.code).toBe('VISION_TIMEOUT');
    } finally {
      cleanup();
    }
  });

  it('取消:视觉调用挂起时也能终止', async () => {
    const { app, cleanup } = makeCtx({
      vision: {
        provider: 'fake',
        model: 'fake',
        complete: () => new Promise((resolve) => setTimeout(() => resolve(FAKE_RESULT_JSON), 1500)),
      },
    });
    try {
      const tokens = await registerUser(app);
      const up = await uploadPng(app, tokens);
      const created = await request(app).post('/api/analysis').set(authHeader(tokens)).send({ imageIds: [up.body.id] });

      await new Promise((r) => setTimeout(r, 80));
      const cancel = await request(app).post(`/api/analysis/${created.body.jobId}/cancel`).set(authHeader(tokens));
      expect(cancel.status).toBe(204);

      const snap = await waitJobDone(app, tokens, created.body.jobId);
      expect(snap.status).toBe('cancelled');
    } finally {
      cleanup();
    }
  });

  it('图幅不属于当前账号 → 400;服务重启恢复:中断任务标记可恢复失败', async () => {
    const { app, ctx, cleanup } = makeCtx({ vision: { provider: 'fake', model: 'fake', complete: async () => FAKE_RESULT_JSON } });
    try {
      const a = await registerUser(app);
      const b = await registerUser(app);
      const up = await uploadPng(app, a);
      const denied = await request(app).post('/api/analysis').set(authHeader(b)).send({ imageIds: [up.body.id] });
      expect(denied.status).toBe(400);
      expect(denied.body.error.code).toBe('UPLOAD_NOT_FOUND');

      // 模拟重启:插入 processing 任务 → recoverStuck → failed(JOB_INTERRUPTED)
      ctx.db.prepare("INSERT INTO analysis_jobs (id, user_id, status, image_ids, created_at) VALUES ('job-stuck', ?, 'processing', '[]', 1)").run(a.user.id);
      ctx.queue.recoverStuck();
      const row = ctx.db.prepare("SELECT * FROM analysis_jobs WHERE id = 'job-stuck'").get();
      expect(row.status).toBe('failed');
      expect(JSON.parse(row.error).code).toBe('JOB_INTERRUPTED');
      expect(JSON.parse(row.error).recoverable).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('部分成功:模型声明 partial → partial_success', async () => {
    const { app, cleanup } = makeCtx({
      vision: {
        provider: 'fake',
        model: 'fake',
        complete: async () => FAKE_RESULT_JSON.replace('"success"', '"partial"'),
      },
    });
    try {
      const tokens = await registerUser(app);
      const up = await uploadPng(app, tokens);
      const created = await request(app).post('/api/analysis').set(authHeader(tokens)).send({ imageIds: [up.body.id] });
      const snap = await waitJobDone(app, tokens, created.body.jobId);
      expect(snap.status).toBe('partial_success');
      expect(snap.result.scenario).toBe('partial');
    } finally {
      cleanup();
    }
  });
});
