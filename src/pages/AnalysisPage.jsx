import { AnalysisProgress } from '../components/AnalysisProgress';
import { LegendBar } from '../components/LegendBar';

/* 模拟分析页:分析进度(完成后由 store 自动切到结果页) */
export function AnalysisPage() {
  return (
    <div className="analysis-layout">
      <LegendBar />
      <AnalysisProgress />
    </div>
  );
}
