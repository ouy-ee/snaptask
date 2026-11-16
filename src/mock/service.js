/* ============================================================
   Mock service:模拟分析 API。
   接入真实后端时,仅需替换本文件的 analyzeImages / estimateQuality,
   组件层不感知数据来源。
   ============================================================ */

import { PROCUREMENT_RESULT, MEETING_RESULT, FAILED_RESULT } from './data';
import { sleepJitter } from '../lib/utils';

export const ANALYSIS_STAGES = [
  { key: 'load', label: '读取图幅', hint: '载入截图并校正方向' },
  { key: 'recognize', label: '识别注记', hint: '逐图提取文字与结构' },
  { key: 'merge', label: '拼合图景', hint: '多图语义融合与去重' },
  { key: 'collate', label: '校勘比对', hint: '检测冲突与缺失信息' },
  { key: 'compose', label: '成图', hint: '生成结构化结果' },
];

/* 结果数据的 src 序号 → 实际 imageId(按图例顺序) */
function mapResult(result, images) {
  const byIndex = (n) => (images[n - 1] ? images[n - 1].id : null);
  const mapSrc = (src = []) => src.map(byIndex).filter(Boolean);
  const mapItem = (it) => ({ ...it, src: mapSrc(it.src) });

  return {
    scenario: result.scenario,
    scene_type: result.scene_type || (result.comparison ? 'COMPARISON' : 'TASK'),
    content_tags: result.content_tags || null,
    summary: {
      oneLiner: mapItem(result.summary.oneLiner),
      facts: result.summary.facts.map(mapItem),
      inferences: result.summary.inferences.map(mapItem),
      suggestions: result.summary.suggestions.map(mapItem),
    },
    facts: result.facts.map((f) => ({ ...mapItem(f), src: mapSrc(f.src) })),
    keyFacts: result.keyFacts.map(mapItem),
    tasks: result.tasks.map((t) => {
      const dueDate =
        t.dueDate && t.dueDate.conflict
          ? {
              conflict: true,
              values: t.dueDate.values.map((v) => ({ value: v.value, src: mapSrc(v.src) })),
            }
          : t.dueDate;
      return { ...mapItem(t), dueDate };
    }),
    comparison: {
      ...result.comparison,
      rows: result.comparison.rows.map((r) => ({
        ...r,
        cells: Object.fromEntries(
          Object.entries(r.cells).map(([dimId, cell]) => {
            if (cell.conflict) {
              return [
                dimId,
                {
                  ...cell,
                  conflict: true,
                  values: cell.values.map((v) => ({ value: v.value, src: mapSrc(v.src) })),
                },
              ];
            }
            return [dimId, { ...cell, src: mapSrc(cell.src) }];
          })
        ),
      })),
    },
    warnings: result.warnings.map((w) => ({
      ...w,
      src: mapSrc(w.src),
      related: { ...w.related },
    })),
  };
}

/* 深拷贝结果(每次分析返回独立副本,便于编辑) */
function cloneResult(result, images) {
  return JSON.parse(JSON.stringify(mapResult(result, images)));
}

/* 选择场景:auto 根据图幅质量推断 */
function resolveScenario(scenario, images) {
  if (scenario && scenario !== 'auto') return scenario;
  const lowQuality = images.filter((i) => (i.quality?.score ?? 100) < 70).length;
  return lowQuality > 0 ? 'partial' : 'success';
}

const RESULT_BY_SCENARIO = {
  success: MEETING_RESULT,
  partial: PROCUREMENT_RESULT,
  failed: FAILED_RESULT,
};

/**
 * 模拟分析。images: 已入队的 ImageRef 数组。
 * onEvent 回调:{ type: 'stage'|'progress'|'done', ... }
 * 返回 { status, scenario, result | error }
 */
export async function analyzeImages(images, { scenario = 'auto', onEvent, isPaused = () => false } = {}) {
  const resolved = resolveScenario(scenario, images);
  const emit = (e) => onEvent && onEvent(e);

  const total = Math.max(1, images.length);
  const waitIfPaused = async () => { while (isPaused()) await new Promise((resolve) => setTimeout(resolve, 120)); };

  for (let si = 0; si < ANALYSIS_STAGES.length; si++) {
    await waitIfPaused();
    const stage = ANALYSIS_STAGES[si];
    emit({ type: 'stage', index: si, stage });

    if (stage.key === 'recognize') {
      // 逐图识别
      for (let i = 0; i < total; i++) {
        await waitIfPaused();
        emit({
          type: 'progress',
          processed: i,
          total,
          note: `正在识别第 ${i + 1} 张图幅「${images[i]?.name ?? ''}」`,
        });
        await sleepJitter(520, 0.55);
        await waitIfPaused();
        emit({ type: 'progress', processed: i + 1, total, note: `第 ${i + 1} 张图幅识别完成` });
      }
    } else if (stage.key === 'collate' && resolved === 'failed') {
      emit({ type: 'progress', processed: total, total, note: '正在比对图幅之间的冲突与缺失…' });
      await sleepJitter(700, 0.4);
      await waitIfPaused();
      emit({ type: 'error', error: FAILED_RESULT.error });
      return { status: 'failed', scenario: resolved, error: FAILED_RESULT.error };
    } else {
      // load 阶段已处理数从 0 开始;其余阶段保持识别完成的进度
      emit({ type: 'progress', processed: si === 0 ? 0 : total, total, note: stage.hint });
      await sleepJitter(si === 0 ? 380 : 640, 0.45);
      await waitIfPaused();
    }
  }

  const status = resolved === 'partial' ? 'partial_success' : 'success';
  const result = cloneResult(RESULT_BY_SCENARIO[resolved], images);
  emit({ type: 'done', status });
  return { status, scenario: resolved, result };
}

/* 模拟单图质量评估(真实接入后可替换为后端 OCR 预检) */
export function estimateQuality(file) {
  // 由文件大小与类型粗估,演示用
  const base = 84 + Math.min(12, Math.round(file.size / 180000));
  return Math.min(98, base);
}
