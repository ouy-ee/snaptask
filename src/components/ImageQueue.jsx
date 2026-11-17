import { useStore } from '../state/store';
import { Icons } from '../lib/icons';
import { legendClass } from '../lib/utils';
import { resolveApiUrl } from '../api/config';

/* 图幅队列(工作区左栏):缩略图 + 图例色标 + 顺序调整 + 删除 */
export function ImageQueue() {
  const { state, actions } = useStore();
  const { images, currentImageId } = state;

  if (!images.length) {
    return (
      <div className="queue-empty">
        <Icons.image size={20} />
        <p className="small muted">还没有截图<br />点击上方「添加截图」</p>
      </div>
    );
  }

  return (
    <>
    <ol className="image-queue" aria-label="截图队列">
      {images.map((img, i) => {
        const active = img.id === currentImageId;
        return (
          <li key={img.id} className={`queue-item ${active ? 'active' : ''}`}>
            <button
              type="button"
              className="queue-thumb"
              aria-current={active}
              aria-label={`预览第 ${img.legendIndex} 张:${img.name}`}
              onClick={() => actions.setCurrent(img.id)}
            >
              <img src={resolveApiUrl(img.url)} alt="" loading="lazy" />
              <span className={`legend-dot legend-dot-lg ${legendClass(img.legendIndex)}`}>{img.legendIndex}</span>
              {img.quality.score < 70 && (
                <span className="queue-flag" title="图幅质量较低">
                  <Icons.warning size={11} />
                </span>
              )}
            </button>
            <div className="queue-meta">
              <div className="queue-name ellipsis" title={img.name}>{img.name}</div>
              <div className="queue-sub xsmall muted tabular">{img.width}×{img.height} · {img.sizeKb}KB</div>
            </div>
            <div className="queue-actions">
              <button
                type="button"
                className="icon-btn"
                aria-label="上移"
                disabled={i === 0}
                onClick={() => actions.moveImage(img.id, -1)}
              >
                <Icons.arrowUp size={14} />
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label="下移"
                disabled={i === images.length - 1}
                onClick={() => actions.moveImage(img.id, 1)}
              >
                <Icons.arrowDown size={14} />
              </button>
              <button
                type="button"
                className="icon-btn danger"
                aria-label="删除"
                onClick={() =>
                  actions.confirmThen(
                    {
                      title: '删除这张截图?',
                      body: `将移除「${img.name}」,结果中引用它的来源标记会一并清除。`,
                      confirmLabel: '删除',
                      danger: true,
                    },
                    () => actions.removeImage(img.id)
                  )
                }
              >
                <Icons.trash size={14} />
              </button>
            </div>
          </li>
        );
      })}
    </ol>
    </>
  );
}
