import { useEffect } from 'react';
import { useStore } from '../state/store';
import { Icons } from '../lib/icons';
import { legendClass, formatBytes } from '../lib/utils';

/* 来源图幅查看抽屉:点击任何来源标记后从右侧滑出,
   展示该图大图,并高亮被引用的标注区域(如有) */
export function SourceViewer() {
  const { state, actions } = useStore();
  const viewer = state.sourceViewer;
  const image = viewer ? state.images.find((i) => i.id === viewer.imageId) : null;

  useEffect(() => {
    if (!viewer) return;
    const onKey = (e) => {
      if (e.key === 'Escape') actions.closeSourceViewer();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewer, actions]);

  if (!viewer || !image) return null;

  const activeRegion = image.regions?.find((r) => r.id === viewer.regionId);

  return (
    <>
      <div className="drawer-backdrop" onClick={actions.closeSourceViewer} />
      <div className="drawer" role="dialog" aria-modal="true" aria-label={`来源图幅 ${image.name}`}>
        <div className="drawer-header">
          <h3 className="card-title">
            <span className={`legend-dot ${legendClass(image.legendIndex)}`}>{image.legendIndex}</span>
            <span className="ellipsis">来源图幅 · {image.name}</span>
          </h3>
          <button type="button" className="icon-btn" aria-label="关闭" onClick={actions.closeSourceViewer}>
            <Icons.x size={16} />
          </button>
        </div>
        <div className="drawer-body">
          <div className="srcview-meta">
            <span>{image.width} × {image.height} px</span>
            <span>{formatBytes(image.sizeKb * 1024)}</span>
            <span className={`badge ${image.quality.score >= 85 ? 'badge-green' : image.quality.score >= 70 ? 'badge-warn' : 'badge-danger'}`}>
              质量 {image.quality.score}
            </span>
          </div>
          {image.url ? (
            <div className="srcview-stage">
              <img src={image.url} alt={`截图:${image.name}`} />
              {image.regions?.map((r) => {
                const active = r.id === viewer.regionId;
                return (
                  <div
                    key={r.id}
                    className={`srcview-region legend-border-${((image.legendIndex - 1) % 6) + 1} ${active ? 'active' : ''}`}
                    style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
                    aria-hidden="true"
                  >
                    <span className="srcview-region-label">
                      <span className={`legend-dot ${legendClass(image.legendIndex)}`}>{image.legendIndex}</span>
                      {r.label}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="muted small">
              该图幅来自历史保存结果,未保留原始图片。重新上传截图分析后即可查看原文。
            </p>
          )}
          {activeRegion && (
            <div className="srcview-note">
              <Icons.pin size={15} />
              <div>
                <div className="xsmall" style={{ fontWeight: 600 }}>识别自标注区域「{activeRegion.label}」</div>
                <div className="xsmall muted">{activeRegion.note}</div>
              </div>
            </div>
          )}
          <p className="xsmall muted" style={{ marginTop: 'var(--s-4)' }}>
            区域由 mock 数据标注,仅用于演示来源追溯。接入真实 AI 服务后,将展示模型返回的原文定位。
          </p>
        </div>
      </div>
    </>
  );
}
