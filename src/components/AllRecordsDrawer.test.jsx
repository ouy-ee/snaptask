/* 记录抽屉:标签筛选、搜索、批量删除确认流(本地模式) */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StoreProvider, createInitialState } from '../state/store';
import { ConfirmDialog } from './ConfirmDialog';
import { AllRecordsDrawer } from './AllRecordsDrawer';

function baseState() {
  const state = createInitialState({ mode: 'local', booted: true });
  state.folders = [
    { id: 'folder-inbox', name: '未整理' },
    { id: 'f1', name: '工作' },
  ];
  state.currentFolderId = 'folder-inbox';
  state.history = [
    { id: 'r1', title: '会议纪要', folderId: 'folder-inbox', isDeleted: false, savedAt: 1000, imageCount: 3, contentTags: ['待办', '资料'], saved: null },
    { id: 'r2', title: '产品需求', folderId: 'f1', isDeleted: false, savedAt: 2000, imageCount: 1, contentTags: ['资料'], saved: null },
  ];
  return state;
}

function renderDrawer(state = baseState()) {
  return render(
    <StoreProvider boot={false} testState={state}>
      <AllRecordsDrawer open onClose={() => {}} />
      <ConfirmDialog />
    </StoreProvider>
  );
}

describe('AllRecordsDrawer', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('标签筛选:待办标签只显示含待办的记录', async () => {
    const user = userEvent.setup();
    renderDrawer();
    await user.click(screen.getByRole('button', { name: '待办' }));
    expect(screen.getByText('会议纪要')).toBeInTheDocument();
    expect(screen.queryByText('产品需求')).not.toBeInTheDocument();
  });

  it('搜索过滤标题', async () => {
    const user = userEvent.setup();
    renderDrawer();
    await user.type(screen.getByLabelText('搜索记录'), '产品');
    expect(screen.queryByText('会议纪要')).not.toBeInTheDocument();
    expect(screen.getByText('产品需求')).toBeInTheDocument();
  });

  it('批量模式:勾选 → 批量删除 → 确认后移除', async () => {
    const user = userEvent.setup();
    renderDrawer();
    await user.click(screen.getByRole('button', { name: '☑ 批量操作' }));
    await user.click(screen.getByLabelText('选择 会议纪要'));
    await user.click(screen.getByRole('button', { name: '批量删除' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('批量删除 1 条记录?')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '删除' }));
    expect(screen.queryByText('会议纪要')).not.toBeInTheDocument();
    expect(screen.getByText('产品需求')).toBeInTheDocument();
  });
});
