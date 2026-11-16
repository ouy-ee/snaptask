/* ============================================================
   模式探测:启动时 ping /api/health
   - server:后端在线 → 云端模式(需登录,数据存服务端)
   - local :后端不可用 → 本地 Demo 模式(与旧版行为完全一致)
   ============================================================ */

export const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

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
    currentMode = res.ok ? 'server' : 'local';
  } catch {
    currentMode = 'local';
  }
  return currentMode;
}
