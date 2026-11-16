import { Icons } from '../lib/icons';

/* 结果页首屏只保留一句可执行摘要，避免把任务与事实重复展示。 */
export function SummaryPanel({ summary, warnings = [] }) {
  if (!summary) return null;
  return (
    <section className="summary-bar" aria-labelledby="summary-title">
      <div className="summary-bar-head">
        <h2 className="card-title" id="summary-title">
          <Icons.spark size={16} />
          AI 总结
          <span className="sub">AI 一句话总结</span>
        </h2>
      </div>
      <div className="summary-bar-body">
        <p className="summary-oneliner">{summary.oneLiner.text}</p>
        {warnings.some((warning) => warning.severity === 'high' || warning.type === 'conflict') && <div className="summary-warning"><Icons.warning size={14} />发现高风险信息冲突，请核对下方提取详情与来源图幅</div>}
      </div>
    </section>
  );
}
