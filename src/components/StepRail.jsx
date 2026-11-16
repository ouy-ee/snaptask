import { useStore } from '../state/store';

const STEPS = [
  { key: 'home', label: '上传截图' },
  { key: 'workspace', label: '整理图幅' },
  { key: 'analyzing', label: '分析' },
  { key: 'results', label: '结果' },
];

const ORDER = { home: 0, workspace: 1, analyzing: 2, results: 3 };

/* 步骤刻度:比例尺式流程指示,已完成步骤可点击回退(未保存时由 store 统一确认) */
export function StepRail() {
  const { state, actions } = useStore();
  const cur = ORDER[state.stage] ?? 0;

  const goBack = (key) => {
    if (key === 'home') actions.backToHome();
    else if (key === 'workspace') actions.backToWorkspace();
  };

  return (
    <nav className="step-rail" aria-label="流程进度">
      {STEPS.map((s, i) => {
        const cls = i < cur ? 'done' : i === cur ? 'current' : '';
        const clickable = i < cur && state.stage !== 'analyzing';
        return (
          <button
            type="button"
            key={s.key}
            className={`step ${cls}`}
            disabled={!clickable}
            aria-current={i === cur ? 'step' : undefined}
            onClick={() => goBack(s.key)}
          >
            <span className="tick" aria-hidden="true" />
            {s.label}
          </button>
        );
      })}
    </nav>
  );
}
