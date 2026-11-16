import { useState } from 'react';
import { useStore } from '../state/store';
import { Icons } from '../lib/icons';
import { formatDate } from '../lib/utils';
import { SourceRef } from './SourceRef';
import { TaskEditor } from './TaskEditor';

const PRIORITY_LABEL = { high: '高', medium: '中', low: '低' };
const PRIORITY_BADGE = { high: 'badge-danger', medium: 'badge-warn', low: 'badge-info' };
const STATUS_LABEL = { todo: '待办', doing: '进行中', done: '已完成' };
const STATUS_BADGE = { todo: 'badge-neutral', doing: 'badge-info', done: 'badge-green' };

/* 任务清单:勾选、编辑、新增、删除、冲突与缺失提示 */
export function TaskList({ tasks, suggestions = [], onSync }) {
  const { state, actions } = useStore();
  const [editingId, setEditingId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [doneSuggestions, setDoneSuggestions] = useState([]);
  const [synced, setSynced] = useState(false);

  const flashId = state.flash?.id;

  return (
    <section className="card result-card" aria-labelledby="tasks-title">
      <div className="card-header">
        <h2 className="card-title" id="tasks-title">
          <Icons.check size={16} />
          任务清单
          <span className="sub">{tasks.filter((t) => !t.done).length} 项待办</span>
        </h2>
        <div className="row"><button type="button" className={`btn ${synced ? 'btn-ghost' : 'btn-secondary'} btn-sm`} onClick={() => { onSync?.(); setSynced(true); }}><Icons.pin size={13} />{synced ? '已同步' : '同步至首页待办'}</button><button type="button" className="btn btn-secondary btn-sm" onClick={() => setCreating(true)}>
          <Icons.plus size={14} />
          新增任务
        </button></div>
      </div>

      <div className="task-table-wrap">
        <table className="task-table">
          <thead>
            <tr>
              <th scope="col" className="col-check" aria-label="完成状态" />
              <th scope="col">任务</th>
              <th scope="col">负责人</th>
              <th scope="col">截止时间</th>
              <th scope="col">优先级</th>
              <th scope="col">状态</th>
              <th scope="col">来源</th>
              <th scope="col" aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {creating && (
              <TaskEditor
                mode="create"
                onCancel={() => setCreating(false)}
                onSave={(task) => {
                  actions.addTask(task);
                  setCreating(false);
                }}
              />
            )}
            {tasks.map((t) => {
              const isFlash = flashId === t.id;
              if (editingId === t.id) {
                return (
                  <TaskEditor
                    key={t.id}
                    mode="edit"
                    task={t}
                    onCancel={() => setEditingId(null)}
                    onSave={(patch) => {
                      actions.updateTask(t.id, patch);
                      setEditingId(null);
                    }}
                  />
                );
              }
              return (
                <tr key={t.id} id={`item-${t.id}`} className={`${t.done ? 'task-done' : ''} ${isFlash ? 'flash' : ''}`}>
                  <td className="col-check">
                    <input
                      type="checkbox"
                      className="checkbox"
                      checked={t.done}
                      aria-label={`标记「${t.title}」为${t.done ? '未完成' : '已完成'}`}
                      onChange={() => actions.toggleTask(t.id)}
                    />
                  </td>
                  <td className="col-task">
                    <div className={`task-title ${t.done ? 'done' : ''}`}>{t.title}</div>
                    {t.description && <div className="task-desc xsmall muted">{t.description}</div>}
                  </td>
                  <td className="col-assignee">
                    {t.assignee ? (
                      t.assignee
                    ) : (
                      <span className="missing-chip" title="未在图幅中识别到负责人">
                        <Icons.user size={12} />
                        缺负责人
                      </span>
                    )}
                  </td>
                  <td className="col-due tabular">
                    {t.dueDate == null ? (
                      <span className="missing-chip" title="未在图幅中识别到截止时间">
                        <Icons.clock size={12} />
                        缺截止时间
                      </span>
                    ) : t.dueDate.conflict ? (
                      <span className="conflict-pair">
                        {t.dueDate.values.map((v) => (
                          <span key={v.value} className="conflict-value">
                            {formatDate(v.value)}
                            <SourceRef src={v.src} compact />
                          </span>
                        ))}
                        <span className="conflict-sep">冲突</span>
                      </span>
                    ) : (
                      formatDate(t.dueDate)
                    )}
                  </td>
                  <td><span className={`badge ${PRIORITY_BADGE[t.priority]}`}>{PRIORITY_LABEL[t.priority]}</span></td>
                  <td><span className={`badge ${STATUS_BADGE[t.status]}`}>{STATUS_LABEL[t.status]}</span></td>
                  <td><SourceRef src={t.src} compact /></td>
                  <td>
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      <button type="button" className="icon-btn" aria-label={`编辑任务:${t.title}`} onClick={() => setEditingId(t.id)}>
                        <Icons.edit size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn danger"
                        aria-label={`删除任务:${t.title}`}
                        onClick={() =>
                          actions.confirmThen(
                            { title: '删除这条任务?', body: `「${t.title}」将从任务清单中移除。`, confirmLabel: '删除', danger: true },
                            () => actions.deleteTask(t.id)
                          )
                        }
                      >
                        <Icons.trash size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {suggestions.length > 0 && <div className="ai-tasks"><div className="ai-tasks-title"><Icons.spark size={14} />AI 建议下一步</div>{suggestions.map((item) => <label className={`ai-task ${doneSuggestions.includes(item.id) ? 'done' : ''}`} key={item.id}><input className="checkbox" type="checkbox" checked={doneSuggestions.includes(item.id)} onChange={() => setDoneSuggestions((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} /><span>{item.text}</span><span className="badge badge-info">AI</span></label>)}</div>}
      </div>
    </section>
  );
}
