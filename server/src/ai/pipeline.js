/* ============================================================
   分析流水线 + 任务队列。
   5 阶段与前端 ANALYSIS_STAGES 一致;进度持久化到 analysis_jobs,
   前端轮询 GET /api/analysis/:id 合成事件流。
   ============================================================ */

import { now } from '../db.js';
import { buildAnalysisPrompt } from './prompt.js';
import { normalizeResult } from './normalize.js';
import { normalizeBox, qualityFromOcr } from './ocr.js';

export const STAGES = [
  { key: 'load', label: '读取图幅' },
  { key: 'recognize', label: '识别注记' },
  { key: 'merge', label: '拼合图景' },
  { key: 'collate', label: '校勘比对' },
  { key: 'compose', label: '成图' },
];

const JOB_TIMEOUT_MS = 10 * 60 * 1000;

function cancelledError() {
  return { code: 'CANCELLED', title: '分析已取消', detail: '用户主动取消了本次分析', recoverable: true };
}

/* 逐图识别:OCR + regions + 质量评分(单图失败不拖垮全任务) */
async function recognizeStage(ctx, job, images) {
  const { db, ocr, logger } = ctx;
  const ocrTexts = new Array(images.length).fill('');
  const failedImages = [];

  for (let i = 0; i < images.length; i++) {
    if (job.isCancelled()) return { cancelled: true };
    const img = images[i];
    job.update({ processed: i, note: `正在识别第 ${i + 1} 张图幅「${img.name || ''}」` });
    if (img.ok) {
      try {
        const r = await ocr.recognize(img.buffer, job.userId);
        if (!r.skipped) {
          ocrTexts[i] = r.fullText || '';
          const regions = (r.lines || [])
            .map((l, idx) => ({
              id: `r-${i + 1}-${idx + 1}`,
              label: (l.text || '').slice(0, 14) || `区域${idx + 1}`,
              ...(normalizeBox(l.box, img.width, img.height) || {}),
              note: (l.text || '').slice(0, 60),
            }))
            .filter((reg) => typeof reg.x === 'number');
          const quality = qualityFromOcr(r.lines);
          db.prepare('UPDATE uploads SET regions = ?, ocr_text = ?, quality = ? WHERE id = ?')
            .run(JSON.stringify(regions), r.fullText || '', JSON.stringify(quality), img.id);
        }
      } catch (err) {
        failedImages.push({ index: i + 1, name: img.name || '', reason: err.message });
        logger.warn({ jobId: job.id, image: img.id, err: err.message }, '单图 OCR 失败,降级为视觉直读');
      }
    } else {
      failedImages.push({ index: i + 1, name: img.name || '', reason: img.reason === 'missing' ? '文件缺失' : '文件不可读' });
    }
    job.update({ processed: i + 1, note: `第 ${i + 1} 张图幅识别完成` });
  }
  return { cancelled: false, ocrTexts, failedImages };
}

export async function runAnalysisJob(ctx, jobId, isCancelled) {
  const { db, storage, ocr, vision, logger } = ctx;
  const jobRow = db.prepare('SELECT * FROM analysis_jobs WHERE id = ?').get(jobId);
  if (!jobRow) return;

  const job = {
    id: jobId,
    userId: jobRow.user_id,
    isCancelled: () => !!isCancelled(),
    update(patch) {
      const keys = Object.keys(patch);
      const setSql = keys.map((k) => `${k} = @${k}`).join(', ');
      db.prepare(`UPDATE analysis_jobs SET ${setSql} WHERE id = @id`).run({ id: jobId, ...patch });
    },
    fail(error, status = 'failed') {
      job.update({ status, error: JSON.stringify(error), finished_at: now(), note: null });
    },
  };

  try {
    if (job.isCancelled()) {
      job.update({ status: 'cancelled', finished_at: now() });
      return;
    }
    job.update({ status: 'processing', started_at: now() });

    const imageIds = JSON.parse(jobRow.image_ids || '[]');
    const total = imageIds.length;
    if (total === 0) {
      job.fail({ code: 'NO_IMAGES', title: '没有可分析的图幅', detail: '请先上传截图再发起分析', recoverable: false });
      return;
    }

    /* ---------- Stage 0 读取图幅 ---------- */
    job.update({ stage_index: 0, stage_label: STAGES[0].label, processed: 0, total, note: '载入截图并校验格式' });
    const images = [];
    for (const id of imageIds) {
      if (job.isCancelled()) { job.update({ status: 'cancelled', finished_at: now() }); return; }
      const up = db.prepare('SELECT * FROM uploads WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(id, job.userId);
      if (!up) { images.push({ id, ok: false, reason: 'missing', name: '(文件缺失)' }); continue; }
      const buf = await storage.get(up.storage_key);
      if (!buf) { images.push({ id, ok: false, reason: 'missing', name: up.original_name || '' }); continue; }
      images.push({ id, ok: true, buffer: buf, mime: up.mime_type, name: up.original_name || '', width: up.width, height: up.height });
    }
    if (!images.some((i) => i.ok)) {
      job.fail({ code: 'IMAGES_UNREADABLE', title: '图幅读取失败', detail: '上传的文件已丢失或损坏,请重新上传截图', recoverable: false });
      return;
    }

    /* ---------- Stage 1 识别注记 ---------- */
    job.update({ stage_index: 1, stage_label: STAGES[1].label, note: '逐图提取文字与结构' });
    const { cancelled, ocrTexts, failedImages } = await recognizeStage(ctx, job, images);
    if (cancelled) return;

    /* ---------- Stage 2 拼合图景(视觉模型一次完成融合+提取) ---------- */
    if (job.isCancelled()) { job.update({ status: 'cancelled', finished_at: now() }); return; }
    job.update({ stage_index: 2, stage_label: STAGES[2].label, processed: total, note: '正在融合多图语义并去重…' });

    let result;
    try {
      const okImages = images.filter((i) => i.ok);
      const prompt = buildAnalysisPrompt({ names: images.map((i) => i.name), ocrTexts });

      // 视觉调用期间轮询取消标记(调用本身不可中断,结果作废)
      let cancelledDuringVision = false;
      const cancelPoll = (async () => {
        for (;;) {
          await new Promise((r) => setTimeout(r, 400));
          if (job.isCancelled()) {
            cancelledDuringVision = true;
            return null;
          }
        }
      })();
      const text = await Promise.race([
        vision.complete({
          images: okImages.map((i) => ({ mime: i.mime, buffer: i.buffer })),
          prompt,
          userId: job.userId,
        }),
        cancelPoll,
      ]);
      if (cancelledDuringVision) {
        job.update({ status: 'cancelled', finished_at: now() });
        return;
      }
      if (job.isCancelled()) { job.update({ status: 'cancelled', finished_at: now() }); return; }

      /* ---------- Stage 3 校勘比对 ---------- */
      job.update({ stage_index: 3, stage_label: STAGES[3].label, note: '校勘冲突与缺失信息…' });

      const extraWarnings = failedImages.map((f) => ({
        type: 'low-quality',
        severity: 'medium',
        title: `图 ${f.index} 识别受限`,
        message: `「${f.name}」的 OCR 识别未完成(${f.reason}),相关字段可能缺失或不确定。`,
        related: { kind: 'image', id: String(f.index), label: f.name },
        src: [f.index],
        actions: ['查看该图幅', '重试识别'],
      }));
      const degraded = failedImages.length > 0;
      result = normalizeResult(text, imageIds, {
        scenario: degraded ? 'partial' : undefined,
        warnings: extraWarnings,
      });

      /* ---------- Stage 4 成图 ---------- */
      job.update({ stage_index: 4, stage_label: STAGES[4].label, note: '正在生成结构化结果…' });

      const status = result.scenario === 'partial' ? 'partial_success' : 'success';
      job.update({
        status,
        scenario: result.scenario,
        result: JSON.stringify(result),
        stage_index: 4,
        processed: total,
        note: null,
        finished_at: now(),
      });
    } catch (err) {
      const code = err.code || 'ANALYSIS_FAILED';
      const retryableCodes = ['RATE_LIMITED', 'VISION_TIMEOUT', 'VISION_NETWORK_ERROR', 'VISION_PROVIDER_ERROR', 'QUOTA_EXCEEDED', 'VISION_BAD_RESPONSE', 'VISION_BAD_JSON', 'ANALYSIS_FAILED'];
      job.fail({
        code,
        title: 'AI 分析失败',
        detail: err.message || '视觉模型调用失败,请重试',
        recoverable: retryableCodes.includes(code),
      });
    }
  } catch (err) {
    logger.error({ jobId, err: err.message }, '分析任务异常');
    job.fail({ code: 'INTERNAL_ERROR', title: '分析异常中断', detail: err.message, recoverable: true });
  }
}

/* ============================================================
   进程内队列:并发可配(默认 1,控制成本)。
   ============================================================ */

export function createAnalysisQueue(ctx) {
  const { db, config, logger } = ctx;
  const pending = [];
  const cancelFlags = new Map();
  let running = 0;
  const maxConcurrent = Math.max(1, config.business.analysisConcurrency || 1);

  function markFailed(jobId, error) {
    try {
      db.prepare(
        "UPDATE analysis_jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ? AND status IN ('queued','processing')"
      ).run(JSON.stringify(error), now(), jobId);
    } catch (err) {
      logger.error({ err: err.message }, '标记任务失败出错');
    }
  }

  async function runJobSafe(jobId) {
    let watchdogFired = false;
    const watchdog = setTimeout(() => {
      watchdogFired = true;
      cancelFlags.set(jobId, true);
    }, JOB_TIMEOUT_MS);
    try {
      await runAnalysisJob(ctx, jobId, () => cancelFlags.get(jobId));
      if (watchdogFired) {
        markFailed(jobId, { code: 'ANALYSIS_TIMEOUT', title: '分析超时', detail: '分析超过 10 分钟未完成,已终止。可重试。', recoverable: true });
      }
    } catch (err) {
      logger.error({ jobId, err: err.message }, '队列任务崩溃');
      markFailed(jobId, { code: 'INTERNAL_ERROR', title: '分析异常中断', detail: err.message, recoverable: true });
    } finally {
      clearTimeout(watchdog);
      cancelFlags.delete(jobId);
      running -= 1;
      pump();
    }
  }

  function pump() {
    while (running < maxConcurrent && pending.length > 0) {
      const jobId = pending.shift();
      running += 1;
      runJobSafe(jobId);
    }
  }

  /* 服务启动时恢复:中断任务标记为可恢复失败 */
  function recoverStuck() {
    try {
      const n = db.prepare(
        "UPDATE analysis_jobs SET status = 'failed', error = ?, finished_at = ? WHERE status IN ('queued','processing')"
      ).run(JSON.stringify({ code: 'JOB_INTERRUPTED', title: '分析任务被中断', detail: '服务重启导致任务中断,请重试。', recoverable: true }), now());
      if (n.changes > 0) logger.warn({ count: n.changes }, '恢复:标记中断的分析任务为失败');
    } catch (err) {
      logger.error({ err: err.message }, '任务恢复失败');
    }
  }

  return {
    enqueue(jobId) { pending.push(jobId); pump(); },
    cancel(jobId) { cancelFlags.set(jobId, true); },
    recoverStuck,
    stats: () => ({ pending: pending.length, running }),
  };
}
