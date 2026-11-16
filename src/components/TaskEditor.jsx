import { useState } from 'react';
import { Icons } from '../lib/icons';

/* 任务行内编辑器:编辑/新建共用 */
export function TaskEditor({ mode, task, onCancel, onSave }) {
  const [form, setForm] = useState({
    title: task?.title ?? '',
    description: task?.description ?? '',
    assignee: task?.assignee ?? '',
    dueDate: task?.dueDate?.conflict ? '' : (task?.dueDate ?? ''),
    priority: task?.priority ?? 'medium',
    status: task?.status ?? 'todo',
  });

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = () => {
    if (!form.title.trim()) return;
    onSave({
      title: form.title.trim(),
      description: form.description.trim(),
      assignee: form.assignee.trim() || null,
      dueDate: form.dueDate || null,
      priority: form.priority,
      status: form.status,
      done: form.status === 'done',
    });
  };

  if (mode === 'create') {
    return (
      <tr className="task-editor-row">
        <td colSpan={8}>
          <div className="task-editor">
            <div className="te-grid">
              <label className="field-label">任务标题 *
                <input className="input" value={form.title} autoFocus placeholder="输入任务标题" onChange={set('title')} onKeyDown={(e) => e.key === 'Enter' && submit()} />
              </label>
              <label className="field-label">任务描述
                <input className="input" value={form.description} placeholder="可选,补充说明" onChange={set('description')} onKeyDown={(e) => e.key === 'Enter' && submit()} />
              </label>
              <label className="field-label">负责人
                <input className="input" value={form.assignee} placeholder="未指派可留空" onChange={set('assignee')} />
              </label>
              <label className="field-label">截止时间
                <input className="input" type="date" value={form.dueDate} onChange={set('dueDate')} />
              </label>
              <label className="field-label">优先级
                <select className="select" value={form.priority} onChange={set('priority')}>
                  <option value="high">高</option>
                  <option value="medium">中</option>
                  <option value="low">低</option>
                </select>
              </label>
              <label className="field-label">状态
                <select className="select" value={form.status} onChange={set('status')}>
                  <option value="todo">待办</option>
                  <option value="doing">进行中</option>
                  <option value="done">已完成</option>
                </select>
              </label>
            </div>
            <div className="te-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={submit} disabled={!form.title.trim()}>
                <Icons.plus size={13} /> 添加任务
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>取消</button>
            </div>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="task-editor-row">
      <td colSpan={8}>
        <div className="task-editor">
          <div className="te-grid">
            <label className="field-label">任务标题 *
              <input className="input" value={form.title} autoFocus onChange={set('title')} onKeyDown={(e) => e.key === 'Enter' && submit()} />
            </label>
            <label className="field-label">任务描述
              <input className="input" value={form.description} onChange={set('description')} onKeyDown={(e) => e.key === 'Enter' && submit()} />
            </label>
            <label className="field-label">负责人
              <input className="input" value={form.assignee} onChange={set('assignee')} />
            </label>
            <label className="field-label">截止时间
              <input className="input" type="date" value={form.dueDate} onChange={set('dueDate')} />
            </label>
            <label className="field-label">优先级
              <select className="select" value={form.priority} onChange={set('priority')}>
                <option value="high">高</option>
                <option value="medium">中</option>
                <option value="low">低</option>
              </select>
            </label>
            <label className="field-label">状态
              <select className="select" value={form.status} onChange={set('status')}>
                <option value="todo">待办</option>
                <option value="doing">进行中</option>
                <option value="done">已完成</option>
              </select>
            </label>
          </div>
          {task?.dueDate?.conflict && (
            <div className="te-conflict-note">
              <Icons.warning size={13} />
              该任务的截止时间存在冲突。选择新日期保存后,将以你填写的日期为准。
            </div>
          )}
          <div className="te-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={submit} disabled={!form.title.trim()}>
              保存修改
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>取消</button>
          </div>
        </div>
      </td>
    </tr>
  );
}
