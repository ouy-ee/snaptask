import { useStore } from '../state/store';
import { Icons } from '../lib/icons';
import { SourceRef } from './SourceRef';

const TYPE_META = {
  conflict: { label: '信息冲突', icon: Icons.compare },
  'missing-assignee': { label: '缺负责人', icon: Icons.user },
  'missing-due': { label: '缺截止时间', icon: Icons.clock },
  'low-quality': { label: '图幅质量低', icon: Icons.image },
  'low-confidence': { label: '低置信度', icon: Icons.info },
  duplicate: { label: '内容重复', icon: Icons.layers },
};

const SEVERITY_META = {
  high: { label: '高', cls: 'badge-danger' },
  medium: { label: '中', cls: 'badge-warn' },
  low: { label: '低', cls: 'badge-neutral' },
};

/* 风险与警告面板:类型、严重程度、说明、关联结果跳转、来源、处理动作 */
export function WarningPanel({ warnings }) {
  const { state, actions } = useStore();
  const flashId = state.flash?.id;

  if (!warnings || warnings.length === 0) {
    return (
      <aside className="card warnings-panel" aria-label="风险与警告">
        <div className="card-header">
          <h2 className="card-title"><Icons.check size={16} /> 风险与警告</h2>
        </div>
        <div className="card-body">
          <p className="small muted">未发现冲突、缺失或低质量图幅。所有字段均可追溯来源。</p>
        </div>
      </aside>
    );
  }

  const locate = (w) => {
    const target = w.related?.id;
    if (!target) return;
    if (w.related.kind === 'image') {
      const img = state.images.find((i) => i.legendIndex === Number(target));
      if (img) {
        actions.openSourceViewer({ imageId: img.id });
      } else {
        actions.toast('warn', '该图幅已不在当前队列中');
      }
      return;
    }
    actions.flash(target);
    const el = document.getElementById(`item-${target}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => actions.clearFlash(), 1800);
    } else {
      actions.toast('warn', '关联项已被删除或不在当前结果中');
    }
  };

  return (
    <aside className="card warnings-panel" aria-labelledby="warnings-title">
      <div className="card-header">
        <h2 className="card-title" id="warnings-title">
          <Icons.warning size={16} />
          风险与警告
          <span className={`badge ${warnings.some((w) => w.severity === 'high') ? 'badge-danger' : 'badge-warn'}`}>
            {warnings.length} 条
          </span>
        </h2>
      </div>
      <div className="warnings-list">
        {warnings.map((w) => {
          const meta = TYPE_META[w.type] || { label: w.type, icon: Icons.info };
          const sev = SEVERITY_META[w.severity];
          const Icon = meta.icon;
          const isFlash = flashId === w.related?.id;
          return (
            <div key={w.id} className={`warning-item severity-${w.severity} ${isFlash ? 'flash' : ''}`}>
              <div className="warning-head">
                <span className="warning-icon" aria-hidden="true"><Icon size={15} /></span>
                <span className="warning-type">{meta.label}</span>
                <span className={`badge ${sev.cls}`}>{sev.label}危</span>
              </div>
              <h4 className="warning-title">{w.title}</h4>
              <p className="warning-msg">{w.message}</p>
              {w.related && (
                <button type="button" className="warning-link" onClick={() => locate(w)}>
                  <Icons.pin size={13} />
                  关联结果:{w.related.label}
                </button>
              )}
              <div className="warning-foot">
                <SourceRef src={w.src} compact />
                <div className="row" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {(w.actions || []).map((a) => (
                    <button
                      type="button"
                      key={a}
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        if (a.includes('定位')) locate(w);
                        else if (a.includes('确认') || a.includes('保留') || a.includes('重复') || a.includes('标注')) {
                          actions.dismissWarning(w.id);
                          actions.toast('ok', `已处理:「${w.title}」`);
                        } else if (a.includes('重试')) {
                          actions.toast('info', '重试识别为演示动作:接入真实服务后,此处将重新发起识别请求');
                        } else if (a.includes('查看')) {
                          if (w.src.length) actions.openSourceViewer({ imageId: w.src[0] });
                          else actions.toast('warn', '该警告没有关联图幅');
                        }
                      }}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
