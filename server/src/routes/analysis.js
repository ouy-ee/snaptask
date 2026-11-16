/* 分析任务:创建(入队)→ 轮询快照 → 取消 */

import express from 'express';
import { z } from 'zod';
import { now } from '../db.js';
import { validate } from '../middleware.js';
import { badRequest, notFound } from '../errors.js';

const startSchema = z.object({
  imageIds: z.array(z.string()).min(1, '至少需要 1 张截图').max(6, '最多 6 张截图'),
});

function parseJson(text, fallback = null) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

function snapshotFor(ctx, job) {
  const { db } = ctx;
  const base = {
    jobId: job.id,
    status: job.status,
    stageIndex: job.stage_index,
    stageLabel: job.stage_label,
    processed: job.processed,
    total: job.total,
    note: job.note,
    error: parseJson(job.error),
    result: parseJson(job.result),
    scenario: job.scenario,
    createdAt: job.created_at,
    startedAt: job.started_at,
    finishedAt: job.finished_at,
  };
  // 终态附带回图幅识别产物(regions / 质量),前端合并进 ImageRef
  if (job.status === 'success' || job.status === 'partial_success') {
    const imageIds = parseJson(job.image_ids, []);
    const rows = db
      .prepare('SELECT id, regions, quality FROM uploads WHERE id IN (' + imageIds.map(() => '?').join(',') + ')')
      .all(...imageIds);
    base.images = imageIds.map((id) => {
      const row = rows.find((r) => r.id === id);
      return { id, regions: parseJson(row?.regions, []), quality: parseJson(row?.quality) };
    });
  }
  return base;
}

export function analysisRouter(ctx) {
  const router = express.Router();
  const { db, queue, config } = ctx;

  router.post('/', validate(startSchema), (req, res, next) => {
    try {
      const { imageIds } = req.body;
      // 图幅归属校验:必须全部属于当前用户
      const owned = db
        .prepare(`SELECT COUNT(*) AS n FROM uploads WHERE id IN (${imageIds.map(() => '?').join(',')}) AND user_id = ? AND deleted_at IS NULL`)
        .get(...imageIds, req.user.id).n;
      if (owned !== imageIds.length) {
        throw badRequest('UPLOAD_NOT_FOUND', '部分图幅不存在或不属于当前账号,请重新上传');
      }
      const jobId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO analysis_jobs (id, user_id, status, image_ids, created_at) VALUES (?,?,'queued',?,?)`
      ).run(jobId, req.user.id, JSON.stringify(imageIds), now());
      queue.enqueue(jobId);
      res.status(202).json({ jobId });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', (req, res, next) => {
    try {
      const job = db.prepare('SELECT * FROM analysis_jobs WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
      if (!job) throw notFound('JOB_NOT_FOUND', '分析任务不存在');
      res.json(snapshotFor(ctx, job));
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/cancel', (req, res, next) => {
    try {
      const job = db.prepare('SELECT * FROM analysis_jobs WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
      if (!job) throw notFound('JOB_NOT_FOUND', '分析任务不存在');
      if (job.status === 'queued') {
        db.prepare("UPDATE analysis_jobs SET status = 'cancelled', finished_at = ? WHERE id = ?").run(now(), job.id);
      } else if (job.status === 'processing') {
        queue.cancel(job.id); // 流水线在阶段边界响应
      } else {
        throw badRequest('JOB_NOT_CANCELLABLE', '任务已结束,无法取消');
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
