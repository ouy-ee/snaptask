/* 测试环境初始化:
   1) jest-dom 的 Vitest 专用入口(注册 toBeInTheDocument 等 matcher)
   2) 显式 cleanup——未开启 vitest globals 时,RTL 不会自动注册 afterEach 清理,
      否则多次 render 的 DOM 会残留导致「multiple elements」误报 */
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
