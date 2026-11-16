import { useRef, useState } from 'react';
import { useStore } from '../state/store';
import { Icons } from '../lib/icons';

const ACCEPT = 'image/png,image/jpeg,image/webp';

/* 上传面板:点击 + 拖拽,含悬停/上传中/错误状态 */
export function UploadDropzone() {
  const { state, actions } = useStore();
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const upload = state.upload;

  const pick = () => inputRef.current?.click();

  const handleFiles = (files) => {
    if (!files?.length) return;
    actions.addFiles(files);
  };

  return (
    <div className="upload-panel card">
      <div
        className={`dropzone ${dragOver ? 'dragover' : ''} ${upload?.phase === 'reading' ? 'reading' : ''}`}
        role="button"
        tabIndex={0}
        aria-label="上传截图:点击选择文件,或将文件拖拽到此处"
        onClick={pick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            pick();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />

        {upload?.phase === 'reading' ? (
          <div className="dropzone-reading" role="status" aria-live="polite">
            <div className="glyph spin"><Icons.scan size={26} /></div>
            <h3>正在读取图幅…</h3>
            <p className="muted">{upload.current || ''}</p>
            <div className="progress-scale" style={{ width: 220 }}>
              <div className="fill" style={{ width: `${upload.total ? (upload.done / upload.total) * 100 : 0}%` }} />
              <div className="ticks" />
            </div>
            <span className="xsmall muted tabular">{upload.done} / {upload.total} 张</span>
          </div>
        ) : (
          <div className="dropzone-idle">
            <div className="glyph"><Icons.upload size={26} /></div>
            <h3>{dragOver ? '松开以加入图幅' : '点击上传,或把截图拖到这里'}</h3>
            <p className="muted">支持单张或多张截图,一次最多 6 张</p>
            <div className="format-tags" aria-label="支持格式">
              <span>PNG</span>
              <span>JPG</span>
              <span>WEBP</span>
              <span className="tag-note">单张 ≤ 10MB</span>
            </div>
          </div>
        )}
      </div>

      {upload?.rejects?.length > 0 && (
        <div className="upload-rejects" role="alert">
          <Icons.warning size={15} />
          <div>
            {upload.rejects.map((r, i) => (
              <div key={i} className="small">
                <strong>{r.file}</strong>:{' '}
                {r.reason === 'format' && '格式不支持,仅接受 PNG、JPG、WEBP'}
                {r.reason === 'size' && '文件超过 10MB 限制'}
                {r.reason === 'count' && `超过 6 张上限,未加入`}
                {r.reason === 'broken' && '图片损坏或无法读取,请换一张'}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="upload-notes">
        <div className="note-item"><Icons.lock size={13} /> 截图仅在本页面内处理(演示模式),不会上传到服务器</div>
        <div className="note-item"><Icons.info size={13} /> 分析由本地 mock 服务模拟,不会调用真实 AI 接口</div>
      </div>

      <button type="button" className="btn btn-primary btn-lg upload-cta" onClick={pick}>
        <Icons.plus size={16} />
        开始使用 · 上传截图
      </button>
    </div>
  );
}
