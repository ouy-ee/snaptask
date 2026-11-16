import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { StoreProvider, useStore } from './state/store';
import { HomePage } from './pages/HomePage';
import { WorkspacePage } from './pages/WorkspacePage';
import { AnalysisPage } from './pages/AnalysisPage';
import { ResultsPage } from './pages/ResultsPage';
import { LoginPage } from './pages/LoginPage';
import { SettingsPage } from './pages/SettingsPage';
import { StepRail } from './components/StepRail';
import { ToastRegion } from './components/Toast';
import { ConfirmDialog } from './components/ConfirmDialog';
import { Icons } from './lib/icons';
import { AccountCenter } from './components/AccountCenter';
import { AllRecordsDrawer } from './components/AllRecordsDrawer';

/* 阶段 ↔ URL 映射(stage 仍是唯一事实源,路由负责深链与返回键) */
const STAGE_PATHS = { home: '/', workspace: '/workspace', analyzing: '/analyzing', results: '/results' };

function BootScreen() {
  return (
    <div className="boot-screen" aria-live="polite">
      SnapTask 启动中…
    </div>
  );
}

function useStageSync() {
  const { state, actions } = useStore();
  const navigate = useNavigate();
  const location = useLocation();

  // stage 变化 → 同步 URL
  useEffect(() => {
    const path = STAGE_PATHS[state.stage];
    if (path && location.pathname !== path) navigate(path, { replace: true });
  }, [state.stage]); // eslint-disable-line react-hooks/exhaustive-deps

  // 浏览器返回/前进 → 带脏数据确认地切回对应 stage
  const stageRef = useRef(state.stage);
  useEffect(() => {
    const target = Object.entries(STAGE_PATHS).find(([, p]) => p === location.pathname)?.[0];
    if (target && target !== stageRef.current) {
      stageRef.current = target;
      actions.navigateTo(target);
    } else {
      stageRef.current = state.stage;
    }
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
}

function Shell() {
  const { state, actions } = useStore();
  const [recordsOpen, setRecordsOpen] = useState(false);
  useStageSync();

  return (
    <div className="app-shell">
      <header className="app-nav">
        <div className="nav-left">
          <button type="button" className="nav-logo" onClick={actions.backToHome} aria-label="返回上传首页">
            <span className="logo-mark" aria-hidden="true">
              <Icons.logo size={18} />
            </span>
            <span className="logo-name">SnapTask</span>
            <span className="logo-sub">{state.mode === 'server' ? '截图任务助手' : '截图任务助手 · Demo'}</span>
          </button>
        </div>
        <div className="nav-center">
          <StepRail />
        </div>
        <div className="nav-right">
          {state.demoMode && <span className="badge badge-info">示例数据</span>}
          {state.mode === 'server' && state.user && <span className="badge badge-neutral">云端</span>}
          {state.images.length > 0 && (
            <span className="nav-count tabular">{state.images.length} 张图幅</span>
          )}
          <button type="button" className="repo-chip" onClick={() => setRecordsOpen(true)}><Icons.clock size={14} />上传历史记录</button>
          <AccountCenter />
        </div>
      </header>

      <main className="app-main">
        {state.stage === 'home' && <HomePage />}
        {state.stage === 'workspace' && <WorkspacePage />}
        {state.stage === 'analyzing' && <AnalysisPage />}
        {state.stage === 'results' && <ResultsPage />}
      </main>

      <ToastRegion />
      <ConfirmDialog />
      <AllRecordsDrawer open={recordsOpen} onClose={() => setRecordsOpen(false)} />
    </div>
  );
}

/* 登录态与权限路由:云端模式未登录 → /login */
function Root() {
  const { state } = useStore();
  if (!state.booted) return <BootScreen />;
  if (state.mode === 'server' && !state.user) return <Navigate to="/login" replace />;
  return <Shell />;
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <StoreProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/*" element={<Root />} />
        </Routes>
      </StoreProvider>
    </BrowserRouter>
  );
}
