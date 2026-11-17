/* ============================================================
   API 客户端:fetch 封装、令牌自动刷新(单飞)、错误归一化、上传进度。
   错误体系:
   - ApiError          服务端返回的业务错误(带 code,如 EMAIL_TAKEN / QUOTA_EXCEEDED)
   - OfflineError      网络不可达(断网)
   - SessionExpiredError 刷新失败,会话过期(全局事件 → 登出跳登录页)
   ============================================================ */

import { API_BASE } from './config';

export class ApiError extends Error {
  constructor(status, code, message, detail = undefined) {
    super(message || '请求失败');
    this.name = 'ApiError';
    this.status = status;
    this.code = code || 'UNKNOWN';
    this.detail = detail;
  }
}

export class OfflineError extends Error {
  constructor() {
    super('网络连接失败,当前处于离线状态');
    this.name = 'OfflineError';
    this.code = 'OFFLINE';
  }
}

export class SessionExpiredError extends Error {
  constructor() {
    super('登录已过期,请重新登录');
    this.name = 'SessionExpiredError';
    this.code = 'SESSION_EXPIRED';
  }
}

export function friendlyMessage(err) {
  if (!err) return '操作失败';
  if (err instanceof OfflineError) return '网络连接失败,请检查网络后重试';
  if (err instanceof SessionExpiredError) return '登录已过期,请重新登录';
  if (err instanceof ApiError) {
    if (err.status === 429 || err.code === 'RATE_LIMITED') return '操作太频繁,请稍后再试';
    if (err.code === 'USER_NOT_FOUND') return '该邮箱尚未注册,请先注册';
    if (err.code === 'INVALID_PASSWORD' || err.code === 'INVALID_CREDENTIALS') return '邮箱或密码不正确';
    if (err.code === 'EMAIL_TAKEN') return '该邮箱已注册,请直接登录';
    return err.message;
  }
  return err.message || '操作失败';
}

/* ---------- 令牌(缓存到 localStorage,服务端为事实源) ---------- */

const TOKEN_KEY = 'snaptask.tokens';

function loadTokens() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

let tokens = loadTokens();

export function getTokens() {
  return tokens;
}

export function setTokens(next) {
  tokens = next || null;
  try {
    if (next) localStorage.setItem(TOKEN_KEY, JSON.stringify(next));
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 存储不可用不影响内存态 */
  }
}

export function clearTokens() {
  setTokens(null);
}

/* ---------- 会话过期事件 ---------- */

const sessionListeners = new Set();

export function onSessionExpired(callback) {
  sessionListeners.add(callback);
  return () => sessionListeners.delete(callback);
}

function emitSessionExpired() {
  sessionListeners.forEach((cb) => {
    try {
      cb();
    } catch {
      /* ignore */
    }
  });
}

/* ---------- 刷新(单飞:并发 401 只触发一次刷新) ---------- */

let refreshPromise = null;

async function refreshSession() {
  if (!tokens?.refreshToken) throw new SessionExpiredError();
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const data = await rawFetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: tokens.refreshToken }),
          timeoutMs: 15000,
        });
        setTokens(data);
        return data;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

/* ---------- 底层 fetch ---------- */

async function rawFetch(path, { method = 'GET', body, headers = {}, timeoutMs = 30000 } = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? body : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
      throw new ApiError(0, 'TIMEOUT', '请求超时,请稍后重试');
    }
    throw new OfflineError();
  }
  if (res.status === 204) return null;
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code, data?.error?.message || `请求失败(HTTP ${res.status})`, data?.error?.detail);
  }
  return data;
}

/* ---------- 对外请求(自动带令牌,401 过期自动刷新重试一次) ---------- */

export async function apiRequest(path, { method = 'GET', body, headers = {}, timeoutMs = 30000, retried = false } = {}) {
  const h = { ...headers };
  if (body !== undefined && !(body instanceof FormData) && typeof body !== 'string') {
    h['Content-Type'] = 'application/json';
  }
  if (tokens?.accessToken) h.Authorization = `Bearer ${tokens.accessToken}`;
  const payload =
    body === undefined ? undefined : body instanceof FormData || typeof body === 'string' ? body : JSON.stringify(body);

  try {
    return await rawFetch(path, { method, body: payload, headers: h, timeoutMs });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && !retried) {
      try {
        await refreshSession();
        return await apiRequest(path, { method, body, headers, timeoutMs, retried: true });
      } catch (refreshErr) {
        if (refreshErr instanceof ApiError && refreshErr.status === 401) {
          emitSessionExpired();
          throw new SessionExpiredError();
        }
        throw refreshErr;
      }
    }
    throw err;
  }
}

/* ---------- 带 Token 下载文件(Blob;401 自动刷新后重试一次) ----------
   <img src>/window.open/<a href> 都无法携带 Authorization 头,
   私有文件一律走 fetch → Blob → objectURL 预览或触发下载。 */

export async function apiFetchBlob(path, { timeoutMs = 120000, retried = false } = {}) {
  const headers = {};
  if (tokens?.accessToken) headers.Authorization = `Bearer ${tokens.accessToken}`;
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
      throw new ApiError(0, 'TIMEOUT', '下载超时,请稍后重试');
    }
    throw new OfflineError();
  }
  if (res.status === 401 && !retried) {
    try {
      await refreshSession();
      return apiFetchBlob(path, { timeoutMs, retried: true });
    } catch (refreshErr) {
      if (refreshErr instanceof ApiError && refreshErr.status === 401) {
        emitSessionExpired();
        throw new SessionExpiredError();
      }
      throw refreshErr;
    }
  }
  if (!res.ok) {
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    throw new ApiError(res.status, data?.error?.code, data?.error?.message || `下载失败(HTTP ${res.status})`, data?.error?.detail);
  }
  return res.blob();
}

/* ---------- 上传(XHR,支持进度;401 自动刷新后重试一次) ---------- */

export function apiUpload(path, formData, { onProgress, timeoutMs = 120000, retried = false } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}${path}`);
    if (tokens?.accessToken) xhr.setRequestHeader('Authorization', `Bearer ${tokens.accessToken}`);
    xhr.timeout = timeoutMs;
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total);
      };
    }
    xhr.onload = () => {
      if (xhr.status === 401 && !retried) {
        refreshSession()
          .then(() => apiUpload(path, formData, { onProgress, timeoutMs, retried: true }))
          .then(resolve)
          .catch((refreshErr) => {
            if (refreshErr instanceof ApiError && refreshErr.status === 401) {
              emitSessionExpired();
              reject(new SessionExpiredError());
            } else {
              reject(refreshErr);
            }
          });
        return;
      }
      let data = null;
      try {
        data = JSON.parse(xhr.responseText || 'null');
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, data?.error?.code, data?.error?.message || `上传失败(HTTP ${xhr.status})`, data?.error?.detail));
    };
    xhr.onerror = () => reject(new OfflineError());
    xhr.ontimeout = () => reject(new ApiError(0, 'TIMEOUT', '上传超时,请检查网络'));
    xhr.send(formData);
  });
}
