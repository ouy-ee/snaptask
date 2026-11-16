/* ============================================================
   模型输出 → 前端结果模型:JSON 抽取、zod 校验、结构修复、
   src 图序号 → 真实 imageId 映射。绝不信任模型输出。

   容错原则(模型可能返回任何类型):
   - 文本字段:数组 → 拼接;数字/布尔 → 转字符串;对象 → 丢弃
   - value 字段:同文本规则,但 null 保持 null(界面显示「未提及」)
   - 条目级:非法对象 → 丢弃该条,不拖垮整个结果
   ============================================================ */

import { z } from 'zod';

/* ---------- 容错基础类型 ---------- */

const srcArray = z.array(z.union([z.number(), z.string()])).optional().default([]);

/* 文本字段容错:null→'',数组→顿号拼接,对象→'',其余→String */
const text = z
  .any()
  .transform((v) => {
    if (v == null) return '';
    if (Array.isArray(v)) return v.filter((x) => x != null && typeof x !== 'object').map(String).join('、');
    if (typeof v === 'object') return '';
    return String(v);
  })
  .catch('');

/* 值字段容错:null 保持 null(「未提及」),数组→顿号拼接,对象→null,其余→String */
const valueField = z
  .any()
  .transform((v) => {
    if (v == null) return null;
    if (Array.isArray(v)) {
      const parts = v.filter((x) => x != null && typeof x !== 'object').map(String);
      return parts.length ? parts.join('、') : null;
    }
    if (typeof v === 'object') return null;
    return String(v);
  })
  .catch(null);

/* 数字字段容错:LLM 常把 0.9 输出成字符串 "0.9" */
const numberField = z
  .any()
  .transform((v) => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return null;
  })
  .catch(null);

/* ---------- 宽松 zod 模型(与前端 src/mock/data.js 结构对齐) ---------- */

const oneLiner = z
  .object({ text, src: srcArray })
  .catchall(z.any())
  .or(z.string())
  .catch(null);

const summaryItem = z
  .object({ id: z.string().optional(), text, src: srcArray })
  .catchall(z.any())
  .catch(null);

/* 截止日期:字符串 / 冲突结构 / 其他一切 → null */
const dueDate = z
  .union([
    z.string(),
    z.object({
      conflict: z.literal(true),
      values: z.array(z.object({ value: z.union([z.string(), z.number()]).transform((v) => String(v)), src: srcArray })),
    }),
    z.null(),
  ])
  .catch(null);

const task = z
  .object({
    id: z.string().optional(),
    title: text,
    description: text,
    assignee: valueField,
    dueDate,
    priority: z.enum(['high', 'medium', 'low']).catch('medium'),
    status: z.enum(['todo', 'doing', 'done']).catch('todo'),
    done: z.boolean().catch(false),
    src: srcArray,
  })
  .catchall(z.any())
  .catch(null);

const fact = z
  .object({
    id: z.string().optional(),
    label: text,
    value: valueField,
    confidence: numberField,
    status: z.enum(['identified', 'uncertain', 'not-mentioned']).catch('identified'),
    src: srcArray,
  })
  .catchall(z.any())
  .catch(null);

const keyFact = z
  .object({
    id: z.string().optional(),
    text,
    confidence: numberField,
    status: z.enum(['identified', 'uncertain', 'not-mentioned']).catch('identified'),
    src: srcArray,
  })
  .catchall(z.any())
  .catch(null);

/* 单元格:冲突结构优先(普通分支是非严格 object,会吞掉 conflict 字段) */
const cell = z
  .object({
    conflict: z.literal(true),
    values: z.array(z.object({ value: z.union([z.string(), z.number()]).transform((v) => String(v)), src: srcArray })),
  })
  .or(
    z.object({
      value: valueField,
      missing: z.boolean().catch(false),
      confidence: numberField,
      status: z.enum(['identified', 'uncertain', 'not-mentioned']).catch('identified'),
      src: srcArray,
    })
  )
  .or(z.object({}).catchall(z.any()))
  .catch(null);

const dim = z.object({ id: z.string(), label: text }).catchall(z.any()).catch(null);

const row = z
  .object({ id: z.string().optional(), label: text, cells: z.record(z.string(), cell).catch({}) })
  .catchall(z.any())
  .catch(null);

const comparison = z
  .object({
    id: z.string().optional(),
    title: text,
    dims: z.array(dim).catch([]),
    rows: z.array(row).catch([]),
  })
  .catchall(z.any())
  .catch({ id: 'cmp-1', title: '', dims: [], rows: [] });

const warning = z
  .object({
    id: z.string().optional(),
    type: z.string().catch('low-confidence'),
    severity: z.enum(['high', 'medium', 'low']).catch('low'),
    title: text,
    message: text,
    related: z
      .object({ kind: z.string().catch('fact'), id: z.string().catch(''), label: text })
      .catchall(z.any())
      .catch({ kind: 'fact', id: '', label: '' }),
    src: srcArray,
    actions: z.array(z.string()).catch(['确认无误']),
  })
  .catchall(z.any())
  .catch(null);

const summary = z
  .object({
    oneLiner: oneLiner.catch({ text: '', src: [] }),
    facts: z.array(summaryItem).catch([]),
    inferences: z.array(summaryItem).catch([]),
    suggestions: z.array(summaryItem).catch([]),
  })
  .catchall(z.any())
  .catch({ oneLiner: { text: '', src: [] }, facts: [], inferences: [], suggestions: [] });

const rawResult = z.object({
  scenario: z.enum(['success', 'partial']).catch('success'),
  scene_type: z.enum(['TASK', 'COMPARISON', 'OTHER']).catch('TASK'),
  content_tags: z.array(z.string()).catch([]),
  summary,
  facts: z.array(fact).catch([]),
  keyFacts: z.array(keyFact).catch([]),
  tasks: z.array(task).catch([]),
  comparison,
  warnings: z.array(warning).catch([]),
});

/* ---------- JSON 抽取(模型可能包一层 markdown 或前后赘述) ---------- */

export function extractJson(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  let s = text.trim();
  // 去掉 ```json ... ``` 围栏
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  // 或取第一个 { 到最后一个 }
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last > first) s = s.slice(first, last + 1);
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/* ---------- src 映射:图序号(1 起,字符串数字亦可)→ 真实 imageId ---------- */

function mapSrc(src, imageIds) {
  return [...new Set(
    (src || [])
      .map((v) => {
        const n = typeof v === 'number' ? v : parseInt(v, 10);
        return Number.isInteger(n) && n >= 1 && n <= imageIds.length ? imageIds[n - 1] : null;
      })
      .filter(Boolean)
  )];
}

function mapItem(item, imageIds) {
  return { ...item, src: mapSrc(item.src, imageIds) };
}

function mapDueDate(d, imageIds) {
  if (typeof d === 'string' && d.trim()) return d;
  if (d && typeof d === 'object' && !Array.isArray(d) && d.conflict === true && Array.isArray(d.values)) {
    return { conflict: true, values: d.values.map((v) => ({ value: String(v.value), src: mapSrc(v.src, imageIds) })) };
  }
  return null;
}

function mapCell(c, imageIds) {
  if (!c) return { value: null, missing: true, src: [] };
  if (c.conflict === true && Array.isArray(c.values)) {
    return { conflict: true, values: c.values.map((v) => ({ value: String(v.value), src: mapSrc(v.src, imageIds) })) };
  }
  return { ...c, src: mapSrc(c.src, imageIds) };
}

/* ---------- 归一化入口:模型原文 → 前端结果对象 ---------- */

const TASK_FIELDS = ['id', 'title', 'description', 'assignee', 'dueDate', 'priority', 'status', 'done', 'src'];

export function normalizeResult(rawText, imageIds, extra = {}) {
  const parsed = extractJson(rawText);
  if (!parsed) {
    const err = new Error('模型未返回合法 JSON');
    err.code = 'VISION_BAD_JSON';
    throw err;
  }
  const r = rawResult.parse(parsed);

  const ids = { f: 0, sf: 0, si: 0, ss: 0, kf: 0, t: 0, d: 0, row: 0, w: 0 };
  const nextId = (kind) => `${kind}-${++ids[kind]}`;
  const ensureId = (obj, kind) => ({ ...obj, id: obj.id && typeof obj.id === 'string' && obj.id.trim() ? obj.id : nextId(kind) });

  const summary = {
    oneLiner: r.summary.oneLiner
      ? mapItem(typeof r.summary.oneLiner === 'string' ? { text: r.summary.oneLiner, src: [] } : { text: r.summary.oneLiner.text || '', src: r.summary.oneLiner.src }, imageIds)
      : { text: '', src: [] },
    facts: r.summary.facts.filter(Boolean).map((f) => mapItem(ensureId(f, 'sf'), imageIds)),
    inferences: r.summary.inferences.filter(Boolean).map((f) => mapItem(ensureId(f, 'si'), imageIds)),
    suggestions: r.summary.suggestions.filter(Boolean).map((f) => mapItem(ensureId(f, 'ss'), imageIds)),
  };

  const facts = r.facts.filter(Boolean).map((f) => ({ ...mapItem(ensureId(f, 'f'), imageIds), value: f.value }));
  const keyFacts = r.keyFacts.filter(Boolean).map((f) => mapItem(ensureId(f, 'kf'), imageIds));

  const tasks = r.tasks.filter(Boolean).map((t) => {
    const base = ensureId(t, 't');
    const clean = {};
    for (const key of TASK_FIELDS) clean[key] = base[key];
    clean.done = !!clean.done;
    if (!clean.done && clean.status === 'done') clean.done = true;
    if (clean.done && clean.status !== 'done') clean.status = 'done';
    return { ...clean, dueDate: mapDueDate(clean.dueDate, imageIds), src: mapSrc(clean.src, imageIds) };
  });

  const comparison = {
    id: r.comparison.id || 'cmp-1',
    title: r.comparison.title || '',
    dims: r.comparison.dims.filter(Boolean).map((d) => (d.id ? { id: d.id, label: d.label || '维度' } : { id: nextId('d'), label: d.label || '维度' })),
    rows: r.comparison.rows.filter(Boolean).map((row) => {
      const rid = row.id || nextId('row');
      const cells = {};
      for (const [dimId, c] of Object.entries(row.cells || {})) cells[dimId] = mapCell(c, imageIds);
      return { id: rid, label: row.label || '', cells };
    }),
  };

  const warnings = r.warnings.filter(Boolean).map((w) => ({
    ...mapItem(ensureId(w, 'w'), imageIds),
    related: { kind: w.related?.kind || 'fact', id: w.related?.id || '', label: w.related?.label || '' },
    actions: Array.isArray(w.actions) && w.actions.length ? w.actions : ['确认无误'],
  }));

  // 附加警告(如单图 OCR 失败的 low-quality)由流水线注入
  const extraWarnings = (extra.warnings || []).map((w, i) => ({ id: `w-extra-${i + 1}`, ...w, src: mapSrc(w.src || [], imageIds) }));

  const allTags = new Set([...(r.content_tags || [])].filter((t) => t === '待办' || t === '资料'));
  const contentTags = allTags.size
    ? [...allTags]
    : [...(tasks.length || summary.suggestions.length ? ['待办'] : []), ...(facts.length || keyFacts.length ? ['资料'] : [])];

  return {
    scenario: extra.scenario || r.scenario,
    scene_type: r.scene_type,
    content_tags: contentTags,
    summary,
    facts,
    keyFacts,
    tasks,
    comparison,
    warnings: [...warnings, ...extraWarnings],
  };
}
