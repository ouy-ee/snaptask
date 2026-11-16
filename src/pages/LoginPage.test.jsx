/* 登录页:渲染、空表单校验提示、模式守卫 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { StoreProvider, createInitialState } from '../state/store';
import { LoginPage } from './LoginPage';

function renderLogin(state) {
  return render(
    <MemoryRouter initialEntries={['/login']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <StoreProvider boot={false} testState={state}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>HOME</div>} />
        </Routes>
      </StoreProvider>
    </MemoryRouter>
  );
}

describe('LoginPage', () => {
  it('云端模式未登录 → 渲染登录/注册切换', () => {
    renderLogin(createInitialState({ mode: 'server', booted: true }));
    expect(screen.getByRole('tab', { name: '登录' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '注册' })).toBeInTheDocument();
  });

  it('空表单提交 → 显示校验错误', async () => {
    const user = userEvent.setup();
    const { container } = renderLogin(createInitialState({ mode: 'server', booted: true }));
    // 页签与提交按钮文案同为「登录」,用表单内 submit 按钮精确定位
    const submit = container.querySelector('form button[type="submit"]');
    await user.click(submit);
    expect(await screen.findByText('请填写邮箱与密码')).toBeInTheDocument();
  });

  it('本地模式 → 重定向回首页', () => {
    renderLogin(createInitialState({ mode: 'local', booted: true }));
    expect(screen.getByText('HOME')).toBeInTheDocument();
  });

  it('已登录 → 重定向回首页', () => {
    const state = createInitialState({ mode: 'server', booted: true });
    state.user = { name: '林晓', email: 'lin@t.com' };
    renderLogin(state);
    expect(screen.getByText('HOME')).toBeInTheDocument();
  });
});
