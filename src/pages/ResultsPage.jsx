import { useStore } from '../state/store';
import { LegendBar } from '../components/LegendBar';
import { SummaryPanel } from '../components/SummaryPanel';
import { FactsPanel } from '../components/FactsPanel';
import { TaskList } from '../components/TaskList';
import { ComparisonTable } from '../components/ComparisonTable';
import { Icons } from '../lib/icons';
import { legendClass, formatBytes } from '../lib/utils';
import { useEffect, useRef, useState } from 'react';
import { getContentTags, downloadResult, buildExportText } from '../lib/exportResult';

function ContentTags({ result }) {
  return <span className="content-tags">{getContentTags(result).map((tag) => <span className={`content-tag ${tag === '待办' ? 'tag-task' : 'tag-info'}`} key={tag}>{tag === '待办' ? '待办事项' : '资料整理'}</span>)}</span>;
}

function ExportPopover({ result, onClose, onExport }) {
  const [selected, setSelected] = useState({ summary: true, tasks: true, facts: false, comparison: result.scene_type === 'COMPARISON' });
  const [archive, setArchive] = useState(true);
  const toggle = (key) => setSelected((current) => ({ ...current, [key]: !current[key] }));
  return <div className="action-popover export-popover"><div className="popover-title">选择导出内容</div>{[['summary', 'AI 一句话总结'], ['tasks', '任务清单'], ['facts', '结构化原始数据'], ['comparison', '方案对比']].filter(([, label]) => label !== '方案对比' || result.comparison).map(([key, label]) => <label className="popover-check" key={key}><input type="checkbox" checked={selected[key]} onChange={() => toggle(key)} />{label}</label>)}<label className="popover-check export-archive-check"><input type="checkbox" checked={archive} onChange={(e) => setArchive(e.target.checked)} />导出同时，在首页“归档文件”中留存</label><div className="popover-actions"><button className="btn btn-secondary btn-sm" onClick={() => { onExport(selected, 'txt', archive); onClose(); }}>下载为 TXT</button><button className="btn btn-primary btn-sm" onClick={() => { onExport(selected, 'md', archive); onClose(); }}>下载为 Markdown</button></div></div>;
}

function ArchivePopover({ state, actions, onClose }) {
  const [folderId, setFolderId] = useState(state.currentFolderId);
  const [newFolder, setNewFolder] = useState('');
  return <div className="action-popover archive-popover"><div className="popover-title">保存至文件夹</div><select className="select" value={folderId} onChange={(e) => setFolderId(e.target.value)}>{state.folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select><div className="new-archive-row"><input className="input" value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="新建文件夹" /><button className="icon-btn" title="创建并切换文件夹" onClick={() => { const id = actions.createFolder(newFolder); if (id) setFolderId(id); setNewFolder(''); }}> <Icons.plus size={14} /></button></div><button className="btn btn-primary" onClick={() => { actions.saveResult(folderId); onClose(); }}>保存当前结果</button></div>;
}

function KnowledgeCard({ result }) {
  return <section className="scene-card card" aria-labelledby="knowledge-title"><div className="card-header"><h2 className="card-title" id="knowledge-title"><Icons.grid size={16} />核心知识点</h2></div><div className="knowledge-list">{(result.keyFacts || result.facts || []).map((item) => <div className="knowledge-item" key={item.id}><strong>{item.text || item.value || item.label}</strong><span className="xsmall muted">核心提取</span></div>)}</div></section>;
}

function InlineSourcePanel({ state, actions, onAddNew, onReplace, onDelete, onOpenHistory, fileRef }) {
  const replaceRef = useRef(null);
  const image = state.sourceViewer ? state.images.find((item) => item.id === state.sourceViewer.imageId) : null;
  const expanded = !!image;
  const replaceCurrent = (file) => { if (file) onReplace(image.id, file); };
  const addInput = <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => { onAddNew(e.target.files); e.target.value = ''; }} />;
  if (!expanded) return <aside className="res-left card" aria-label="来源图幅"><div className="res-left-head">来源图幅</div><ul className="res-img-list">{state.images.map((img) => <li key={img.id}><button type="button" className="res-img-btn" onClick={() => actions.openSourceViewer({ imageId: img.id })} title={`打开图幅 ${img.legendIndex}:${img.name}`}><img src={img.url || undefined} alt="" loading="lazy" />{!img.url && <span className="res-img-ph">无原图</span>}<span className={`legend-dot legend-dot-lg ${legendClass(img.legendIndex)}`}>{img.legendIndex}</span></button></li>)}</ul><div className="source-add-zone"><button type="button" onClick={() => fileRef.current?.click()}><Icons.plus size={16} />添加截图</button><span>支持拖拽或点击</span></div>{addInput}</aside>;
  return <aside className="res-left card source-expanded" aria-label="来源图幅">
    <div className="source-inline-head"><h3><span className={`legend-dot ${legendClass(image.legendIndex)}`}>{image.legendIndex}</span><span className="ellipsis">来源图幅 · {image.name}</span></h3><button type="button" className="icon-btn" onClick={actions.closeSourceViewer} aria-label="关闭来源图幅"><Icons.x size={16} /></button></div>
    <div className="source-inline-meta"><span>{image.width} × {image.height} px</span><span>{formatBytes(image.sizeKb * 1024)}</span><span className="badge badge-green">质量 {image.quality.score}</span></div>
    <div className="source-inline-body">{image.url ? <img src={image.url} alt={`截图:${image.name}`} /> : <p className="small muted">该图幅未保留原始图片。</p>}</div>
    <div className="source-inline-manage"><button type="button" className="btn btn-secondary btn-sm" onClick={() => replaceRef.current?.click()}><Icons.retry size={14} />替换此图</button><button type="button" className="btn btn-danger btn-sm" onClick={() => onDelete(image.id)}><Icons.trash size={14} />删除此图</button></div>
    <input ref={replaceRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { replaceCurrent(e.target.files?.[0]); e.target.value = ''; }} />
    <p className="source-inline-note xsmall muted">{state.mode === 'server' ? '高亮区域由云端 AI 识别标注,点击左侧图幅可查看来源定位。' : '该区域由 mock 数据标注，仅用于演示来源追溯。'}</p>
    <div className="source-inline-footer"><button type="button" className="btn btn-primary btn-sm" onClick={() => fileRef.current?.click()}><Icons.plus size={14} />添加新截图</button><button type="button" className="btn btn-secondary btn-sm" onClick={onOpenHistory}><Icons.folder size={14} />从历史图库选</button></div>{addInput}
  </aside>;
}

/* 分析结果工作区:图例栏 + 三栏(来源图 / 结果内容 / 风险警告) */
export function ResultsPage() {
  const { state, actions } = useStore();
  const result = state.analysis?.result;
  const partial = state.analysis?.status === 'partial_success';
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [historyPickerOpen, setHistoryPickerOpen] = useState(false);
  const [selectedHistoryImages, setSelectedHistoryImages] = useState([]);
  const [pendingAdded, setPendingAdded] = useState(0);
  const fileRef = useRef(null);
  const historyImages = state.history.filter((record) => !record.isDeleted).flatMap((record) => (record.saved?.images || []).map((image) => ({ ...image, sourceTitle: record.title }))).filter((image) => image.url);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (state.dirty) actions.saveCurrent();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state.dirty, actions]);

  const askReanalyze = (count) => { if (count > 0) setPendingAdded(count); };
  const addNewScreenshots = async (files) => { const count = await actions.addFiles(files); askReanalyze(count); };
  const exportResult = (selected, format, archive) => { downloadResult(result, selected, format); if (archive) { actions.addArchive({ title: result.summary?.oneLiner?.text || '截图分析结果', format: format.toUpperCase(), taskName: result.tasks?.[0]?.title || '截图分析', content: buildExportText(result, selected, format) }); actions.toast('ok', `已导出并保存到首页归档文件`); } };
  const replaceScreenshot = async (id, file) => { if (await actions.replaceImage(id, file)) askReanalyze(1); };
  const deleteScreenshot = (id) => { if (state.images.length <= 1) { actions.toast('warn', '至少保留一张图'); return; } actions.removeImage(id); actions.closeSourceViewer(); askReanalyze(0); setPendingAdded(1); };

  /* 刷新恢复:重新分析后直接进入结果页;编辑状态在保存前不跨页保留 */
  if (!result) return null;

  return (
    <div className="results-layout">
      <div className="results-toolbar">
        <LegendBar />
        <div className="toolbar-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={actions.returnHome}><Icons.arrowLeft size={14} />首页</button>
          <span className={`save-state ${state.dirty ? 'dirty' : ''}`}>
            {state.dirty ? (
              <><Icons.warning size={13} /> 有未保存的修改</>
            ) : state.savedAt ? (
              <><Icons.check size={13} /> 已保存 {new Date(state.savedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</>
            ) : (
              <span className="muted">自动保存:关闭</span>
            )}
          </span>
          <button type="button" className={`btn btn-sm ${state.dirty ? 'btn-secondary save-current-active' : 'btn-ghost'}`} onClick={actions.saveCurrent} disabled={!state.dirty} title="保存当前修改 (Ctrl+S)">
            <Icons.save size={14} />保存
          </button>
          <button type="button" className="icon-btn" aria-label="撤销" title="撤销" disabled={!state.past.length} onClick={actions.undo}>
            <Icons.undo size={15} />
          </button>
          <button type="button" className="icon-btn" aria-label="恢复" title="恢复" disabled={!state.future.length} onClick={actions.redo}>
            <Icons.redo size={15} />
          </button>
          <div className="action-popover-wrap"><button type="button" className="btn btn-secondary btn-sm" onClick={() => { setExportOpen(!exportOpen); setArchiveOpen(false); }}><Icons.download size={14} />导出</button>{exportOpen && <ExportPopover result={result} onClose={() => setExportOpen(false)} onExport={exportResult} />}</div>
          <div className="action-popover-wrap"><button type="button" className="btn btn-primary btn-sm" onClick={() => { setArchiveOpen(!archiveOpen); setExportOpen(false); }}><Icons.folder size={14} />保存至文件夹</button>{archiveOpen && <ArchivePopover state={state} actions={actions} onClose={() => setArchiveOpen(false)} />}</div>
        </div>
      </div>

      {partial && (
        <div className="partial-banner" role="status">
          <Icons.info size={15} />
          分析部分完成:部分图幅识别受限,受影响字段已标注「不确定」或「未提及」,详见右侧警告。
        </div>
      )}

      <div className="results-grid result-refactor-grid">
        <InlineSourcePanel state={state} actions={actions} onAddNew={addNewScreenshots} onReplace={replaceScreenshot} onDelete={deleteScreenshot} onOpenHistory={() => setHistoryPickerOpen(true)} fileRef={fileRef} />

        <main className="res-center result-main-content">
          <div className="summary-with-tags"><SummaryPanel summary={result.summary} warnings={result.warnings} /><ContentTags result={result} /></div>
          <div className="scene-cards">
            {(result.scene_type === 'KNOWLEDGE') ? <KnowledgeCard result={result} /> : <TaskList tasks={result.tasks} suggestions={result.summary?.suggestions || []} onSync={() => actions.syncTasks(result.tasks)} />}
            {result.scene_type === 'COMPARISON' && <ComparisonTable comparison={result.comparison} />}
          </div>
          <section className={`details-drawer ${detailsOpen ? 'open' : ''}`}>
            <button type="button" className="details-toggle" onClick={() => setDetailsOpen(!detailsOpen)} aria-expanded={detailsOpen}>
              <span>{detailsOpen ? '▲' : '▼'} 查看提取详情</span><span className="badge badge-neutral">{result.facts?.length || 0} 个字段</span>
            </button>
            {detailsOpen && <div className="details-content"><FactsPanel facts={result.facts} keyFacts={result.keyFacts} /></div>}
          </section>
        </main>
      </div>

      {pendingAdded > 0 && <div className="modal-backdrop"><div className="modal reanalyze-modal" role="dialog" aria-modal="true" aria-labelledby="reanalyze-title"><div className="modal-header"><h2 className="card-title" id="reanalyze-title">当前任务图片已有变动</h2></div><div className="modal-body">是否立即重新分析并更新结果？</div><div className="modal-footer"><button type="button" className="btn btn-ghost" onClick={() => setPendingAdded(0)}>暂不更新</button><button type="button" className="btn btn-primary" onClick={() => { setPendingAdded(0); actions.reanalyzeCurrent(); }}>立即重新分析</button></div></div></div>}
      {historyPickerOpen && <div className="modal-backdrop" onMouseDown={() => setHistoryPickerOpen(false)}><div className="modal history-image-modal" onMouseDown={(e) => e.stopPropagation()}><div className="modal-header row"><h2 className="card-title">从历史图库选择</h2><button type="button" className="icon-btn" onClick={() => setHistoryPickerOpen(false)}><Icons.x size={16} /></button></div><div className="history-image-grid">{historyImages.length ? historyImages.map((image, index) => { const key = `${image.id}-${index}`; const checked = selectedHistoryImages.some((item) => item.id === image.id); return <button type="button" className={`history-image-option ${checked ? 'selected' : ''}`} key={key} onClick={() => setSelectedHistoryImages((current) => checked ? current.filter((item) => item.id !== image.id) : [...current, image])}><img src={image.url} alt="" /><span className="ellipsis">{image.name}</span><span className="xsmall muted">{image.sourceTitle}</span></button>; }) : <div className="empty-state"><Icons.image size={24} /><h3>历史图库为空</h3></div>}</div><div className="modal-footer"><button type="button" className="btn btn-ghost" onClick={() => setHistoryPickerOpen(false)}>取消</button><button type="button" className="btn btn-primary" disabled={!selectedHistoryImages.length} onClick={() => { actions.addHistoryImages(selectedHistoryImages); askReanalyze(selectedHistoryImages.length); setSelectedHistoryImages([]); setHistoryPickerOpen(false); }}>添加选中截图</button></div></div></div>}

      <div className="results-foot">
        <button type="button" className="btn btn-secondary" onClick={actions.backToWorkspace}>
          <Icons.arrowLeft size={14} />
          返回截图工作区
        </button>
        <button type="button" className="btn btn-primary" onClick={actions.returnHome}><Icons.home size={14} />返回首页</button>
        <span className="xsmall muted">
          {state.mode === 'server' ? '结果由云端 AI 生成,每条结论均标注来源图幅。' : '结果由本地 mock 服务生成(合成演示数据)。接入真实 AI 服务后,此处展示真实分析结果。'}
        </span>
      </div>
    </div>
  );
}
