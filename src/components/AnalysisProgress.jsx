import { useStore } from '../state/store';
import { Icons } from '../lib/icons';
import { ANALYSIS_STAGES } from '../mock/service';
import { legendClass } from '../lib/utils';

/* 模拟分析过程:阶段轨道 + 比例尺进度 + 图幅状态 + 失败/重试 */
export function AnalysisProgress() {
  const { state, actions } = useStore();
  const a = state.analysis;
  if (!a) return null;

  const failed = a.status === 'failed';
  const retrying = a.status === 'retrying';
  const paused = a.status === 'paused';

  return (
    <div className="analysis-panel card">
      <div className="card-header">
        <h2 className="card-title">
          <Icons.scan size={17} />
          {retrying ? '正在重试分析…' : failed ? '分析未完成' : paused ? '分析已暂停' : '分析进行中'}
          <span className="badge badge-neutral">{state.mode === 'server' ? '云端 AI' : '本地模拟'}</span>
        </h2>
        <span className="small muted tabular">{a.processed} / {a.total} 张图幅</span>
      </div>

      <div className="card-body analysis-body">
        {/* 阶段轨道 */}
        <ol className="stage-track" aria-label="分析阶段">
          {ANALYSIS_STAGES.map((s, i) => {
            const done = !failed && i < a.stageIndex;
            const current = !failed && i === a.stageIndex && !retrying && !paused;
            const stateCls = done ? 'done' : current ? 'current' : failed && i === a.stageIndex ? 'failed' : '';
            return (
              <li key={s.key} className={`stage-node ${stateCls}`} aria-current={current ? 'step' : undefined}>
                <span className="stage-dot">
                  {done ? <Icons.check size={12} /> : failed && i === a.stageIndex ? <Icons.x size={12} /> : i + 1}
                </span>
                <span className="stage-label">{s.label}</span>
                {current && <span className="stage-hint muted">{s.hint}</span>}
              </li>
            );
          })}
        </ol>

        {!failed && (
          <div className="progress-scale">
            <div
              className="fill"
              style={{ width: `${Math.min(100, ((a.stageIndex + (a.processed > 0 && a.stageIndex === 1 ? (a.processed / a.total) * 0.9 : 0.9)) / ANALYSIS_STAGES.length) * 100)}%` }}
            />
            <div className="ticks" />
          </div>
        )}

        {/* 图幅处理状态 */}
        <ul className="image-progress-list" aria-label="图幅处理状态">
          {state.images.map((img) => {
            const recognized = a.stageIndex > 1 || (a.stageIndex === 1 && a.processed >= img.legendIndex) || (failed && a.processed >= img.legendIndex);
            const done = !failed && recognized;
            const isCurrent = !failed && a.stageIndex === 1 && a.processed === img.legendIndex - 1;
            return (
              <li key={img.id} className={done ? 'done' : isCurrent ? 'current' : ''}>
                <span className={`legend-dot ${legendClass(img.legendIndex)}`}>{img.legendIndex}</span>
                <span className="ellipsis">{img.name}</span>
                <span className="xsmall muted">
                  {done ? '已完成' : isCurrent ? '识别中…' : failed ? (recognized ? '已识别' : '未完成') : '等待中'}
                </span>
              </li>
            );
          })}
        </ul>

        <p className="analysis-note small muted" role="status" aria-live="polite">
          {failed ? a.error?.detail : paused ? '已暂停，点击“继续分析”后将从当前位置继续' : retrying ? '已重新发起分析,请稍候…' : a.note || '准备开始…'}
        </p>

        {failed ? (
          <div className="error-state" style={{ padding: 'var(--s-5) var(--s-4)' }}>
            <div className="glyph"><Icons.warning size={24} /></div>
            <h3>{a.error?.title}</h3>
            <div className="actions">
              <button type="button" className="btn btn-primary" onClick={actions.retryAnalysis} disabled={retrying}>
                <Icons.retry size={15} />
                {retrying ? '正在重试…' : '重试分析'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={actions.backToWorkspace}>
                返回截图工作区
              </button>
            </div>
          </div>
        ) : (
          <div className="analysis-actions">
            <button type="button" className="btn btn-secondary" onClick={actions.cancelAnalysis}>
              取消并返回工作区
            </button>
            <button type="button" className="btn btn-primary" onClick={paused ? actions.resumeAnalysis : actions.pauseAnalysis}>
              {paused ? <><Icons.play size={15} />继续分析</> : <><Icons.pause size={15} />暂停分析</>}
            </button>
            <span className="xsmall muted">{state.mode === 'server' ? '云端 AI 分析中,预计 15~90 秒完成' : '分析由 mock 服务模拟,预计 15 秒内完成'}</span>
          </div>
        )}
      </div>
    </div>
  );
}
