/* HomePage 归档面板:预览卡片、删除确认流(本地模式) */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StoreProvider, createInitialState } from '../state/store';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { HomePage } from './HomePage';

function renderHome(overrides = {}) {
  const state = createInitialState({ mode: 'local', booted: true });
  Object.assign(state, overrides);
  return render(
    <StoreProvider boot={false} testState={state}>
      <HomePage />
      <ConfirmDialog />
    </StoreProvider>
  );
}

describe('HomePage 归档面板', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('点击预览 → 弹窗显示归档文本内容', async () => {
    const user = userEvent.setup();
    renderHome({
      archives: [{ id: 'a1', title: '导出结果', format: 'TXT', content: '任务清单\n- 任务一', createdAt: Date.now() }],
    });
    await user.click(screen.getByRole('button', { name: '预览 / 下载' }));
    // 首页副标题也含「任务清单」,用 selector 限定到弹窗内的 <pre>
    expect(await screen.findByText(/任务清单/, { selector: 'pre' })).toBeInTheDocument();
  });

  it('删除归档:确认弹窗 → 确认后从列表移除', async () => {
    const user = userEvent.setup();
    renderHome({
      archives: [{ id: 'a1', title: '旧文件', format: 'TXT', content: 'x', createdAt: Date.now() }],
    });
    await user.click(screen.getByTitle('删除'));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('删除归档文件?')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '删除' }));
    expect(screen.queryByText('旧文件')).not.toBeInTheDocument();
  });

  it('重命名归档:行内编辑保存后标题更新', async () => {
    const user = userEvent.setup();
    renderHome({
      archives: [{ id: 'a1', title: '旧标题', format: 'TXT', content: 'x', createdAt: Date.now() }],
    });
    await user.click(screen.getByTitle('重命名'));
    const input = screen.getByDisplayValue('旧标题');
    await user.clear(input);
    await user.type(input, '新标题{Enter}');
    expect(screen.getByText('新标题')).toBeInTheDocument();
  });
});
