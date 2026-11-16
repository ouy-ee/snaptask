import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import { Icons } from '../lib/icons';
import { getContentTags } from '../lib/exportResult';

export function AccountCenter() {
  const { state, actions } = useStore();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(state.user?.name || '');
  const [email, setEmail] = useState(state.user?.email || '');

  /* 云端模式:真实账号菜单(未登录时由路由守卫跳登录页,此处兜底隐藏) */
  if (state.mode === 'server') {
    if (!state.user) return null;
    return (
      <div className="account-menu">
        <button type="button" className="account-trigger" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="avatar"><Icons.user size={14} /></span>
          <span>{state.user.name}</span>
        </button>
        {open && (
          <div className="account-popover">
            <p className="small">
              <strong>{state.user.name}</strong>
              <br />
              <span className="muted">{state.user.email}</span>
            </p>
            <p className="xsmall muted">数据已同步到云端账号,多设备共享</p>
            <button className="btn btn-secondary btn-sm" onClick={() => { setOpen(false); navigate('/settings'); }}><Icons.user size={14} />账号设置</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setOpen(false); actions.signOut(); }}>退出登录</button>
          </div>
        )}
      </div>
    );
  }

  /* 本地 Demo 模式:原本地账号弹窗 */
  if (state.user) return <div className="account-menu"><button type="button" className="account-trigger" onClick={() => setOpen(!open)}><span className="avatar"><Icons.user size={14} /></span><span>{state.user.name}</span></button>{open && <div className="account-popover"><p className="small"><strong>{state.user.name}</strong><br /><span className="muted">{state.user.email}</span></p><button className="btn btn-secondary btn-sm" onClick={actions.chooseRepository}><Icons.folder size={14} />在线仓库：{state.repositoryName || '我的在线仓库'}</button><button className="btn btn-ghost btn-sm" onClick={actions.signOut}>退出本地账号</button></div>}</div>;
  return <><button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}><Icons.user size={14} />登录 / 注册</button>{open && <div className="modal-backdrop" onMouseDown={() => setOpen(false)}><div className="modal account-modal" onMouseDown={(e) => e.stopPropagation()}><div className="modal-header"><h2 className="card-title">进入你的 SnapTask</h2></div><div className="modal-body col"><p className="small muted">Demo 使用本地账号，不会联网。登录后历史记录会保存在此浏览器中。</p><label className="field-label">称呼<input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：林晓" autoFocus /></label><label className="field-label">邮箱<input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="用于标识本地账号" type="email" /></label></div><div className="modal-footer"><button className="btn btn-ghost" onClick={() => setOpen(false)}>稍后登录</button><button className="btn btn-primary" onClick={() => { actions.signIn({ name, email }); setOpen(false); }}>进入工作台</button></div></div></div>}</>;
}

export function HistoryPanel() {
  const { state, actions } = useStore();
  const [foldersOpen, setFoldersOpen] = useState(true);
  const [expandedFolders, setExpandedFolders] = useState(() => new Set([state.currentFolderId]));
  const [newFolder, setNewFolder] = useState('');
  const [showAll, setShowAll] = useState({});
  const [editingFolder, setEditingFolder] = useState(null);
  const [folderDraft, setFolderDraft] = useState('');
  const [dragId, setDragId] = useState(null); // 拖拽中的记录 id
  const [overFolder, setOverFolder] = useState(null); // 悬停的文件夹 id
  const folderName = (id) => state.folders.find((folder) => folder.id === id)?.name || '未整理';
  const recordsFor = (id) => state.history.filter((item) => !item.isDeleted && (item.folderId || 'folder-inbox') === id);
  const toggleFolder = (id) => { setExpandedFolders((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; }); actions.selectFolder(id); };
  const commitRename = (folder) => { if (!folderDraft.trim()) { actions.toast('warn', '文件夹名称不能为空'); return; } actions.renameFolder(folder.id, folderDraft); setEditingFolder(null); };
  const cancelRename = () => { setEditingFolder(null); setFolderDraft(''); };
  const dropRecord = (e, folderId) => {
    e.preventDefault();
    const id = dragId || e.dataTransfer?.getData('text/plain');
    if (id) actions.moveRecord(id, folderId);
    setDragId(null);
    setOverFolder(null);
  };
  const renderRecord = (item) => { const title = item.title || '未命名分析'; const tags = item.contentTags || getContentTags(item.saved?.result); return <div className={`folder-record ${dragId === item.id ? 'dragging' : ''}`} key={item.id} draggable onDragStart={(e) => { setDragId(item.id); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', item.id); } catch { /* jsdom 等环境无 DataTransfer 时忽略 */ } }} onDragEnd={() => { setDragId(null); setOverFolder(null); }}><button type="button" className="folder-record-open" onClick={() => actions.loadHistory(item.id)}><span className="folder-record-main"><strong className="ellipsis">{title.slice(0, 20)}{title.length > 20 ? '…' : ''}</strong><span className="mini-tags">{tags.map((tag) => <span className={`mini-tag ${tag === '待办' ? 'tag-task' : 'tag-info'}`} key={tag}>{tag === '待办' ? '待办' : '资料'}</span>)}</span></span><span className="folder-record-meta">{new Date(item.savedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} · {item.imageCount}张图</span></button><span className="row-actions"><button type="button" className="icon-btn danger" title="删除记录" aria-label={`删除记录:${title}`} onClick={() => actions.deleteRecord(item.id)}><Icons.trash size={13} /></button></span></div>; };
  return <aside className="resource-sidebar" aria-label="资源侧栏"><section className="card resource-section"><button type="button" className="resource-section-head" onClick={() => setFoldersOpen(!foldersOpen)}><span className="resource-section-title"><Icons.folder size={16} />我的文件夹</span><span className="resource-section-tools"><span className="badge badge-neutral">{state.folders.length}</span><Icons.arrowDown size={14} className={foldersOpen ? 'rotate-180' : ''} /></span></button>{foldersOpen && <div className="resource-section-body"><div className="folder-tree">{state.folders.map((folder) => { const records = recordsFor(folder.id); const expanded = expandedFolders.has(folder.id); const visible = showAll[folder.id] ? records : records.slice(0, 5); return <div className={`folder-node ${overFolder === folder.id ? 'drop-target' : ''}`} key={folder.id} onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverFolder(folder.id); } }} onDragLeave={() => setOverFolder((cur) => (cur === folder.id ? null : cur))} onDrop={(e) => dropRecord(e, folder.id)}><div className={`folder-row ${state.currentFolderId === folder.id ? 'active' : ''}`}><div className="folder-row-main"><button type="button" className="folder-row-toggle" onClick={() => toggleFolder(folder.id)} aria-expanded={expanded}><Icons.arrowRight size={13} className={expanded ? 'folder-chevron open' : 'folder-chevron'} /><Icons.folder size={15} />{editingFolder !== folder.id && <span className="ellipsis">{folder.name}</span>}</button>{editingFolder === folder.id && <span className="folder-edit-inline"><input className="folder-inline-input" value={folderDraft} autoFocus onChange={(e) => setFolderDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commitRename(folder); if (e.key === 'Escape') cancelRename(); }} /><span className="folder-edit-actions"><button type="button" className="icon-btn" title="确认重命名" onClick={() => commitRename(folder)}><Icons.check size={13} /></button><button type="button" className="icon-btn" title="取消重命名" onClick={() => cancelRename()}><Icons.x size={13} /></button></span></span>}<span className="folder-count">{records.length}</span></div><div className="row-actions folder-actions">{editingFolder !== folder.id && <button type="button" className="icon-btn" title="重命名文件夹" onClick={() => { setEditingFolder(folder.id); setFolderDraft(folder.name); }}><Icons.edit size={13} /></button>}<button type="button" className="icon-btn danger" title="删除文件夹" onClick={() => actions.deleteFolder(folder.id)}><Icons.trash size={13} /></button></div></div><div className={`folder-records ${expanded ? 'expanded' : ''}`}>{visible.map(renderRecord)}{records.length > 5 && <button type="button" className="show-all-records" onClick={() => setShowAll((current) => ({ ...current, [folder.id]: !current[folder.id] }))}>{showAll[folder.id] ? '收起记录' : '查看全部记录'} →</button>}{expanded && records.length === 0 && <p className="folder-empty">此文件夹暂时为空</p>}</div></div>; })}</div><div className="new-folder-row"><input className="input" value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="新建文件夹" onKeyDown={(e) => { if (e.key === 'Enter') { actions.createFolder(newFolder); setNewFolder(''); } }} /><button type="button" className="icon-btn" aria-label="创建文件夹" onClick={() => { actions.createFolder(newFolder); setNewFolder(''); }}><Icons.plus size={15} /></button></div><p className="xsmall muted">当前保存位置：{folderName(state.currentFolderId)}</p></div>}</section></aside>;
}
