/* ============================================================
   登录 / 注册页(云端模式)。复用设计系统 token(tokens.css)。
   ============================================================ */

import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import { friendlyMessage } from '../api/service';

export function LoginPage() {
  const { state, actions } = useStore();
  const navigate = useNavigate();
  const [tab, setTab] = useState('login'); // login | register
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!state.booted) {
    return <div className="boot-screen" aria-live="polite">SnapTask 启动中…</div>;
  }
  if (state.mode === 'local') return <Navigate to="/" replace />;
  if (state.user) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (!email.trim() || !password) {
      setError('请填写邮箱与密码');
      return;
    }
    if (tab === 'register' && !name.trim()) {
      setError('请填写称呼');
      return;
    }
    if (tab === 'register' && password.length < 8) {
      setError('密码至少 8 位');
      return;
    }
    setBusy(true);
    const res = await actions.signIn({ name, email, password, isRegister: tab === 'register' });
    setBusy(false);
    if (res?.ok) navigate('/', { replace: true });
    else if (res?.error) setError(friendlyMessage(res.error));
  };

  return (
    <div className="login-layout">
      <div className="login-card card">
        <div className="login-brand" aria-hidden="true">
          <span className="login-brand-mark">SnapTask</span>
          <span className="xsmall muted">截图任务助手 · 云端模式</span>
        </div>

        <div className="login-tabs" role="tablist" aria-label="登录或注册">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'login'}
            className={tab === 'login' ? 'active' : ''}
            onClick={() => { setTab('login'); setError(''); }}
          >
            登录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'register'}
            className={tab === 'register' ? 'active' : ''}
            onClick={() => { setTab('register'); setError(''); }}
          >
            注册
          </button>
        </div>

        <form className="login-form" onSubmit={submit} noValidate>
          {tab === 'register' && (
            <label className="field-label">
              称呼
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如:林晓" autoComplete="name" />
            </label>
          )}
          <label className="field-label">
            邮箱
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" autoFocus />
          </label>
          <label className="field-label">
            密码
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={tab === 'register' ? '至少 8 位' : '请输入密码'}
              autoComplete={tab === 'register' ? 'new-password' : 'current-password'}
            />
          </label>

          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
            {busy ? '请稍候…' : tab === 'register' ? '注册并进入工作台' : '登录'}
          </button>
        </form>

        <p className="xsmall muted login-note">
          登录后截图、历史记录与待办将同步到云端,多设备共享。
          <br />
          未部署后端?去掉后端后应用自动回到本地 Demo 模式。
        </p>
      </div>
    </div>
  );
}
