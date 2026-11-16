import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { Icons } from '../lib/icons';

/* 确认对话框:仅用于删除等需要阻断的操作 */
export function ConfirmDialog() {
  const { state, actions, runConfirm } = useStore();
  const confirm = state.confirm;
  const ref = useRef(null);

  useEffect(() => {
    if (confirm && ref.current) ref.current.focus();
  }, [confirm]);

  useEffect(() => {
    if (!confirm) return;
    const onKey = (e) => {
      if (e.key === 'Escape') actions.clearConfirm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirm, actions]);

  if (!confirm) return null;

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && actions.clearConfirm()}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-label={confirm.title}>
        <div className="modal-header">
          <h3 className="card-title">
            <Icons.warning size={18} />
            {confirm.title}
          </h3>
        </div>
        <div className="modal-body">{confirm.body}</div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={actions.clearConfirm}>
            取消
          </button>
          <button
            type="button"
            ref={ref}
            className={`btn ${confirm.danger ? 'btn-accent' : 'btn-primary'}`}
            onClick={() => {
              runConfirm();
              actions.clearConfirm();
            }}
          >
            {confirm.confirmLabel || '确认'}
          </button>
        </div>
      </div>
    </div>
  );
}
