import { useStore } from '../state/store';
import { Icons } from '../lib/icons';
import { legendClass } from '../lib/utils';

/* 大图预览(工作区中间):当前图幅 + 图例角标 */
export function ImagePreview() {
  const { state } = useStore();
  const img = state.images.find((i) => i.id === state.currentImageId);

  if (!img) {
    return (
      <div className="empty-state preview-empty">
        <div className="glyph"><Icons.image size={24} /></div>
        <h3>暂无图幅</h3>
        <p>上传截图后,这里会显示当前选中图幅的大图预览。</p>
      </div>
    );
  }

  return (
    <div className="preview-stage">
      <img key={img.id} src={img.url} alt={`截图预览:${img.name}`} />
      <div className="preview-corner">
        <span className={`legend-dot legend-dot-lg ${legendClass(img.legendIndex)}`}>{img.legendIndex}</span>
        <span className="xsmall">图幅 {img.legendIndex}</span>
      </div>
    </div>
  );
}
