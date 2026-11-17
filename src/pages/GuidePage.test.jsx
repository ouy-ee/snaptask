/* 使用指南页:渲染标题、章节与表格,不依赖登录态 */

import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GuidePage } from './GuidePage';

function renderGuide() {
  return render(
    <MemoryRouter initialEntries={['/guide']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <GuidePage />
    </MemoryRouter>
  );
}

describe('GuidePage', () => {
  it('渲染指南标题与主要章节', () => {
    renderGuide();
    expect(screen.getByText('SnapTask 使用指南(用户版)')).toBeInTheDocument();
    expect(screen.getByText('快速上手(5 步)')).toBeInTheDocument();
    expect(screen.getByText('页面与功能详解')).toBeInTheDocument();
    expect(screen.getByText('常见问题')).toBeInTheDocument();
  });

  it('渲染结果页区块对照表', () => {
    renderGuide();
    /* 「AI 总结」在开头能力列表里也出现,故把断言限定在表格范围内 */
    const table = screen.getByRole('table');
    expect(within(table).getByText('AI 总结')).toBeInTheDocument();
    expect(within(table).getByText('风险警告')).toBeInTheDocument();
    expect(within(table).getByText('核心知识点')).toBeInTheDocument();
  });

  it('提供返回首页入口', () => {
    renderGuide();
    expect(screen.getByRole('button', { name: '返回首页' })).toBeInTheDocument();
  });
});
