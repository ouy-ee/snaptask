import { useRef, useState } from 'react';
import { useStore } from '../state/store';
import { ImageQueue } from '../components/ImageQueue';
import { ImagePreview } from '../components/ImagePreview';
import { Icons } from '../lib/icons';
import { formatBytes } from '../lib/utils';

const ACCEPT = 'image/png,image/jpeg,image/webp';

/* 截图工作区:左-图幅队列 / 中-大图预览 / 右-图幅信息与启动分析 */
export function WorkspacePage() {
  const { state, actions } = useStore();
  const addRef = useRef(null);
  const current = state.images.find((i) => i.id === state.currentImageId);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyImages = state.history.filter((record) => !record.isDeleted).flatMap((record) => (record.saved?.images || []).map((image) => ({ ...image, sourceTitle: record.title }))).filter((image) => image.url);

  const estimate = Math.max(8, state.images.length * 5);

  return (
    <div className="workspace-layout">
      <aside className="ws-left card" aria-label="截图列表">
        <div className="ws-left-head">
          <div className="ws-left-title"><h2 className="card-title">
            截图列表
            <span className="sub tabular">{state.images.length} / 6</span>
          </h2></div>
          <div className="ws-left-actions"><button type="button" className="btn btn-secondary btn-sm" onClick={() => addRef.current?.click()}><Icons.plus size={13} />添加截图</button><button type="button" className="history-image-link" onClick={() => setHistoryOpen(true)}><Icons.folder size={13} />历史图库</button></div>
          <input
            ref={addRef}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              actions.addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
        <ImageQueue />
      </aside>

      <main className="ws-center card" aria-label="图幅预览">
        <ImagePreview />
      </main>

      <aside className="ws-right" aria-label="图幅信息与分析">
        <section className="card ws-info">
          <div className="card-header">
            <h2 className="card-title">图幅信息</h2>
          </div>
          <div className="card-body col">
            {current ? (
              <>
                <div className="ws-info-row">
                  <span className="field-label">文件</span>
                  <span className="ellipsis" title={current.name}>{current.name}</span>
                </div>
                <p className="ws-image-meta tabular">{current.width} × {current.height} px <span>|</span> {formatBytes(current.sizeKb * 1024)}</p>
                <div className="ws-info-row">
                  <span className="field-label">质量</span>
                  <span className={`badge ${current.quality.score >= 85 ? 'badge-green' : current.quality.score >= 70 ? 'badge-warn' : 'badge-danger'}`}>
                    {current.quality.score} · {current.quality.label}
                  </span>
                </div>
                {current.quality.issues?.length > 0 && (
                  <ul className="ws-issues">
                    {current.quality.issues.map((iss) => (
                      <li key={iss} className="small"><Icons.warning size={12} /> {iss}</li>
                    ))}
                  </ul>
                )}
                <p className="xsmall muted">{state.mode === 'server' ? '质量评分由后端 OCR 预检与视觉模型评估。' : '质量提示由本地模拟评估;接入真实服务后,将返回 OCR 预检结果。'}</p>
              </>
            ) : (
              <p className="small muted">上传截图后,这里显示当前图幅的信息与质量提示。</p>
            )}
          </div>
        </section>

        <section className="card ws-analyze">
          <div className="card-header">
            <h2 className="card-title">分析</h2>
          </div>
          <div className="card-body col">
            <div className="ws-info-row">
              <span className="field-label">图幅数量</span>
              <span className="tabular">{state.images.length} 张{state.images.length ? (state.mode === 'server' ? ' · 预计 15~90 秒(云端 AI)' : ` · 预计 ${estimate} 秒`) : ''}</span>
            </div>
            {state.mode !== 'server' && (
              <>
                <div className="ws-info-row">
                  <span className="field-label">模拟场景</span>
                  <select
                    className="select"
                    value={state.scenarioChoice}
                    aria-label="选择演示场景"
                    onChange={(e) => actions.setScenario(e.target.value)}
                  >
                    <option value="auto">自动(按图幅质量推断)</option>
                    <option value="success">演示:全部识别成功</option>
                    <option value="partial">演示:部分成功 + 冲突警告</option>
                    <option value="failed">演示:分析失败(可重试)</option>
                  </select>
                </div>
                <p className="xsmall muted">
                  场景选择仅用于 Demo 演示 mock 状态;接入真实服务后,此选项将被移除。
                </p>
              </>
            )}
            <button
              type="button"
              className="btn btn-primary btn-lg"
              disabled={state.images.length === 0}
              onClick={() => actions.startAnalysis(state.scenarioChoice)}
            >
              <Icons.scan size={17} />
              开始分析 {state.images.length > 0 && `(${state.images.length} 张图幅)`}
            </button>
            {state.images.length === 0 && (
              <p className="xsmall muted">先添加至少一张截图,才能开始分析。</p>
            )}
            <button type="button" className="btn btn-ghost" onClick={actions.backToHome}>
              <Icons.arrowLeft size={14} />
              返回上传首页
            </button>
          </div>
        </section>
      </aside>
      {historyOpen && <div className="modal-backdrop" onMouseDown={() => setHistoryOpen(false)}><div className="modal history-image-modal" onMouseDown={(e) => e.stopPropagation()}><div className="modal-header row"><h2 className="card-title">从历史图库选择</h2><button type="button" className="icon-btn" onClick={() => setHistoryOpen(false)} aria-label="关闭"><Icons.x size={17} /></button></div><div className="history-image-grid">{historyImages.length ? historyImages.map((image, index) => <button type="button" className="history-image-option" key={`${image.id}-${index}`} onClick={() => { actions.restoreImage(image); setHistoryOpen(false); }}><img src={image.url} alt="" /><span className="ellipsis">{image.name}</span><span className="xsmall muted">{image.sourceTitle}</span></button>) : <div className="empty-state"><Icons.image size={24} /><h3>历史图库为空</h3><p className="small">保存分析结果后，截图会出现在这里。</p></div>}</div></div></div>}
    </div>
  );
}
