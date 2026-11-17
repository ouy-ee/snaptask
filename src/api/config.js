/* ============================================================
   模式探测:启动时 ping /api/health
   - server:后端在线 → 云端模式(需登录,数据存服务端)
   - local :后端不可用 → 本地 Demo 模式(与旧版行为完全一致)
   ============================================================ */

export const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

/* 服务端资源路径 → 浏览器可用的绝对地址。
   服务端返回的图片 URL 是相对路径(/api/uploads/...),
   跨域部署(前端静态站 + 独立后端域名)时 <img> 必须拼上 API_BASE;
   data:/blob:/绝对 URL 原样返回。 */
export function resolveApiUrl(path) {
  if (!path) return path;
  if (path.startsWith('data:') || path.startsWith('blob:') || /^https?:\/\//.test(path)) return path;
  return `${API_BASE}${path}`;
}

let currentMode = 'checking'; // checking | server | local

export function getMode() {
  return currentMode;
}

/* 测试辅助:直接注入模式,跳过网络探测 */
export function setModeForTest(mode) {
  currentMode = mode;
}

export async function detectMode() {
  try {
    const res = await fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(2500) });
    const data = await res.json().catch(() => null);
    currentMode = res.ok && data?.ok === true && data?.service === 'snaptask-server' ? 'server' : 'local';
  } catch {
    currentMode = 'local';
  }
  return currentMode;
}
