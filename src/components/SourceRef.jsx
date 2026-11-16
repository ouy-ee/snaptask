import { useStore } from '../state/store';
import { legendClass } from '../lib/utils';

/* 来源标记:一行「来源图片 n」色标,点击打开对应图幅 */
export function SourceRef({ src = [], regionId, label = false, compact = false }) {
  const { state, actions } = useStore();
  const images = state.images;
  if (!src || src.length === 0) {
    return <span className="xsmall muted">无来源标注</span>;
  }
  return (
    <span className="src-list" role="group" aria-label="来源图片">
      {src.map((imageId) => {
        const img = images.find((i) => i.id === imageId);
        if (!img) return null;
        const idx = img.legendIndex;
        return (
          <button
            type="button"
            key={imageId}
            className="src-ref"
            title={`打开来源图幅 ${idx}:${img.name}`}
            onClick={(e) => {
              e.stopPropagation();
              actions.openSourceViewer({ imageId, regionId });
            }}
          >
            <span className={`legend-dot ${legendClass(idx)}`}>{idx}</span>
            {label && <span>{compact ? `图 ${idx}` : `来源图片 ${idx}`}</span>}
          </button>
        );
      })}
    </span>
  );
}

/* 单色标(用于单元格等紧凑位置) */
export function SrcDot({ imageId }) {
  const { state, actions } = useStore();
  const img = state.images.find((i) => i.id === imageId);
  if (!img) return null;
  const idx = img.legendIndex;
  return (
    <button
      type="button"
      className="src-dot"
      title={`打开来源图幅 ${idx}:${img.name}`}
      aria-label={`来源图片 ${idx}`}
      onClick={(e) => {
        e.stopPropagation();
        actions.openSourceViewer({ imageId });
      }}
    >
      <span className={`legend-dot ${legendClass(idx)}`}>{idx}</span>
    </button>
  );
}
