import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { Icons } from '../lib/icons';

/* 提取详情：默认是纯文本，点击值即可全量行内编辑。 */
export function FactsPanel({ facts = [], keyFacts = [] }) {
  const displayFacts = facts.length ? facts : keyFacts.map((fact, index) => ({ ...fact, label: fact.label || `提取要点 ${index + 1}`, value: fact.text, status: fact.status || 'identified' }));
  return <section className="card result-card details-facts" aria-labelledby="facts-title"><div className="card-header"><h2 className="card-title" id="facts-title"><Icons.grid size={16} />提取详情</h2><span className="sub">点击内容即可修改</span></div><div className={`facts-simple ${displayFacts.length <= 2 ? 'facts-compact' : ''}`}>{displayFacts.length ? displayFacts.map((fact) => <FactRow key={fact.id} fact={fact} />) : <p className="small muted">未提取到结构化信息。</p>}</div></section>;
}

function FactRow({ fact }) {
  const { actions } = useStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(fact.value ?? fact.text ?? '');
  const inputRef = useRef(null);
  const skipBlurRef = useRef(false);
  const uncertain = fact.status === 'uncertain' || fact.status === 'not-mentioned' || (fact.confidence != null && fact.confidence < 0.75);
  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [editing]);
  const save = () => { actions.updateFact(fact.id, { value: draft.trim() || null, text: draft.trim() || fact.text }); setEditing(false); };
  const cancel = () => { skipBlurRef.current = true; setDraft(fact.value ?? fact.text ?? ''); setEditing(false); };
  const value = fact.status === 'not-mentioned' ? '未提及' : fact.value ?? fact.text ?? '未填写';
  return <div className="fact-simple-row"><span className="fact-simple-label">{fact.label}</span>{editing ? <textarea ref={inputRef} className="fact-inline-editor" value={draft} rows={Math.max(1, Math.min(4, Math.ceil(draft.length / 42)))} onChange={(e) => setDraft(e.target.value)} onBlur={() => { if (skipBlurRef.current) { skipBlurRef.current = false; return; } save(); }} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); } }} /> : <button type="button" className="fact-simple-value" onClick={() => { setDraft(fact.value ?? fact.text ?? ''); setEditing(true); }} title="点击编辑"><span>{value}</span>{uncertain && <span className="fact-warning" title="AI 置信度较低，请核对" aria-label="AI 置信度较低，请核对">⚠</span>}</button>}</div>;
}
