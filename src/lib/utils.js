/* 通用工具 */

let seq = 0;
export function uid(prefix = 'id') {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(iso) {
  if (!iso) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso; // 已是日期字符串,避免时区偏移
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatTime(ts) {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sleepJitter(base, spread = 0.5) {
  const ms = base * (1 - spread + Math.random() * spread * 2);
  return delay(ms);
}

/* 图例色标类名:第 n 张图 → legend-n */
export function legendClass(index) {
  const n = ((index - 1) % 6) + 1;
  return `legend-${n}`;
}

/* 置信度 → 展示 */
export function confidenceLabel(c) {
  if (c == null) return '';
  if (c >= 0.9) return '高置信';
  if (c >= 0.75) return '较高置信';
  if (c >= 0.5) return '低置信';
  return '极低置信';
}

export function confidenceBadge(c) {
  if (c == null) return { label: '', cls: 'badge-neutral' };
  if (c >= 0.9) return { label: `高 · ${Math.round(c * 100)}%`, cls: 'badge-green' };
  if (c >= 0.75) return { label: `${Math.round(c * 100)}%`, cls: 'badge-info' };
  return { label: `低 · ${Math.round(c * 100)}%`, cls: 'badge-warn' };
}

/* 相对区域坐标 → px(用于大图预览叠加层) */
export function regionToPx(region, boxW, boxH) {
  const pad = 0; // 预览容器已 contain,直接按比例
  return {
    left: region.x * boxW + pad,
    top: region.y * boxH + pad,
    width: region.w * boxW - pad * 2,
    height: region.h * boxH - pad * 2,
  };
}
