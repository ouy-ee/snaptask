import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { Icons } from '../lib/icons';
import { getContentTags } from '../lib/exportResult';

const TABS = [['all', '全部'], ['task', '待办'], ['info', '资料'], ['trash', '🗑️ 回收站']];

export function AllRecordsDrawer({ open, onClose }) {
  const { state, actions } = useStore();
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('newest'); // newest | oldest
  const [folderFilter, setFolderFilter] = useState('');
  const [batchMode, setBatchMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [moving, setMoving] = useState(null);
  const folderName = (id) => state.folders.find((folder) => folder.id === id)?.name || '未整理';
  const tagsFor = (record) => record.contentTags || getContentTags(record.saved?.result);

  const records = useMemo(() => {
    const list = state.history.filter((record) => {
      const deleted = !!record.isDeleted;
      if (tab === 'trash' ? !deleted : deleted) return false;
      const tags = tagsFor(record);
      if (tab === 'task' && !tags.includes('待办')) return false;
      if (tab === 'info' && !tags.includes('资料')) return false;
      if (folderFilter && record.folderId !== folderFilter) return false;
      if (query && !`${record.title} ${record.saved?.result?.summary?.oneLiner?.text || ''}`.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
    return [...list].sort((a, b) => (sort === 'oldest' ? a.savedAt - b.savedAt : b.savedAt - a.savedAt));
  }, [state.history, tab, query, sort, folderFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSelect = (id) => {
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const clearSelection = () => {
    setSelected(new Set());
    setBatchMode(false);
  };
  const batchDelete = () => {
    actions.batchDeleteRecords([...selected]);
    clearSelection();
  };
  const batchMove = (folderId) => {
    if (!folderId) return;
    actions.batchMoveRecords([...selected], folderId);
    clearSelection();
  };
  const formatMeta = (record) => `${new Date(record.savedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${record.imageCount}张图`;

  return <>
    {open && <div className="records-drawer-backdrop" onClick={onClose} />}
    <aside className={`records-drawer ${open ? 'open' : ''}`} aria-hidden={!open} aria-label="所有记录">
      <div className="records-drawer-header"><div><h2>🕒 上传历史记录 <span className="badge badge-neutral">{records.length}</span></h2><p className="xsmall muted">全局历史记录</p></div><button type="button" className="icon-btn" aria-label="关闭上传历史记录" onClick={onClose}><Icons.x size={18} /></button></div>
      <div className="records-drawer-toolbar">
        <div className="record-search"><Icons.eye size={14} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索标题或内容" aria-label="搜索记录" /></div>
        <select className="select drawer-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="排序方式">
          <option value="newest">最新在前</option>
          <option value="oldest">最早在前</option>
        </select>
        <select className="select drawer-select" value={folderFilter} onChange={(e) => setFolderFilter(e.target.value)} aria-label="按文件夹筛选">
          <option value="">全部文件夹</option>
          {state.folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
        </select>
        <div className="record-tabs">{TABS.map(([key, label]) => <button type="button" className={tab === key ? 'active' : ''} key={key} onClick={() => setTab(key)}>{label}</button>)}</div>
      </div>
      {tab !== 'trash' && (
        <div className="batch-bar">
          <button type="button" className="text-action" onClick={() => setBatchMode(!batchMode)}>{batchMode ? '退出批量' : '☑ 批量操作'}</button>
          {batchMode && selected.size > 0 && (
            <>
              <span className="xsmall muted">已选 {selected.size} 条</span>
              <select className="select drawer-select" value="" onChange={(e) => batchMove(e.target.value)} aria-label="批量移动到文件夹">
                <option value="">移动到…</option>
                {state.folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
              </select>
              <button type="button" className="btn btn-ghost btn-sm danger-text" onClick={batchDelete}>批量删除</button>
            </>
          )}
        </div>
      )}
      <div className="records-drawer-list">{records.length === 0 ? <div className="empty-state"><Icons.file size={24} /><h3>{tab === 'trash' ? '回收站空空如也' : '暂无记录'}</h3><p className="small">{tab === 'trash' ? '被删除的记录会在这里保留，方便恢复。' : '完成一次分析并保存后，记录会出现在这里。'}</p></div> : records.map((record) => <div className="global-record" key={record.id}>{batchMode && <input type="checkbox" className="checkbox" checked={selected.has(record.id)} onChange={() => toggleSelect(record.id)} aria-label={`选择 ${record.title}`} />}<button type="button" className="global-record-main" onClick={() => { actions.loadHistory(record.id); onClose(); }}><strong className="ellipsis">{(record.title || '未命名分析').slice(0, 28)}</strong><span className="global-record-meta"><Icons.folder size={12} />{folderName(record.folderId)} · {formatMeta(record)}</span></button><div className="global-record-tags">{tagsFor(record).map((tag) => <span className={`mini-tag ${tag === '待办' ? 'tag-task' : 'tag-info'}`} key={tag}>{tag}</span>)}</div><div className="global-record-actions">{tab === 'trash' ? <><button type="button" className="icon-btn" title="恢复" onClick={() => actions.restoreRecord(record.id)}><Icons.retry size={14} /></button><button type="button" className="icon-btn danger" title="彻底删除" onClick={() => actions.hardDeleteRecord(record.id)}><Icons.trash size={14} /></button></> : <><div className="move-wrap"><button type="button" className="icon-btn" title="移动到文件夹" onClick={() => setMoving(moving === record.id ? null : record.id)}><Icons.folder size={14} /></button>{moving === record.id && <div className="move-menu">{state.folders.filter((folder) => folder.id !== record.folderId).map((folder) => <button type="button" key={folder.id} onClick={() => { actions.moveRecord(record.id, folder.id); setMoving(null); }}>{folder.name}</button>)}</div>}</div><button type="button" className="icon-btn danger" title="移入回收站" onClick={() => actions.deleteRecord(record.id)}><Icons.trash size={14} /></button></>}</div></div>)}</div>
      {tab === 'trash' && <div className="records-drawer-footer">💡 记录将在 30 天后自动彻底清除</div>}
    </aside>
  </>;
}
