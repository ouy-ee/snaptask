import { useEffect } from 'react';
import { useStore } from '../state/store';
import { Icons } from '../lib/icons';

export function ToastRegion() {
  const { state, actions } = useStore();
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {state.toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => actions.dismissToast(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }) {
  useEffect(() => {
    // 仅挂载时计时一次;onDismiss 内部走稳定的 dispatch,旧闭包同样有效
    const timer = setTimeout(onDismiss, toast.timeout ?? 3600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const Icon = toast.kind === 'error' ? Icons.warning : toast.kind === 'warn' ? Icons.warning : toast.kind === 'info' ? Icons.info : Icons.check;

  return (
    <div className={`toast ${toast.kind === 'error' ? 'error' : toast.kind === 'warn' ? 'warn' : ''}`}>
      <span className="icon"><Icon size={16} /></span>
      <span>{toast.text}</span>
      <button type="button" onClick={onDismiss}>关闭</button>
    </div>
  );
}
