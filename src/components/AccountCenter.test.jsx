/* HistoryPanel(我的文件夹):新建/重命名文件夹、删除记录确认流(本地模式) */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StoreProvider, createInitialState } from '../state/store';
import { ConfirmDialog } from './ConfirmDialog';
import { HistoryPanel } from './AccountCenter';

function baseState() {
  const state = createInitialState({ mode: 'local', booted: true });
  state.folders = [
    { id: 'folder-inbox', name: '未整理' },
    { id: 'f1', name: '工作' },
  ];
  state.currentFolderId = 'f1';
  state.history = [
    { id: 'r1', title: '会议纪要', folderId: 'f1', isDeleted: false, savedAt: 1000, imageCount: 3, contentTags: ['待办'], saved: null },
  ];
  return state;
}

function renderPanel(state = baseState()) {
  return render(
    <StoreProvider boot={false} testState={state}>
      <HistoryPanel />
      <ConfirmDialog />
    </StoreProvider>
  );
}

describe('HistoryPanel', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('新建文件夹:输入名称回车后出现在列表中', async () => {
    const user = userEvent.setup();
    renderPanel();
    const input = screen.getByPlaceholderText('新建文件夹');
    await user.type(input, '项目A{Enter}');
    expect(screen.getByText('项目A')).toBeInTheDocument();
  });

  it('重命名文件夹:行内编辑保存后名称更新', async () => {
    const user = userEvent.setup();
    renderPanel();
    // 每个文件夹行都有同名按钮,必须把查询范围限定到「工作」所在的行
    const workRow = screen.getByText('工作').closest('.folder-row');
    await user.click(within(workRow).getByTitle('重命名文件夹'));
    const input = screen.getByDisplayValue('工作');
    await user.clear(input);
    await user.type(input, '工作2{Enter}');
    expect(screen.getByText('工作2')).toBeInTheDocument();
  });

  it('删除记录:确认弹窗 → 确认后记录消失', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByLabelText('删除记录:会议纪要'));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('删除该记录?')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '删除' }));
    expect(screen.queryByText('会议纪要')).not.toBeInTheDocument();
  });
});
