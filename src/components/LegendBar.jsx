import { useStore } from '../state/store';
import { legendClass } from '../lib/utils';
import { Icons } from '../lib/icons';

/* 图例栏:制图世界签名动作 —— 所有图幅的色标图例,
   结果页顶部常驻,点击任一图例打开来源查看器 */
export function LegendBar() {
  const { state, actions } = useStore();
  const { images } = state;
  if (!images.length) return null;
  return (
    <div className="legend-bar" role="list" aria-label="图幅图例">
      <span className="legend-bar-title">图例</span>
      {images.map((img) => (
        <button
          type="button"
          role="listitem"
          key={img.id}
          className="legend-item"
          title={`打开图幅 ${img.legendIndex}:${img.name}`}
          onClick={() => actions.openSourceViewer({ imageId: img.id })}
        >
          <Icons.eye size={11} />
          <span className={`legend-dot ${legendClass(img.legendIndex)}`}>{img.legendIndex}</span>
          <span className="legend-name ellipsis">{img.name}</span>
          {img.quality.score < 70 && <span className="badge badge-warn">模糊</span>}
        </button>
      ))}
    </div>
  );
}
