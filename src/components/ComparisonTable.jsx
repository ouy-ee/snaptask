import { useState } from 'react';
import { useStore } from '../state/store';
import { Icons } from '../lib/icons';
import { SrcDot } from './SourceRef';

/* 对比表格:单元格编辑、增删行列、缺失显示「未提及」、来源色标、横向滚动 */
export function ComparisonTable({ comparison }) {
  const { state, actions } = useStore();
  const [editing, setEditing] = useState(null); // { rowId, dimId }
  const [draft, setDraft] = useState('');
  const [newRowLabel, setNewRowLabel] = useState('');
  const [addingRow, setAddingRow] = useState(false);
  const [newColLabel, setNewColLabel] = useState('');
  const [addingCol, setAddingCol] = useState(false);

  if (!comparison) return null;
  const { dims, rows } = comparison;
  const flashId = state.flash?.id;

  const startEdit = (rowId, dimId, value) => {
    setEditing({ rowId, dimId });
    setDraft(value ?? '');
  };

  const commitEdit = () => {
    if (!editing) return;
    const cell = rows.find((r) => r.id === editing.rowId)?.cells[editing.dimId];
    const nextValue = draft.trim() === '' ? null : draft.trim();
    actions.updateCell(editing.rowId, editing.dimId, {
      value: nextValue,
      missing: nextValue == null,
      conflict: false,
      src: cell?.src ?? [],
    });
    setEditing(null);
  };

  return (
    <section className="card result-card" aria-labelledby="cmp-title">
      <div className="card-header">
        <h2 className="card-title" id="cmp-title">
          <Icons.compare size={16} />
          {comparison.title}
          <span className="sub">单元格可直接编辑,缺失信息显示「未提及」</span>
        </h2>
        <div className="row">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAddingRow(true)}>
            <Icons.plus size={13} /> 新增行
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAddingCol(true)}>
            <Icons.plus size={13} /> 新增列
          </button>
        </div>
      </div>

      <div className="cmp-scroll" role="region" aria-label="对比表格,可横向滚动" tabIndex={0}>
        <table className="cmp-table">
          <thead>
            <tr>
              <th scope="col" className="cmp-object-col">对象</th>
              {dims.map((d) => (
                <th scope="col" key={d.id}>
                  <span className="cmp-dim-label">
                    {d.label}
                    <button
                      type="button"
                      className="cmp-col-del"
                      aria-label={`删除列:${d.label}`}
                      title="删除此列"
                      onClick={() =>
                        actions.confirmThen(
                          { title: '删除这一列?', body: `「${d.label}」列将从对比表中移除。`, confirmLabel: '删除', danger: true },
                          () => actions.deleteColumn(d.id)
                        )
                      }
                    >
                      <Icons.x size={11} />
                    </button>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} id={`item-${row.id}`} className={flashId === row.id ? 'flash' : ''}>
                <th scope="row" className="cmp-object-col">
                  <span className="ellipsis">{row.label}</span>
                  <button
                    type="button"
                    className="cmp-row-del"
                    aria-label={`删除行:${row.label}`}
                    title="删除此行"
                    onClick={() =>
                      actions.confirmThen(
                        { title: '删除这一行?', body: `「${row.label}」将从对比表中移除。`, confirmLabel: '删除', danger: true },
                        () => actions.deleteRow(row.id)
                      )
                    }
                  >
                    <Icons.trash size={12} />
                  </button>
                </th>
                {dims.map((d) => {
                  const cell = row.cells[d.id] || { value: null, missing: true, src: [] };
                  const isEditing = editing?.rowId === row.id && editing?.dimId === d.id;
                  return (
                    <td
                      key={d.id}
                      className={`cmp-cell ${cell.missing && cell.value == null ? 'missing' : ''} ${cell.conflict ? 'conflict' : ''}`}
                      onClick={() => !isEditing && startEdit(row.id, d.id, cell.value ?? '')}
                      onKeyDown={(e) => {
                        if (!isEditing && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          startEdit(row.id, d.id, cell.value ?? '');
                        }
                      }}
                      tabIndex={0}
                      role="button"
                      aria-label={`编辑单元格:${row.label} · ${d.label}`}
                    >
                      {isEditing ? (
                        <input
                          className="input cell-input"
                          value={draft}
                          autoFocus
                          placeholder="留空表示未提及"
                          aria-label={`编辑单元格:${row.label} · ${d.label}`}
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={commitEdit}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEdit();
                            if (e.key === 'Escape') setEditing(null);
                          }}
                        />
                      ) : (
                        <>
                          <span className="cell-value">
                            {cell.conflict ? (
                              <span className="conflict-pair">
                                {cell.values.map((v) => (
                                  <span key={v.value} className="conflict-value">{v.value}</span>
                                ))}
                                <span className="conflict-sep">冲突</span>
                              </span>
                            ) : cell.value == null ? (
                              <span className="cell-missing">未提及</span>
                            ) : (
                              cell.value
                            )}
                          </span>
                          <span className="cell-srcs">
                            {(cell.src || []).map((s) => <SrcDot key={s} imageId={s} />)}
                          </span>
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}

            {addingRow && (
              <tr className="cmp-add-row">
                <th scope="row">
                  <input
                    className="input"
                    value={newRowLabel}
                    autoFocus
                    placeholder="对象名称"
                    aria-label="新对象名称"
                    onChange={(e) => setNewRowLabel(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && newRowLabel.trim() && commitRow()}
                  />
                </th>
                <td colSpan={dims.length}>
                  <div className="row">
                    <button type="button" className="btn btn-primary btn-sm" disabled={!newRowLabel.trim()} onClick={commitRow}>
                      添加
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setAddingRow(false); setNewRowLabel(''); }}>
                      取消
                    </button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {addingCol && (
          <div className="cmp-add-col card" style={{ marginTop: 'var(--s-2)' }}>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <input
                className="input"
                style={{ maxWidth: 260 }}
                value={newColLabel}
                autoFocus
                placeholder="维度名称,如「售后支持」"
                aria-label="新维度名称"
                onChange={(e) => setNewColLabel(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && newColLabel.trim() && commitCol()}
              />
              <button type="button" className="btn btn-primary btn-sm" disabled={!newColLabel.trim()} onClick={commitCol}>
                添加列
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setAddingCol(false); setNewColLabel(''); }}>
                取消
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );

  function commitRow() {
    actions.addRow(newRowLabel.trim());
    setNewRowLabel('');
    setAddingRow(false);
  }
  function commitCol() {
    actions.addColumn(newColLabel.trim());
    setNewColLabel('');
    setAddingCol(false);
  }
}
