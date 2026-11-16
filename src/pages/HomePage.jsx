import { useStore } from '../state/store';
import { UploadDropzone } from '../components/UploadDropzone';
import { Icons } from '../lib/icons';
import { HistoryPanel } from '../components/AccountCenter';
import { apiFetchBlob, friendlyMessage } from '../api/service';
import { useRef, useState } from 'react';

function UrgentTodoPanel({ state, actions, onOpenDrawer }) {
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const tasks = state.urgentTasks;
  const visible = tasks.filter((task) => !task.done).slice(0, 3);
  const add = () => { if (draft.trim()) { actions.addUrgentTask(draft); setDraft(''); setAdding(false); } };
  const saveName = (id) => { if (editDraft.trim()) actions.updateUrgentTask(id, { title: editDraft.trim() }); setEditing(null); };
  const daysLeft = (task) => task.dueDate ? `${task.dueDate} 截止` : '暂无截止时间';
  const dot = (task) => task.priority === 'high' ? 'todo-dot high' : task.priority === 'low' ? 'todo-dot low' : 'todo-dot medium';
  const filtered = tasks.filter((task) => (filter === 'all' || (filter === 'done' ? task.done : !task.done)) && (!query || task.title.toLowerCase().includes(query.toLowerCase())));
  return <section className="card home-todo-card"><button type="button" className="card-header home-todo-head" onClick={() => setOpen(!open)}><h2 className="card-title"><Icons.clock size={16} />紧急待办 <span className="sub">({tasks.filter((task) => !task.done).length})</span></h2><Icons.arrowDown size={15} className={open ? 'rotate-180' : ''} /></button>{open && <><div className="todo-list">{visible.length ? visible.map((task) => <div className={`todo-row ${task.done ? 'completed' : ''}`} key={task.id}><input type="checkbox" className="checkbox" checked={!!task.done} onChange={() => { actions.updateUrgentTask(task.id, { done: true, status: 'done' }); setTimeout(() => actions.dismissUrgentTask(task.id), 1800); }} aria-label={`完成${task.title}`} /><span className={dot(task)} /><span className="todo-copy">{editing === task.id ? <input className="input todo-edit-input" value={editDraft} autoFocus onChange={(e) => setEditDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveName(task.id); if (e.key === 'Escape') setEditing(null); }} onBlur={() => saveName(task.id)} /> : <strong className="ellipsis">{task.title}</strong>}<span className="xsmall muted">{task.assignee || '未分配'} · {daysLeft(task)}</span></span><span className="todo-actions"><button type="button" className="icon-btn" title="编辑" onClick={() => { setEditing(task.id); setEditDraft(task.title); }}><Icons.edit size={13} /></button><button type="button" className="icon-btn danger" title="删除" onClick={() => actions.removeUrgentTask(task.id)}><Icons.trash size={13} /></button></span></div>) : <p className="empty-inline">暂无紧急待办</p>}</div><div className="todo-footer">{adding ? <div className="todo-add-row"><input className="input" value={draft} autoFocus onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); if (e.key === 'Escape') { setAdding(false); setDraft(''); } }} placeholder="输入待办后按回车" /><button className="icon-btn" onClick={add}><Icons.check size={14} /></button></div> : <button type="button" className="text-action" onClick={() => setAdding(true)}>+ 快速添加待办</button>}<button type="button" className="text-action" onClick={onOpenDrawer}><Icons.eye size={13} />搜索 / 查看全部 {tasks.length} 项待办 →</button></div></>}</section>;
}

function TodoDrawer({ state, actions, open, onClose }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const tasks = state.urgentTasks.filter((task) => (filter === 'all' || (filter === 'done' ? task.done : !task.done)) && (!query || task.title.toLowerCase().includes(query.toLowerCase())));
  return open ? <><div className="records-drawer-backdrop" onClick={onClose} /><aside className="records-drawer open todo-drawer"><div className="records-drawer-header"><div><h2>⏰ 全部待办 <span className="badge badge-neutral">{tasks.length}</span></h2><p className="xsmall muted">首页任务总览</p></div><button className="icon-btn" onClick={onClose}><Icons.x size={17} /></button></div><div className="records-drawer-toolbar"><div className="record-search"><Icons.eye size={14} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索待办" /></div><div className="record-tabs"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>全部</button><button className={filter === 'todo' ? 'active' : ''} onClick={() => setFilter('todo')}>未完成</button><button className={filter === 'done' ? 'active' : ''} onClick={() => setFilter('done')}>已完成</button></div></div><div className="records-drawer-list">{tasks.map((task) => <div className="global-record" key={task.id}><div className="global-record-main"><strong className={task.done ? 'done-text' : ''}>{task.title}</strong><span className="global-record-meta">{task.assignee || '未分配'} · {task.dueDate || '暂无截止时间'}</span></div><div className="global-record-actions"><button className="icon-btn" onClick={() => actions.updateUrgentTask(task.id, { done: !task.done, status: task.done ? 'todo' : 'done' })}><Icons.check size={14} /></button><button className="icon-btn danger" onClick={() => actions.removeUrgentTask(task.id)}><Icons.trash size={14} /></button></div></div>)}</div></aside></> : null;
}

function TodoDrawerV2({ state, actions, open, onClose }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const tasks = state.urgentTasks.filter((task) => (filter === 'all' || (filter === 'done' ? task.done : !task.done)) && (!query || task.title.toLowerCase().includes(query.toLowerCase())));
  const save = (id) => { if (draft.trim()) actions.updateUrgentTask(id, { title: draft.trim() }); setEditing(null); };
  const dot = (task) => task.priority === 'high' ? 'todo-dot high' : task.priority === 'low' ? 'todo-dot low' : 'todo-dot medium';
  return open ? <><div className="records-drawer-backdrop" onClick={onClose} /><aside className="records-drawer open todo-drawer"><div className="records-drawer-header"><div><h2>⏰ 全部待办 <span className="badge badge-neutral">{tasks.length}</span></h2><p className="xsmall muted">首页任务总览</p></div><button className="icon-btn" onClick={onClose}><Icons.x size={17} /></button></div><div className="records-drawer-toolbar"><div className="record-search"><Icons.eye size={14} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索待办" /></div><div className="record-tabs"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>全部</button><button className={filter === 'todo' ? 'active' : ''} onClick={() => setFilter('todo')}>未完成</button><button className={filter === 'done' ? 'active' : ''} onClick={() => setFilter('done')}>已完成</button></div></div><div className="records-drawer-list">{tasks.map((task) => <div className={`global-record todo-drawer-row ${task.done ? 'completed' : ''}`} key={task.id}><input type="checkbox" className="checkbox" checked={!!task.done} onChange={() => actions.updateUrgentTask(task.id, { done: !task.done, status: task.done ? 'todo' : 'done' })} /><span className={dot(task)} /><div className="global-record-main">{editing === task.id ? <input className="input todo-edit-input" value={draft} autoFocus onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(task.id); if (e.key === 'Escape') setEditing(null); }} onBlur={() => save(task.id)} /> : <strong className={task.done ? 'done-text' : ''}>{task.title}</strong>}<span className="global-record-meta">{task.assignee || '未分配'} · {task.dueDate || '暂无截止时间'}</span></div><div className="global-record-actions"><button className="icon-btn" title="编辑" onClick={() => { setEditing(task.id); setDraft(task.title); }}><Icons.edit size={14} /></button><button className="icon-btn danger" title="删除" onClick={() => actions.removeUrgentTask(task.id)}><Icons.trash size={14} /></button></div></div>)}</div></aside></> : null;
}

function ArchivePanel({ state, actions }) {
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const [preview, setPreview] = useState(null); // { title, meta, content? | imageUrl? }
  const objectUrlRef = useRef(null); // 临时图片 URL,关闭预览时 revoke 释放内存

  const save = (id) => { if (draft.trim()) actions.renameArchive(id, draft); setEditing(null); };

  const closePreview = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setPreview(null);
  };

  /* 带 Token 预览/下载:window.open/<img src> 无法携带 Bearer 头,
     私有文件一律 fetch → Blob:
     - 图片 → objectURL 弹窗预览(关闭时 revoke)
     - 文本 → 读取为字符串在卡片中展示
     - 其他类型 → 触发浏览器下载
     外链归档 → 新标签打开 */
  const openArchive = async (file) => {
    if (!file.downloadUrl) {
      setPreview({ title: file.title, meta: file.format, content: file.content || '', createdAt: file.createdAt });
      return;
    }
    if (/^https?:\/\//i.test(file.downloadUrl)) {
      window.open(file.downloadUrl, '_blank', 'noopener');
      return;
    }
    try {
      const blob = await apiFetchBlob(file.downloadUrl);
      const mime = blob.type || '';
      if (mime.startsWith('image/')) {
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        setPreview({ title: file.title, meta: file.format, imageUrl: url, createdAt: file.createdAt });
      } else if (mime.startsWith('text/') || mime === 'application/json') {
        const text = await blob.text();
        setPreview({ title: file.title, meta: file.format, content: text, createdAt: file.createdAt });
      } else {
        // 其他类型:objectURL + <a download> 触发下载,随后释放
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.title || 'download';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (err) {
      actions.toast('error', friendlyMessage(err));
    }
  };

  return <><section className="card home-control-card"><div className="card-header"><h2 className="card-title"><Icons.download size={16} />归档文件</h2><span className="badge badge-neutral">{state.archives.length}</span></div><div className="home-control-list">{state.archives.length ? state.archives.slice(0, 5).map((file) => <div className="home-control-row archive-row" key={file.id}><span className="grow">{editing === file.id ? <input className="input archive-edit-input" value={draft} autoFocus onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(file.id); if (e.key === 'Escape') setEditing(null); }} onBlur={() => save(file.id)} /> : <><strong className="ellipsis">{file.title}</strong><span className="xsmall muted">{file.format} · {new Date(file.createdAt).toLocaleString('zh-CN')}</span></>}</span><span className="archive-actions"><button type="button" className="icon-btn" title="预览 / 下载" onClick={() => openArchive(file)}><Icons.eye size={13} /></button><button type="button" className="icon-btn" title="重命名" onClick={() => { setEditing(file.id); setDraft(file.title); }}><Icons.edit size={13} /></button><button type="button" className="icon-btn danger" title="删除" onClick={() => actions.deleteArchive(file.id)}><Icons.trash size={13} /></button></span></div>) : <p className="empty-inline">还没有归档文件</p>}</div></section>{preview && <div className="modal-backdrop" onMouseDown={closePreview}><div className="modal archive-preview-modal" onMouseDown={(e) => e.stopPropagation()}><div className="modal-header row"><h2 className="card-title">{preview.title}</h2><button className="icon-btn" onClick={closePreview} aria-label="关闭预览"><Icons.x size={16} /></button></div><div className="modal-body">{preview.imageUrl ? <img className="archive-preview-image" src={preview.imageUrl} alt={preview.title} /> : <><p className="xsmall muted">{preview.meta} · {preview.createdAt ? new Date(preview.createdAt).toLocaleString('zh-CN') : ''}</p><pre className="archive-preview-content">{preview.content || '(无内容)'}</pre></>}</div></div></div>}</>;
}

/* 上传首页:上传面板(左)+ 流程说明与示例入口(右)。
   不做营销式 Hero,第一屏就是任务本身。 */
export function HomePage() {
  const { state, actions } = useStore();
  const [todoDrawerOpen, setTodoDrawerOpen] = useState(false);
  const candidates = state.history.filter((record) => !record.isDeleted).flatMap((record) => (record.saved?.result?.tasks || []).filter((task) => !task.done));
  const urgent = [...state.urgentTasks, ...candidates.filter((task) => !state.urgentTasks.some((item) => item.id === task.id))].slice(0, 3);

  return (
    <div className="home-layout">
      <div className="home-main">
        <div className="home-intro">
          <h1>SnapTask</h1>
          <p className="home-subtitle">
            把单张或多张截图转换为结构化信息、任务清单、对比表格与 AI 总结。
            <br />
            每条结果都标注它来自哪张截图 —— 冲突与不确定,不会伪装成事实。
          </p>
        </div>

        <UploadDropzone />

        <div className="home-privacy card">
          <div className="row">
            <Icons.lock size={15} />
            <strong>隐私与数据处理</strong>
          </div>
          <ul className="privacy-list">
            {state.mode === 'server' ? (
              <>
                <li>截图经 HTTPS 加密上传到你的私有账号存储,仅用于本次分析。</li>
                <li>分析由云端 AI 服务完成;请在信任的 AI 供应商下使用,勿上传高度敏感信息。</li>
                <li>所有数据仅你本人可见,可随时在记录中删除,或注销账号彻底清除。</li>
              </>
            ) : (
              <>
                <li>截图仅在本页面内读取与处理,不会上传到任何服务器(Demo 模式)。</li>
                <li>分析由本地 mock 服务模拟,不调用真实 AI 接口;接入真实服务前,请勿上传敏感信息。</li>
                <li>分析结果保存在你的浏览器本地,可随时清除。</li>
              </>
            )}
          </ul>
        </div>
      </div>

      <div className="home-side">
        <HistoryPanel />
        <UrgentTodoPanel state={state} actions={actions} onOpenDrawer={() => setTodoDrawerOpen(true)} />
        <ArchivePanel state={state} actions={actions} />
      </div>
      <TodoDrawerV2 state={state} actions={actions} open={todoDrawerOpen} onClose={() => setTodoDrawerOpen(false)} />
    </div>
  );
}
