/* Store reducer 纯逻辑测试:保存/文件夹删除/待办联动/undo-redo/云端 regions 合并 */

import { describe, it, expect, beforeEach } from 'vitest';
import { reducer, createInitialState } from './store.jsx';

function baseState(overrides = {}) {
  return { ...createInitialState({ mode: 'local', booted: true }), ...overrides };
}

function resultFixture() {
  return {
    scenario: 'success',
    content_tags: ['待办'],
    summary: { oneLiner: { text: '总结', src: [] }, facts: [], inferences: [], suggestions: [{ id: 'ss-1', text: '建议', src: [] }] },
    facts: [{ id: 'f-1', label: '标题', value: 'x', confidence: 0.9, status: 'identified', src: [] }],
    keyFacts: [],
    tasks: [{ id: 't-1', title: '任务一', description: '', assignee: '张三', dueDate: '2026-12-01', priority: 'high', status: 'todo', done: false, src: [] }],
    comparison: { id: 'cmp-1', title: '', dims: [], rows: [] },
    warnings: [],
  };
}

describe('reducer', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('SAVE_RESULT:写入历史并去重,清 dirty', () => {
    const state = baseState({ analysis: { status: 'success', result: resultFixture() } });
    const next = reducer(state, { type: 'SAVE_RESULT', savedAt: 1000, images: [], folderId: 'folder-inbox', title: '分析A', result: resultFixture() });
    expect(next.dirty).toBe(false);
    expect(next.history.length).toBe(1);
    expect(next.history[0].contentTags).toContain('待办');
    // 同 savedAt 再保存 → 去重不新增
    const again = reducer(next, { type: 'SAVE_RESULT', savedAt: 1000, images: [], folderId: 'folder-inbox', title: '分析A', result: resultFixture() });
    expect(again.history.length).toBe(1);
  });

  it('FOLDER_DELETE:其下记录移入未整理,当前文件夹回落 inbox', () => {
    const state = baseState({
      folders: [{ id: 'folder-inbox', name: '未整理' }, { id: 'f1', name: '工作' }],
      history: [{ id: 'h1', title: 'r', folderId: 'f1', isDeleted: false }],
      currentFolderId: 'f1',
    });
    const next = reducer(state, { type: 'FOLDER_DELETE', id: 'f1' });
    expect(next.folders.length).toBe(1);
    expect(next.history[0].folderId).toBe('folder-inbox');
    expect(next.currentFolderId).toBe('folder-inbox');
  });

  it('URGENT_TASK_UPDATE:同步更新分析结果与历史中的同 id 任务', () => {
    const result = resultFixture();
    const state = baseState({
      analysis: { status: 'success', result },
      urgentTasks: [{ id: 't-1', title: '任务一', done: false }],
      history: [{ id: 'h1', title: 'r', isDeleted: false, saved: { savedAt: 1, images: [], result } }],
    });
    const next = reducer(state, { type: 'URGENT_TASK_UPDATE', id: 't-1', patch: { done: true, status: 'done' } });
    expect(next.urgentTasks[0].done).toBe(true);
    expect(next.analysis.result.tasks[0].done).toBe(true);
    expect(next.history[0].saved.result.tasks[0].done).toBe(true);
  });

  it('ANALYZE_DONE:合并服务端 regions/quality 到对应图幅', () => {
    const state = baseState({
      stage: 'analyzing',
      images: [{ id: 'up-1', name: 'a.png', regions: [], quality: { score: 80, label: '清晰', issues: [] } }],
      analysis: { status: 'processing', result: null },
    });
    const next = reducer(state, {
      type: 'ANALYZE_DONE',
      status: 'success',
      result: resultFixture(),
      imageExtras: { 'up-1': { regions: [{ id: 'r-1', label: '区域', x: 0.1, y: 0.2, w: 0.3, h: 0.1, note: '文字' }], quality: { score: 58, label: '模糊', issues: ['文字分辨率低'] } } },
    });
    expect(next.stage).toBe('results');
    expect(next.images[0].regions.length).toBe(1);
    expect(next.images[0].quality.score).toBe(58);
    expect(next.loadedRecordId).toBeNull();
  });

  it('UNDO/REDO:结果编辑可逆,dirty 标记正确', () => {
    const state = baseState({ analysis: { status: 'success', result: resultFixture() } });
    const edited = reducer(state, { type: 'UPDATE_TASK', id: 't-1', patch: { title: '改了' } });
    expect(edited.analysis.result.tasks[0].title).toBe('改了');
    expect(edited.dirty).toBe(true);
    const undone = reducer(edited, { type: 'UNDO' });
    expect(undone.analysis.result.tasks[0].title).toBe('任务一');
    const redone = reducer(undone, { type: 'REDO' });
    expect(redone.analysis.result.tasks[0].title).toBe('改了');
  });

  it('LOAD_SAVED:载入记录,demoMode=false,loadedRecordId 关联原记录', () => {
    const state = baseState();
    const next = reducer(state, {
      type: 'LOAD_SAVED',
      recordId: 'rec-1',
      saved: { savedAt: 1000, images: [{ id: 'up-1', name: 'a.png', url: '/api/uploads/up-1/content' }], result: resultFixture() },
    });
    expect(next.stage).toBe('results');
    expect(next.demoMode).toBe(false);
    expect(next.loadedRecordId).toBe('rec-1');
    expect(next.images[0].url).toBe('/api/uploads/up-1/content');
  });

  it('REMOVE_IMAGE:结果页移除图幅后来源引用被过滤', () => {
    const state = baseState({
      stage: 'results',
      images: [{ id: 'a' }, { id: 'b' }],
      analysis: { status: 'success', result: { ...resultFixture(), summary: { ...resultFixture().summary, oneLiner: { text: 'x', src: ['a'] } } } },
    });
    const next = reducer(state, { type: 'REMOVE_IMAGE', id: 'a' });
    expect(next.analysis.result.summary.oneLiner.src).toEqual([]);
    expect(next.dirty).toBe(true);
  });
});
