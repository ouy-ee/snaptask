/* ============================================================
   账号设置(云端模式):称呼、修改密码、数据导出、注销账号
   ============================================================ */

import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import { serverApi, setTokens, friendlyMessage } from '../api/service';
import { Icons } from '../lib/icons';

export function SettingsPage() {
  const { state, actions } = useStore();
  const navigate = useNavigate();
  const [name, setName] = useState(state.user?.name || '');
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  if (!state.booted) {
    return <div className="boot-screen" aria-live="polite">SnapTask 启动中…</div>;
  }
  if (state.mode !== 'server' || !state.user) return <Navigate to="/" replace />;

  const saveName = async (e) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError('称呼不能为空');
    setBusy(true);
    const res = await actions.updateProfile(name.trim());
    setBusy(false);
    if (!res?.ok) setError('保存失败,请重试');
  };

  const savePassword = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    if (!pw.current || !pw.next) return setError('请填写完整');
    if (pw.next.length < 8) return setError('新密码至少 8 位');
    if (pw.next !== pw.confirm) return setError('两次输入的新密码不一致');
    setBusy(true);
    try {
      const res = await serverApi.me.changePassword(pw.current, pw.next);
      setTokens(res); // 服务端已撤销其他会话并返回新令牌对
      setPw({ current: '', next: '', confirm: '' });
      setNotice('密码已更新,其他设备已退出登录');
    } catch (err) {
      setError(friendlyMessage(err));
    }
    setBusy(false);
  };

  const exportData = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await serverApi.me.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `snaptask-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      actions.toast('ok', '已导出(结构化数据,不含原图文件)');
    } catch (err) {
      setError(friendlyMessage(err));
    }
    setBusy(false);
  };

  const deleteAccount = () => {
    actions.confirmThen(
      {
        title: '注销账号?',
        body: '将永久删除你的全部数据:记录、截图、待办、归档与登录会话,且不可恢复。建议先导出数据备份。',
        confirmLabel: '永久注销',
        danger: true,
      },
      async () => {
        try {
          await serverApi.me.deleteAccount();
          await actions.signOut();
          navigate('/', { replace: true });
        } catch (err) {
          actions.toast('error', friendlyMessage(err));
        }
      }
    );
  };

  return (
    <div className="login-layout settings-layout">
      <div className="login-card card settings-card">
        <div className="login-brand" aria-hidden="true">
          <span className="login-brand-mark">账号设置</span>
          <span className="xsmall muted">{state.user.email}</span>
        </div>

        {notice && <p className="settings-notice" role="status">{notice}</p>}
        {error && <p className="login-error" role="alert">{error}</p>}

        <form className="login-form" onSubmit={saveName} noValidate>
          <h3 className="settings-section-title">个人资料</h3>
          <label className="field-label">
            称呼
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如:林晓" />
          </label>
          <button type="submit" className="btn btn-secondary" disabled={busy}>保存称呼</button>
        </form>

        <form className="login-form" onSubmit={savePassword} noValidate>
          <h3 className="settings-section-title">修改密码</h3>
          <label className="field-label">
            当前密码
            <input className="input" type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" />
          </label>
          <label className="field-label">
            新密码
            <input className="input" type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} placeholder="至少 8 位" autoComplete="new-password" />
          </label>
          <label className="field-label">
            确认新密码
            <input className="input" type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} autoComplete="new-password" />
          </label>
          <button type="submit" className="btn btn-secondary" disabled={busy}>更新密码</button>
        </form>

        <div className="login-form">
          <h3 className="settings-section-title">数据</h3>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={exportData}>
            <Icons.download size={14} /> 导出全部数据(JSON)
          </button>
        </div>

        <div className="login-form settings-danger">
          <h3 className="settings-section-title danger-text">危险区</h3>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={deleteAccount}>注销账号并删除全部数据</button>
        </div>

        <p className="login-note">
          <button type="button" className="text-action" onClick={() => navigate('/', { replace: true })}>← 返回工作台</button>
        </p>
      </div>
    </div>
  );
}
