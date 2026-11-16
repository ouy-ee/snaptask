/* ============================================================
   服务门面:与 src/mock/service.js 保持相同签名,
   按运行模式(mode)分派到 mock(本地 Demo)或真实后端。
   store 只 import 本文件,不感知数据来源。
   ============================================================ */

import { analyzeImages as mockAnalyzeImages, estimateQuality as mockEstimateQuality } from '../mock/service';
import { apiRequest, apiUpload, apiFetchBlob, setTokens, clearTokens, getTokens, friendlyMessage, ApiError, OfflineError, SessionExpiredError, onSessionExpired } from './client';
import { getMode } from './config';

export { friendlyMessage, ApiError, OfflineError, SessionExpiredError, onSessionExpired, setTokens, clearTokens, getTokens, apiFetchBlob };

/* 本地启发式质量评估(两种模式通用;云端模式下结果页会被 OCR 预检质量覆盖) */
export const estimateQuality = mockEstimateQuality;

/* ---------- 分析(真实后端:上传缺失图幅 → 创建任务 → 轮询合成事件流) ---------- */

const STAGE_KEYS = ['load', 'recognize', 'merge', 'collate', 'compose'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* data URL → Blob(SVG 栅格化为 PNG,与服务端白名单一致) */
async function dataUrlToBlob(dataUrl) {
  if (dataUrl.startsWith('data:image/svg')) return rasterizeSvg(dataUrl);
  const res = await fetch(dataUrl);
  if (!res.ok) throw new Error('image-load-failed');
  return res.blob();
}

async function rasterizeSvg(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || 640;
        canvas.height = img.naturalHeight || 420;
        canvas.getContext('2d').drawImage(img, 0, 0);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('rasterize-failed'))), 'image/png');
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('svg-load-failed'));
    img.src = dataUrl;
  });
}

/* 上传单张图幅(压缩由调用方决定是否执行) */
export async function uploadImageFile(file, onProgress) {
  const formData = new FormData();
  formData.append('file', file, file.name);
  return apiUpload('/api/uploads', formData, { onProgress, timeoutMs: 120000 });
}

/* 客户端图片压缩:大图等比缩到 maxDim 内,超限转 WebP/JPEG(零成本替代服务端缩略图) */
export async function compressImage(file, { maxDim = 2200, maxBytes = 2.5 * 1024 * 1024 } = {}) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size <= maxBytes) return file;
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('read-failed'));
    reader.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('decode-failed'));
    el.src = dataUrl;
  });
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  if (scale >= 1) return file;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const type = file.type === 'image/png' ? 'image/webp' : 'image/jpeg';
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('compress-failed'))), type, 0.85)
  );
  if (!blob || blob.size >= file.size) return file; // 压不小就不压
  const ext = type === 'image/webp' ? 'webp' : 'jpg';
  return new File([blob], file.name.replace(/\.[^.]+$/, `.${ext}`), { type });
}

/* 真实分析:与 mock 同签名(images, { onEvent, isPaused }),附加 onJobId 回调 */
async function analyzeImagesServer(images, { onEvent, isPaused = () => false, onJobId } = {}) {
  const emit = (evt) => onEvent && onEvent(evt);

  // 1) 未上传的图幅(data URL)→ 先上传,拿到 uploadId
  const imageIds = [];
  for (const img of images) {
    if (img.url && !img.url.startsWith('data:')) {
      imageIds.push(img.id); // 已是服务端图幅(上传时 id 即 uploadId)
      continue;
    }
    if (img.url) {
      const blob = await dataUrlToBlob(img.url);
      const up = await uploadImageFile(new File([blob], img.name || 'screenshot.png', { type: blob.type || 'image/png' }));
      imageIds.push(up.id);
    }
  }

  // 2) 创建任务
  const { jobId } = await apiRequest('/api/analysis', { method: 'POST', body: { imageIds } });
  if (onJobId) onJobId(jobId);

  // 3) 轮询快照 → 合成与 mock 一致的事件流
  let lastStage = -1;
  let lastProcessed = -1;
  let lastNote = '';
  const emitSnapshot = (snap) => {
    if (snap.stageLabel != null && snap.stageIndex !== lastStage) {
      lastStage = snap.stageIndex;
      emit({ type: 'stage', index: snap.stageIndex, stage: { key: STAGE_KEYS[snap.stageIndex] || 'load', label: snap.stageLabel, hint: '' } });
    }
    if (snap.processed !== lastProcessed || snap.note !== lastNote) {
      lastProcessed = snap.processed;
      lastNote = snap.note || '';
      emit({ type: 'progress', processed: snap.processed, total: snap.total, note: snap.note || '' });
    }
  };

  for (;;) {
    while (isPaused()) await sleep(150);
    const snap = await apiRequest(`/api/analysis/${jobId}`, { timeoutMs: 30000 });
    emitSnapshot(snap);
    if (snap.status === 'success' || snap.status === 'partial_success') {
      emit({ type: 'done', status: snap.status });
      const imageExtras = {};
      (snap.images || []).forEach((im) => {
        imageExtras[im.id] = { regions: im.regions || [], quality: im.quality || null };
      });
      return {
        status: snap.status === 'partial_success' ? 'partial_success' : 'success',
        scenario: snap.result?.scenario || 'success',
        result: snap.result,
        imageExtras,
      };
    }
    if (snap.status === 'failed') {
      emit({ type: 'error', error: snap.error });
      return { status: 'failed', error: snap.error };
    }
    if (snap.status === 'cancelled') {
      return { status: 'cancelled' };
    }
    await sleep(1100);
  }
}

/* 门面:按模式分派 */
export async function analyzeImages(images, options = {}) {
  if (getMode() === 'server') return analyzeImagesServer(images, options);
  return mockAnalyzeImages(images, options);
}

/* ---------- 服务端持久化 API ---------- */

function historyFromBootstrap(data) {
  const active = (data.records || []).map((r) => ({ ...r, isDeleted: false, saved: null }));
  const trashed = (data.recycle || []).map((r) => ({ ...r, isDeleted: true, deletedAt: r.deletedAt, saved: null }));
  return [...active, ...trashed];
}

export const serverApi = {
  auth: {
    login: (email, password) => apiRequest('/api/auth/login', { method: 'POST', body: { email, password } }),
    register: (name, email, password) => apiRequest('/api/auth/register', { method: 'POST', body: { name, email, password } }),
    logout: async () => {
      const t = getTokens();
      if (t?.refreshToken) {
        try {
          await apiRequest('/api/auth/logout', { method: 'POST', body: { refreshToken: t.refreshToken }, timeoutMs: 5000 });
        } catch {
          /* 尽力而为 */
        }
      }
      clearTokens();
    },
    refresh: async () => {
      const t = getTokens();
      if (!t?.refreshToken) throw new SessionExpiredError();
      const data = await apiRequest('/api/auth/refresh', { method: 'POST', body: { refreshToken: t.refreshToken } });
      setTokens(data);
      return data;
    },
  },

  me: {
    updateName: (name) => apiRequest('/api/me', { method: 'PATCH', body: { name } }),
    changePassword: (currentPassword, newPassword) => apiRequest('/api/me/password', { method: 'POST', body: { currentPassword, newPassword } }),
    exportData: () => apiRequest('/api/me/export', { timeoutMs: 60000 }),
    deleteAccount: () => apiRequest('/api/me', { method: 'DELETE' }),
  },

  /* 拉取全量业务数据(启动/重连/多标签同步) */
  bootstrap: async () => {
    const [folders, records, tasks, archives, recycle] = await Promise.all([
      apiRequest('/api/folders'),
      apiRequest('/api/records?limit=100'),
      apiRequest('/api/tasks'),
      apiRequest('/api/archives'),
      apiRequest('/api/recycle-bin'),
    ]);
    return {
      folders: folders.items,
      history: historyFromBootstrap({ records: records.items, recycle: recycle.items }),
      tasks: tasks.items,
      archives: archives.items,
    };
  },

  folders: {
    create: (name) => apiRequest('/api/folders', { method: 'POST', body: { name } }),
    rename: (id, name) => apiRequest(`/api/folders/${id}`, { method: 'PATCH', body: { name } }),
    remove: (id) => apiRequest(`/api/folders/${id}`, { method: 'DELETE' }),
  },

  records: {
    list: () => apiRequest('/api/records?limit=100'),
    recycle: () => apiRequest('/api/recycle-bin'),
    get: (id) => apiRequest(`/api/records/${id}`),
    create: (payload) => apiRequest('/api/records', { method: 'POST', body: payload }),
    update: (id, payload) => apiRequest(`/api/records/${id}`, { method: 'PATCH', body: payload }),
    softDelete: (id) => apiRequest(`/api/records/${id}`, { method: 'DELETE' }),
    restore: (id) => apiRequest(`/api/records/${id}/restore`, { method: 'POST' }),
    hardDelete: (id) => apiRequest(`/api/records/${id}?permanent=true`, { method: 'DELETE' }),
  },

  tasks: {
    list: () => apiRequest('/api/tasks'),
    add: (task) => apiRequest('/api/tasks', { method: 'POST', body: task }),
    update: (id, patch) => apiRequest(`/api/tasks/${id}`, { method: 'PATCH', body: patch }),
    remove: (id) => apiRequest(`/api/tasks/${id}`, { method: 'DELETE' }),
    sync: (tasks) => apiRequest('/api/tasks/sync', { method: 'POST', body: { tasks } }),
  },

  archives: {
    list: () => apiRequest('/api/archives'),
    addFile: (file, { title, note }, onProgress) => {
      const formData = new FormData();
      formData.append('file', file, file.name);
      if (title) formData.append('title', title);
      if (note) formData.append('note', note);
      return apiUpload('/api/archives', formData, { onProgress });
    },
    addLink: (payload) => apiRequest('/api/archives', { method: 'POST', body: payload }),
    rename: (id, payload) => apiRequest(`/api/archives/${id}`, { method: 'PATCH', body: payload }),
    remove: (id) => apiRequest(`/api/archives/${id}`, { method: 'DELETE' }),
  },

  analysis: {
    cancel: (jobId) => apiRequest(`/api/analysis/${jobId}/cancel`, { method: 'POST' }),
  },
};
