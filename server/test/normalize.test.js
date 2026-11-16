/* 结果归一化:JSON 抽取、src 映射、冲突结构、缺省字段修复 */

import { describe, it, expect } from 'vitest';
import { extractJson, normalizeResult } from '../src/ai/normalize.js';

const IMAGE_IDS = ['img-a', 'img-b', 'img-c'];

describe('extractJson', () => {
  it('解析带 markdown 围栏与前后赘述的输出', () => {
    const text = '好的,以下是结果:\n```json\n{"a":1}\n```\n希望有帮助';
    expect(extractJson(text)).toEqual({ a: 1 });
  });
  it('非法 JSON 返回 null', () => {
    expect(extractJson('这不是 JSON')).toBeNull();
    expect(extractJson('')).toBeNull();
  });
});

describe('normalizeResult', () => {
  it('src 图序号(含字符串)→ 真实 imageId;越界/非法被过滤', () => {
    const raw = {
      summary: { oneLiner: { text: 'x', src: [1, 2] }, facts: [{ id: 'sf-1', text: 'f', src: [1, '3', 9, 'abc'] }], inferences: [], suggestions: [] },
      tasks: [{ id: 't-1', title: 't', description: '', assignee: null, dueDate: null, priority: 'high', status: 'todo', done: false, src: [2] }],
    };
    const out = normalizeResult(JSON.stringify(raw), IMAGE_IDS);
    expect(out.summary.oneLiner.src).toEqual(['img-a', 'img-b']);
    expect(out.summary.facts[0].src).toEqual(['img-a', 'img-c']); // 9 与 'abc' 被过滤
    expect(out.tasks[0].src).toEqual(['img-b']);
  });

  it('冲突 dueDate 与冲突单元格透传且 src 映射', () => {
    const raw = {
      tasks: [
        { id: 't-1', title: 't', description: '', assignee: null, dueDate: { conflict: true, values: [{ value: '2026-11-20', src: [1] }, { value: '2026-11-25', src: [2] }] }, priority: 'high', status: 'todo', done: false, src: [] },
      ],
      comparison: {
        dims: [{ id: 'd-1', label: '价格' }],
        rows: [{ id: 'row-1', label: 'A', cells: { 'd-1': { conflict: true, values: [{ value: '¥1', src: [1] }, { value: '¥2', src: [2] }] } } }],
      },
    };
    const out = normalizeResult(JSON.stringify(raw), IMAGE_IDS);
    expect(out.tasks[0].dueDate.conflict).toBe(true);
    expect(out.tasks[0].dueDate.values[1].src).toEqual(['img-b']);
    expect(out.comparison.rows[0].cells['d-1'].conflict).toBe(true);
  });

  it('模型遗漏段落 → 全部兜底为空结构,不抛错', () => {
    const out = normalizeResult(JSON.stringify({}), IMAGE_IDS);
    expect(out.summary.oneLiner.text).toBe('');
    expect(out.tasks).toEqual([]);
    expect(out.comparison.rows).toEqual([]);
    expect(out.warnings).toEqual([]);
    expect(out.content_tags).toEqual([]);
  });

  it('缺失 id 自动补齐;content_tags 由内容推断', () => {
    const raw = {
      summary: { oneLiner: { text: 'x', src: [] }, facts: [{ text: '无 id' }], inferences: [], suggestions: [{ text: '建议' }] },
      facts: [{ label: '标题', value: 'v', confidence: 0.9, status: 'identified', src: [] }],
      tasks: [],
    };
    const out = normalizeResult(JSON.stringify(raw), IMAGE_IDS);
    expect(out.summary.facts[0].id).toBe('sf-1');
    expect(out.facts[0].id).toBe('f-1');
    expect(out.content_tags).toContain('资料');
    expect(out.content_tags).toContain('待办');
  });

  it('extra 警告注入并映射 src', () => {
    const raw = { tasks: [] };
    const out = normalizeResult(JSON.stringify(raw), IMAGE_IDS, {
      scenario: 'partial',
      warnings: [{ type: 'low-quality', severity: 'medium', title: 'x', message: 'y', related: { kind: 'image', id: '1', label: 'a.png' }, src: [1], actions: [] }],
    });
    expect(out.scenario).toBe('partial');
    expect(out.warnings.length).toBe(1);
    expect(out.warnings[0].src).toEqual(['img-a']);
  });
});
