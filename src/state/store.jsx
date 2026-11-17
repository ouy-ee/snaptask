/* ============================================================
   全局状态:阶段流转、图幅队列、分析状态、结果编辑(undo/redo)
   持久化策略:
   - local 模式(Demo,无后端):localStorage,与旧版一致
   - server 模式(云端):服务端为唯一事实源,localStorage 仅作缓存;
     所有写操作先落服务端;断网读缓存;BroadcastChannel 多标签同步
   ============================================================ */

import { createContext, useContext, useMemo, useReducer, useRef, useCallback, useEffect } from 'react';
import { analyzeImages, estimateQuality, serverApi, compressImage, uploadImageFile, friendlyMessage, onSessionExpired, clearTokens, getTokens, setTokens } from '../api/service';
import { detectMode, getMode } from '../api/config';
import { openSyncChannel, broadcastSync } from '../api/sync';
import { PROC_SHOTS } from '../mock/screens';
import { PROCUREMENT_RESULT } from '../mock/data';
import { uid } from '../lib/utils';

const StoreContext = createContext(null);
export const useStore = () => useContext(StoreContext);

const SAVED_KEY = 'snaptask.saved';
const HISTORY_KEY = 'snaptask.history';
const USER_KEY = 'snaptask.user';
const FOLDERS_KEY = 'snaptask.folders';
const MAX_IMAGES = 6;
const MAX_SIZE = 10 * 1024 * 1024;
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];

function loadSaved() {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function loadHistoryRecords() {
  return loadJson(HISTORY_KEY, []).map((item) => ({ ...item, isDeleted: item.isDeleted ?? false, deletedAt: item.deletedAt ?? null }));
}

/* 初始状态工厂(导出供测试) */
export function createInitialState({ mode = 'checking', booted = false } = {}) {
  return {
    stage: 'home', // home | workspace | analyzing | results
    mode, // checking | local | server
    booted,
    images: [],
    currentImageId: null,
    analysis: null,
    upload: null, // { total, done, current, phase: 'reading' | 'done' | 'error', rejects: [] }
    demoMode: false, // 当前数据是否来自内置示例
    scenarioChoice: 'auto', // auto | success | partial | failed(仅 local 模式生效)
    dirty: false,
    savedAt: null,
    saved: loadSaved(), // 上次保存的结果(入口用)
    user: loadJson(USER_KEY, null),
    history: loadHistoryRecords(),
    repositoryName: loadJson('snaptask.repository', '我的在线仓库'),
    repositoryHandle: null,
    imageHistory: loadJson('snaptask.image-history', []),
    urgentTasks: loadJson('snaptask.urgent-tasks', []),
    archives: loadJson('snaptask.archives', []),
    folders: loadJson(FOLDERS_KEY, [{ id: 'folder-inbox', name: '未整理', parentId: null }]),
    currentFolderId: loadJson('snaptask.current-folder', 'folder-inbox'),
    loadedRecordId: null, // 当前结果对应的服务端记录 id(保存修改时 PATCH)
    past: [],
    future: [],
    toasts: [],
    sourceViewer: null, // { imageId, regionId }
    confirm: null, // { title, body, confirmLabel, danger, onConfirmId, payload }
    flash: null, // { id, ts }
  };
}

const initialState = createInitialState();

let toastSeq = 0;

function withToast(state, toast) {
  return { ...state, toasts: [...state.toasts, { ...toast, id: `toast-${++toastSeq}` }] };
}

/* 结果编辑:push past 快照 */
function editResult(state, updater) {
  if (!state.analysis?.result) return state;
  const snapshot = JSON.parse(JSON.stringify(state.analysis.result));
  const next = updater(JSON.parse(JSON.stringify(state.analysis.result)));
  return {
    ...state,
    analysis: { ...state.analysis, result: next },
    past: [...state.past, snapshot],
    future: [],
    dirty: true,
  };
}

export function reducer(state, action) {
  switch (action.type) {
    case 'MODE_SET':
      return { ...state, mode: action.mode, ...(action.mode === 'server' ? { user: null } : {}) };
    case 'BOOT_DONE':
      return { ...state, booted: true };

    case 'UPLOAD_START':
      return { ...state, upload: { total: action.total, done: 0, current: null, phase: 'reading', rejects: [] } };
    case 'UPLOAD_PROGRESS':
      return { ...state, upload: { ...state.upload, done: action.done, current: action.current } };
    case 'UPLOAD_REJECT':
      return {
        ...state,
        upload: { ...state.upload, rejects: [...state.upload.rejects, action.reject] },
      };
    case 'UPLOAD_DONE': {
      const next = { ...state, upload: { ...state.upload, phase: 'done' } };
      return action.count > 0
        ? { ...next, stage: state.stage === 'home' ? 'workspace' : state.stage, currentImageId: state.currentImageId || action.lastId }
        : next;
    }
    case 'UPLOAD_RESET':
      return { ...state, upload: null };

    case 'AUTH_SET':
      return { ...state, user: action.user };
    /* 登录/启动引导:一次写入会话 + 全量业务数据 */
    case 'SESSION_SET':
      return {
        ...state,
        user: action.user,
        folders: action.folders ?? state.folders,
        history: action.history ?? state.history,
        urgentTasks: action.urgentTasks ?? state.urgentTasks,
        archives: action.archives ?? state.archives,
      };
    /* 重连/多标签同步:仅刷新业务数据 */
    case 'SYNC_SET':
      return {
        ...state,
        folders: action.folders ?? state.folders,
        history: action.history ?? state.history,
        urgentTasks: action.urgentTasks ?? state.urgentTasks,
        archives: action.archives ?? state.archives,
      };
    case 'HISTORY_SET':
      return { ...state, history: action.history };
    case 'URGENT_TASKS_SET':
      localStorage.setItem('snaptask.urgent-tasks', JSON.stringify(action.tasks));
      return { ...state, urgentTasks: action.tasks };
    case 'URGENT_TASK_ADD': {
      const urgentTasks = [action.task, ...state.urgentTasks];
      localStorage.setItem('snaptask.urgent-tasks', JSON.stringify(urgentTasks));
      return { ...state, urgentTasks };
    }
    case 'URGENT_TASK_UPDATE': {
      const urgentTasks = state.urgentTasks.map((task) => task.id === action.id ? { ...task, ...action.patch } : task);
      const updateResult = (result) => result ? { ...result, tasks: result.tasks.map((task) => task.id === action.id ? { ...task, ...action.patch } : task) } : result;
      const analysis = state.analysis?.result ? { ...state.analysis, result: updateResult(state.analysis.result) } : state.analysis;
      const history = state.history.map((record) => record.saved?.result ? { ...record, saved: { ...record.saved, result: updateResult(record.saved.result) } } : record);
      localStorage.setItem('snaptask.urgent-tasks', JSON.stringify(urgentTasks));
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      return { ...state, urgentTasks, analysis, history };
    }
    case 'URGENT_TASK_DELETE': {
      const urgentTasks = state.urgentTasks.filter((task) => task.id !== action.id);
      const updateResult = (result) => result ? { ...result, tasks: result.tasks.filter((task) => task.id !== action.id) } : result;
      const analysis = state.analysis?.result ? { ...state.analysis, result: updateResult(state.analysis.result) } : state.analysis;
      const history = state.history.map((record) => record.saved?.result ? { ...record, saved: { ...record.saved, result: updateResult(record.saved.result) } } : record);
      localStorage.setItem('snaptask.urgent-tasks', JSON.stringify(urgentTasks));
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      return { ...state, urgentTasks, analysis, history };
    }
    case 'ARCHIVE_ADD': {
      const archives = [action.archive, ...state.archives];
      localStorage.setItem('snaptask.archives', JSON.stringify(archives));
      return { ...state, archives };
    }
    case 'ARCHIVE_DELETE': {
      const archives = state.archives.filter((item) => item.id !== action.id);
      localStorage.setItem('snaptask.archives', JSON.stringify(archives));
      return { ...state, archives };
    }
    case 'ARCHIVE_RENAME': {
      const archives = state.archives.map((item) => item.id === action.id ? { ...item, title: action.title } : item);
      localStorage.setItem('snaptask.archives', JSON.stringify(archives));
      return { ...state, archives };
    }
    case 'REPOSITORY_SET':
      return { ...state, repositoryName: action.name, repositoryHandle: action.handle || null };
    case 'FOLDER_SET':
      localStorage.setItem('snaptask.current-folder', JSON.stringify(action.id));
      return { ...state, currentFolderId: action.id };
    case 'FOLDER_CREATE':
    case 'CREATE_FOLDER': {
      const folders = [...state.folders, action.folder];
      localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
      localStorage.setItem('snaptask.current-folder', JSON.stringify(action.folder.id));
      return { ...state, folders, currentFolderId: action.folder.id };
    }
    case 'FOLDER_RENAME':
    case 'RENAME_FOLDER': {
      const folders = state.folders.map((folder) => folder.id === action.id ? { ...folder, name: action.name } : folder);
      localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
      return { ...state, folders };
    }
    case 'FOLDER_DELETE':
    case 'DELETE_FOLDER': {
      const folders = state.folders.filter((folder) => folder.id !== action.id);
      const history = state.history.map((item) => item.folderId === action.id ? { ...item, folderId: 'folder-inbox' } : item);
      localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      return { ...state, folders, history, currentFolderId: state.currentFolderId === action.id ? 'folder-inbox' : state.currentFolderId };
    }
    case 'RECORD_MOVE':
    case 'MOVE_RECORD': {
      const history = state.history.map((item) => item.id === action.id ? { ...item, folderId: action.folderId } : item);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      return { ...state, history };
    }
    case 'SOFT_DELETE_RECORD':
    case 'RECORD_DELETE':
    case 'DELETE_RECORD': {
      const history = state.history.map((item) => item.id === action.id ? { ...item, isDeleted: true, deletedAt: Date.now() } : item);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      return { ...state, history };
    }
    case 'RESTORE_RECORD': {
      const history = state.history.map((item) => item.id === action.id ? { ...item, isDeleted: false, deletedAt: null } : item);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      return { ...state, history };
    }
    case 'HARD_DELETE_RECORD': {
      const history = state.history.filter((item) => item.id !== action.id);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      return { ...state, history };
    }

    case 'ADD_IMAGE': {
      const images = [...state.images, action.image];
      const imageHistory = [{ id: action.image.id, name: action.image.name, addedAt: Date.now(), legendIndex: action.image.legendIndex }, ...state.imageHistory.filter((i) => i.id !== action.image.id)].slice(0, 30);
      localStorage.setItem('snaptask.image-history', JSON.stringify(imageHistory));
      return { ...state, images, imageHistory, currentImageId: state.currentImageId || action.image.id, demoMode: false };
    }
    case 'ADD_IMAGES_BATCH': {
      let images = [...state.images];
      let imageHistory = [...state.imageHistory];
      action.images.forEach((image) => {
        // server 模式保持原 id(uploadId),分析时直接引用已上传图幅
        const next = { ...image, id: state.mode === 'server' ? image.id : uid('img'), uploadedAt: Date.now() };
        images.push(next);
        imageHistory.unshift({ id: next.id, name: next.name, addedAt: next.uploadedAt, legendIndex: next.legendIndex });
      });
      imageHistory = imageHistory.slice(0, 30);
      localStorage.setItem('snaptask.image-history', JSON.stringify(imageHistory));
      return { ...state, images: images.slice(0, MAX_IMAGES), imageHistory, currentImageId: state.currentImageId || images[0]?.id || null, demoMode: false };
    }
    case 'REMOVE_IMAGE': {
      const images = state.images.filter((i) => i.id !== action.id);
      const next = {
        ...state,
        images,
        currentImageId: state.currentImageId === action.id ? images[0]?.id ?? null : state.currentImageId,
      };
      if (state.stage === 'results' && state.analysis) {
        // 结果页里移除图幅 → 结果重新映射(该图来源标记消失)
        const result = remapResult(state.analysis.result, images);
        return editResult({ ...next, dirty: state.dirty }, () => result);
      }
      return next;
    }
    case 'REPLACE_IMAGE': {
      const images = state.images.map((image) => image.id === action.id ? { ...image, ...action.image, id: action.id, uploadedAt: Date.now() } : image);
      return { ...state, images, currentImageId: action.id, demoMode: false };
    }
    /* server 模式:替换为新上传图幅(id 变为新 uploadId) */
    case 'REPLACE_IMAGE_BY_ID': {
      const images = state.images.map((image) => (image.id === action.oldId ? action.image : image));
      return { ...state, images, currentImageId: state.currentImageId === action.oldId ? action.image.id : state.currentImageId, demoMode: false };
    }
    case 'MOVE_IMAGE': {
      const idx = state.images.findIndex((i) => i.id === action.id);
      const to = idx + action.dir;
      if (idx < 0 || to < 0 || to >= state.images.length) return state;
      const images = [...state.images];
      [images[idx], images[to]] = [images[to], images[idx]];
      return { ...state, images };
    }
    case 'SET_CURRENT':
      return { ...state, currentImageId: action.id };

    case 'ANALYZE_START':
      return {
        ...state,
        stage: 'analyzing',
        analysis: {
          status: 'processing',
          stageIndex: 0,
          stageLabel: null,
          processed: 0,
          total: Math.max(1, state.images.length),
          note: null,
          error: null,
          scenario: action.scenario,
          result: null,
        },
      };
    case 'ANALYZE_EVENT': {
      const a = state.analysis;
      if (!a) return state;
      if (action.evt.type === 'stage') {
        return { ...state, analysis: { ...a, stageIndex: action.evt.index, stageLabel: action.evt.stage } };
      }
      if (action.evt.type === 'progress') {
        return {
          ...state,
          analysis: { ...a, processed: action.evt.processed, total: action.evt.total, note: action.evt.note },
        };
      }
      if (action.evt.type === 'error') {
        return { ...state, analysis: { ...a, status: 'failed', error: action.evt.error } };
      }
      if (action.evt.type === 'done') {
        return {
          ...state,
          analysis: { ...a, status: action.evt.status, processed: a.total },
          // result 在 ANALYZE_DONE 中写入
        };
      }
      return state;
    }
    case 'ANALYZE_PAUSE':
      return state.analysis ? { ...state, analysis: { ...state.analysis, status: 'paused', note: '分析已暂停' } } : state;
    case 'ANALYZE_RESUME':
      return state.analysis ? { ...state, analysis: { ...state.analysis, status: 'processing', note: '已继续分析…' } } : state;
    case 'ANALYZE_DONE': {
      let images = state.images;
      // 云端模式:合并服务端返回的 OCR regions / 质量预检
      if (action.imageExtras) {
        images = images.map((img) => (action.imageExtras[img.id] ? { ...img, regions: action.imageExtras[img.id].regions || img.regions, quality: action.imageExtras[img.id].quality || img.quality } : img));
      }
      const next = {
        ...state,
        images,
        stage: 'results',
        analysis: { ...state.analysis, status: action.status, result: action.result },
        loadedRecordId: null,
        past: [],
        future: [],
        dirty: false,
      };
      if (action.status === 'partial_success') {
        return withToast(next, {
          kind: 'warn',
          text: '分析部分完成:部分图幅识别受限,相关字段已标注为不确定或未提及',
          timeout: 6000,
        });
      }
      return next;
    }
    case 'ANALYZE_FAILED':
      return { ...state, analysis: { ...state.analysis, status: 'failed', error: action.error } };
    case 'ANALYZE_CANCEL':
      return { ...state, stage: 'workspace', analysis: null };
    case 'ANALYZE_RETRYING':
      return { ...state, analysis: { ...state.analysis, status: 'retrying', error: null } };
    case 'BACK_TO_WORKSPACE':
      return { ...state, stage: 'workspace', analysis: null };
    case 'BACK_TO_HOME':
      return {
        ...state,
        stage: 'home',
        analysis: null,
        images: [],
        currentImageId: null,
        loadedRecordId: null,
        past: [],
        future: [],
        dirty: false,
        savedAt: null,
        upload: null,
        sourceViewer: null,
      };

    /* ---------- 结果编辑 ---------- */
    case 'UPDATE_TASK':
      return editResult(state, (r) => {
        const t = r.tasks.find((x) => x.id === action.id);
        if (t) Object.assign(t, action.patch);
        return r;
      });
    case 'ADD_TASK':
      return editResult(state, (r) => {
        r.tasks.push({
          id: uid('t'),
          title: action.task.title || '新任务',
          description: action.task.description || '',
          assignee: action.task.assignee ?? null,
          dueDate: action.task.dueDate ?? null,
          priority: action.task.priority || 'medium',
          status: 'todo',
          done: false,
          src: [],
        });
        return r;
      });
    case 'DELETE_TASK':
      return editResult(state, (r) => ({ ...r, tasks: r.tasks.filter((t) => t.id !== action.id) }));
    case 'TOGGLE_TASK':
      return editResult(state, (r) => {
        const t = r.tasks.find((x) => x.id === action.id);
        if (t) {
          t.done = !t.done;
          t.status = t.done ? 'done' : 'todo';
        }
        return r;
      });
    case 'UPDATE_FACT':
      return editResult(state, (r) => {
        const f = r.facts.find((x) => x.id === action.id) || r.keyFacts.find((x) => x.id === action.id);
        if (f) Object.assign(f, action.patch);
        return r;
      });
    case 'UPDATE_CELL':
      return editResult(state, (r) => {
        const row = r.comparison.rows.find((x) => x.id === action.rowId);
        if (row) {
          row.cells[action.dimId] = { ...(row.cells[action.dimId] || {}), ...action.patch };
        }
        return r;
      });
    case 'ADD_ROW':
      return editResult(state, (r) => {
        const cells = {};
        r.comparison.dims.forEach((d) => {
          cells[d.id] = { value: null, missing: true, src: [] };
        });
        r.comparison.rows.push({ id: uid('row'), label: action.label || '新对象', cells });
        return r;
      });
    case 'DELETE_ROW':
      return editResult(state, (r) => ({
        ...r,
        comparison: { ...r.comparison, rows: r.comparison.rows.filter((x) => x.id !== action.id) },
      }));
    case 'ADD_COLUMN':
      return editResult(state, (r) => {
        const dim = { id: uid('d'), label: action.label || '新维度' };
        r.comparison.dims.push(dim);
        r.comparison.rows.forEach((row) => {
          row.cells[dim.id] = { value: null, missing: true, src: [] };
        });
        return r;
      });
    case 'DELETE_COLUMN':
      return editResult(state, (r) => {
        r.comparison.dims = r.comparison.dims.filter((d) => d.id !== action.id);
        r.comparison.rows.forEach((row) => {
          delete row.cells[action.id];
        });
        return r;
      });
    case 'RESOLVE_CONFLICT_TASK':
      return editResult(state, (r) => {
        const t = r.tasks.find((x) => x.id === action.id);
        if (t?.dueDate?.conflict) {
          const all = t.dueDate.values.flatMap((v) => v.src);
          t.dueDate = { value: action.value, src: [...new Set(all)] };
        }
        return r;
      });
    case 'DISMISS_WARNING':
      return editResult(state, (r) => ({ ...r, warnings: r.warnings.filter((w) => w.id !== action.id) }));

    case 'UNDO': {
      if (!state.past.length) return state;
      const prev = state.past[state.past.length - 1];
      return {
        ...state,
        analysis: { ...state.analysis, result: prev },
        past: state.past.slice(0, -1),
        future: [JSON.parse(JSON.stringify(state.analysis.result)), ...state.future],
        dirty: true,
      };
    }
    case 'REDO': {
      if (!state.future.length) return state;
      const next = state.future[0];
      return {
        ...state,
        analysis: { ...state.analysis, result: next },
        future: state.future.slice(1),
        past: [...state.past, JSON.parse(JSON.stringify(state.analysis.result))],
        dirty: true,
      };
    }
    case 'SAVE_RESULT': {
      const saved = { savedAt: action.savedAt, images: action.images, result: action.result };
      const contentTags = action.result.content_tags || [
        ...(action.result.tasks?.length || action.result.summary?.suggestions?.length ? ['待办'] : []),
        ...(action.result.facts?.length || action.result.keyFacts?.length ? ['资料'] : []),
      ];
      const historyItem = { id: action.recordId || `history-${action.savedAt}`, savedAt: action.savedAt, title: action.title || '未命名分析', imageCount: action.images.length, folderId: action.folderId, contentTags, saved };
      const history = [historyItem, ...state.history.filter((item) => item.id !== historyItem.id)].slice(0, 20);
      try {
        const blob = JSON.stringify(saved);
        if (blob.length < 3.5 * 1024 * 1024) {
          localStorage.setItem(SAVED_KEY, blob);
          localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
          return { ...state, dirty: false, savedAt: action.savedAt, saved, history };
        }
        // 图幅过大:仅保存文本结果
        const slim = {
          savedAt: action.savedAt,
          images: action.images.map((i) => ({ ...i, url: null, urlDropped: true })),
          result: action.result,
        };
        localStorage.setItem(SAVED_KEY, JSON.stringify(slim));
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
        return {
          ...state,
          dirty: false,
          savedAt: action.savedAt,
          saved: slim,
          history,
          toasts: [
            ...state.toasts,
            { id: `toast-${++toastSeq}`, kind: 'warn', text: '已保存结果(图幅过大,仅保留文本结果)' },
          ],
        };
      } catch {
        return withToast(state, { kind: 'error', text: '保存失败:浏览器存储不可用' });
      }
    }
    case 'LOAD_SAVED': {
      const s = action.saved;
      return {
        ...state,
        stage: 'results',
        images: s.images.map((i, n) => ({ ...i, legendIndex: n + 1, url: i.url || null })),
        currentImageId: s.images[0]?.id ?? null,
        analysis: {
          status: 'success',
          stageIndex: 4,
          stageLabel: null,
          processed: s.images.length,
          total: s.images.length,
          note: null,
          error: null,
          scenario: 'saved',
          result: s.result,
        },
        loadedRecordId: action.recordId ?? null,
        demoMode: false,
        dirty: false,
        savedAt: s.savedAt,
        past: [],
        future: [],
      };
    }
    case 'LOAD_HISTORY': {
      const item = state.history.find((x) => x.id === action.id);
      return item ? reducer(state, { type: 'LOAD_SAVED', saved: item.saved, recordId: item.id }) : state;
    }
    case 'LOAD_DEMO': {
      const { images, result } = action.demo;
      const mapped = images.map((img, n) => ({ ...img, legendIndex: n + 1 }));
      return {
        ...state,
        stage: action.directToResults ? 'results' : 'workspace',
        images: mapped,
        currentImageId: mapped[0]?.id ?? null,
        analysis: action.directToResults
          ? {
              status: result.scenario === 'partial' ? 'partial_success' : 'success',
              stageIndex: 4,
              stageLabel: null,
              processed: mapped.length,
              total: mapped.length,
              note: null,
              error: null,
              scenario: result.scenario,
              result: result,
            }
          : null,
        loadedRecordId: null,
        demoMode: true,
        past: [],
        future: [],
        dirty: false,
        savedAt: null,
      };
    }

    case 'TOAST_PUSH':
      return withToast(state, action.toast);
    case 'TOAST_REPLACE':
      return withToast({ ...state, toasts: [] }, action.toast);
    case 'TOAST_DISMISS':
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) };
    case 'TOAST_CLEAR':
      return { ...state, toasts: [] };

    case 'OPEN_SOURCE_VIEWER':
      return { ...state, sourceViewer: action.payload };
    case 'CLOSE_SOURCE_VIEWER':
      return { ...state, sourceViewer: null };

    case 'CONFIRM_SET':
      return { ...state, confirm: action.confirm };
    case 'CONFIRM_CLEAR':
      return { ...state, confirm: null };

    case 'FLASH_SET':
      return { ...state, flash: { id: action.id, ts: Date.now() } };
    case 'FLASH_CLEAR':
      return { ...state, flash: null };

    case 'SET_SCENARIO':
      return { ...state, scenarioChoice: action.scenario };

    default:
      return state;
  }
}

/* 移除图幅后重映射结果中的来源引用 */
function remapResult(result, images) {
  const ids = new Set(images.map((i) => i.id));
  const keep = (src = []) => src.filter((s) => ids.has(s));
  const r = JSON.parse(JSON.stringify(result));
  const m = (it) => {
    it.src = keep(it.src);
    return it;
  };
  r.summary.oneLiner = m(r.summary.oneLiner);
  r.summary.facts.forEach(m);
  r.summary.inferences.forEach(m);
  r.summary.suggestions.forEach(m);
  r.facts.forEach(m);
  r.keyFacts.forEach(m);
  r.tasks.forEach((t) => {
    t.src = keep(t.src);
    if (t.dueDate?.conflict) t.dueDate.values.forEach((v) => (v.src = keep(v.src)));
  });
  r.comparison.rows.forEach((row) => {
    Object.values(row.cells).forEach((c) => {
      c.src = keep(c.src);
      if (c.conflict) c.values.forEach((v) => (v.src = keep(v.src)));
    });
  });
  r.warnings.forEach((w) => (w.src = keep(w.src)));
  return r;
}

export function StoreProvider({ children, boot = true, testState = null }) {
  const [state, dispatch] = useReducer(reducer, testState || initialState);
  const bootingRef = useRef(Boolean(boot));
  const userRef = useRef(state.user);
  const authTransitionRef = useRef(false);
  const runRef = useRef(null);
  const analysisJobRef = useRef(null);
  const confirmActionRef = useRef(null);
  userRef.current = state.user;

  const actions = useMemo(() => {
    const toast = (kind, text, timeout = 3600) => {
      dispatch({ type: 'TOAST_PUSH', toast: { kind, text, timeout } });
    };
    const authToast = (kind, text, timeout = 3600) => {
      dispatch({ type: 'TOAST_REPLACE', toast: { kind, text, timeout } });
    };

    const isServer = () => state.mode === 'server';

    /* ---------- 上传 ---------- */
    const addFiles = async (fileList) => {
      const files = [...fileList];
      const rejects = [];
      let ok = [];
      for (const f of files) {
        if (!ACCEPTED.includes(f.type)) {
          rejects.push({ file: f.name, reason: 'format' });
          continue;
        }
        if (f.size > MAX_SIZE) {
          rejects.push({ file: f.name, reason: 'size' });
          continue;
        }
        ok.push(f);
      }
      const room = MAX_IMAGES - state.images.length;
      if (ok.length > room) {
        rejects.push({ file: ok.slice(room).map((f) => f.name).join('、'), reason: 'count' });
        ok = ok.slice(0, room);
      }

      dispatch({ type: 'UPLOAD_START', total: ok.length });
      rejects.forEach((r) => dispatch({ type: 'UPLOAD_REJECT', reject: r }));

      let added = 0;
      let lastId = null;
      for (let i = 0; i < ok.length; i++) {
        const f = ok[i];
        dispatch({ type: 'UPLOAD_PROGRESS', done: i, current: f.name });
        if (isServer()) {
          /* 云端模式:压缩后直传服务端,url 为鉴权接口地址 */
          try {
            const compressed = await compressImage(f);
            const up = await uploadImageFile(compressed, () => {});
            const legendIndex = nextLegendIndex(state.images, added);
            const img = {
              id: up.id,
              name: f.name,
              url: up.url,
              width: up.width,
              height: up.height,
              sizeKb: up.sizeKb,
              uploadedAt: Date.now(),
              legendIndex,
              quality: { score: estimateQuality(f), label: '清晰', issues: [] },
              regions: [],
            };
            dispatch({ type: 'ADD_IMAGE', image: img, legendIndex });
            added += 1;
            lastId = img.id;
          } catch (err) {
            dispatch({ type: 'UPLOAD_REJECT', reject: { file: f.name, reason: err?.code === 'UPLOAD_TYPE_FORBIDDEN' ? 'format' : 'broken' } });
          }
        } else {
          /* 本地模式:读为 data URL(与旧版一致) */
          try {
            const dataUrl = await readFileAsDataUrl(f);
            const dims = await probeImage(dataUrl);
            const legendIndex = nextLegendIndex(state.images, added);
            const img = {
              id: uid('img'),
              name: f.name,
              url: dataUrl,
              width: dims.width,
              height: dims.height,
              sizeKb: Math.round(f.size / 1024),
              uploadedAt: Date.now(),
              legendIndex,
              quality: { score: estimateQuality(f), label: '清晰', issues: [] },
              regions: [],
            };
            dispatch({ type: 'ADD_IMAGE', image: img, legendIndex });
            added += 1;
            lastId = img.id;
          } catch {
            dispatch({ type: 'UPLOAD_REJECT', reject: { file: f.name, reason: 'broken' } });
          }
        }
        dispatch({ type: 'UPLOAD_PROGRESS', done: i + 1, current: null });
      }
      dispatch({ type: 'UPLOAD_DONE', count: added, lastId });
      if (added > 0) toast('ok', `已加入 ${added} 张截图`);
      if (rejects.length) {
        const why = rejects.map((r) => `${r.file}(${rejectLabel(r.reason)})`).join('、');
        toast('error', `${rejects.length} 个文件未通过校验:${why}`);
      }
      return added;
    };

    /* ---------- 分析 ---------- */
    const startAnalysis = async (scenario) => {
      dispatch({ type: 'ANALYZE_START', scenario });
      const token = { cancelled: false };
      runRef.current = token;
      analysisJobRef.current = null;
      try {
        const res = await analyzeImages(state.images, {
          scenario,
          isPaused: () => token.paused,
          onEvent: (evt) => {
            if (token.cancelled) return;
            dispatch({ type: 'ANALYZE_EVENT', evt });
          },
          onJobId: (jobId) => {
            analysisJobRef.current = jobId;
          },
        });
        if (token.cancelled) return;
        if (res.status === 'failed') {
          dispatch({ type: 'ANALYZE_FAILED', error: res.error });
        } else if (res.status !== 'cancelled') {
          dispatch({ type: 'ANALYZE_DONE', status: res.status, result: res.result, imageExtras: res.imageExtras });
        }
      } catch (err) {
        if (token.cancelled) return;
        dispatch({
          type: 'ANALYZE_FAILED',
          error: { code: err?.code || 'ANALYZE_FAILED', title: '分析失败', detail: friendlyMessage(err), recoverable: true },
        });
      }
    };

    const cancelAnalysis = () => {
      if (runRef.current) runRef.current.cancelled = true;
      if (isServer() && analysisJobRef.current) {
        serverApi.analysis.cancel(analysisJobRef.current).catch(() => {});
        analysisJobRef.current = null;
      }
      dispatch({ type: 'ANALYZE_CANCEL' });
    };
    const reanalyzeCurrent = () => startAnalysis(state.scenarioChoice);
    const replaceImage = async (id, file) => {
      if (isServer()) {
        try {
          const compressed = await compressImage(file);
          const up = await uploadImageFile(compressed, () => {});
          dispatch({
            type: 'REPLACE_IMAGE_BY_ID',
            oldId: id,
            image: { id: up.id, name: file.name, url: up.url, width: up.width, height: up.height, sizeKb: up.sizeKb, quality: { score: estimateQuality(file), label: '清晰', issues: [] }, regions: [] },
          });
          return true;
        } catch (err) {
          toast('error', friendlyMessage(err));
          return false;
        }
      }
      try {
        const url = await readFileAsDataUrl(file);
        const dims = await probeImage(url);
        dispatch({ type: 'REPLACE_IMAGE', id, image: { name: file.name, url, width: dims.width, height: dims.height, sizeKb: Math.round(file.size / 1024), quality: { score: estimateQuality(file), label: '清晰', issues: [] }, regions: [] } });
        return true;
      } catch {
        toast('error', '替换图片失败，请重新选择图片');
        return false;
      }
    };
    const pauseAnalysis = () => { if (runRef.current) { runRef.current.paused = true; dispatch({ type: 'ANALYZE_PAUSE' }); } };
    const resumeAnalysis = () => { if (runRef.current) { runRef.current.paused = false; dispatch({ type: 'ANALYZE_RESUME' }); } };

    const retryAnalysis = async () => {
      dispatch({ type: 'ANALYZE_RETRYING' });
      const scenario = state.scenarioChoice === 'failed' ? 'success' : (state.analysis?.scenario ?? 'auto');
      await startAnalysis(scenario === 'failed' ? 'success' : scenario);
    };

    /* ---------- 示例 ---------- */
    const loadDemoShots = () => {
      const imgs = PROC_SHOTS.map((s) => ({ ...s, uploadedAt: Date.now() }));
      const result = mapDemoResult(PROCUREMENT_RESULT, imgs);
      dispatch({
        type: 'LOAD_DEMO',
        demo: { images: imgs, result },
        directToResults: false,
      });
    };
    const loadDemoResult = () => {
      const imgs = PROC_SHOTS.map((s) => ({ ...s, uploadedAt: Date.now() }));
      const result = mapDemoResult(PROCUREMENT_RESULT, imgs);
      dispatch({ type: 'LOAD_DEMO', demo: { images: imgs, result }, directToResults: true });
      toast('info', '已载入示例结果(部分成功 · 含冲突警告)');
    };

    /* ---------- 服务端数据刷新(重连/多标签同步后) ---------- */
    const refreshServerData = async () => {
      if (!isServer()) return;
      try {
        const data = await serverApi.bootstrap();
        dispatch({ type: 'SYNC_SET', folders: data.folders, history: data.history, urgentTasks: data.tasks, archives: data.archives });
      } catch {
        /* 离线:保持缓存 */
      }
    };

    /* ---------- 保存 ---------- */
    const folderNameOf = (id) => state.folders.find((folder) => folder.id === id)?.name;

    /* 收集图幅元数据(未上传的 data URL 先上传) */
    const collectImagesForSave = async () => {
      const images = [];
      for (const i of state.images) {
        if (i.url && i.url.startsWith('data:')) {
          const blob = await dataUrlToBlob(i.url);
          const up = await uploadImageFile(new File([blob], i.name || 'screenshot.png', { type: blob.type || 'image/png' }), () => {});
          images.push({ id: up.id, name: i.name, width: up.width, height: up.height, sizeKb: up.sizeKb, legendIndex: i.legendIndex, quality: i.quality, regions: i.regions });
        } else if (i.url) {
          images.push({ id: i.id, name: i.name, width: i.width, height: i.height, sizeKb: i.sizeKb, legendIndex: i.legendIndex, quality: i.quality, regions: i.regions });
        } else {
          images.push({ id: null, name: i.name, width: i.width, height: i.height, sizeKb: i.sizeKb, legendIndex: i.legendIndex, quality: i.quality, regions: i.regions });
        }
      }
      return images;
    };

    const saveResult = async (folderId = state.currentFolderId, silent = false) => {
      if (isServer()) {
        try {
          const images = await collectImagesForSave();
          const title = (state.analysis?.result?.summary?.oneLiner?.text || '截图分析结果').slice(0, 60);
          const result = state.analysis?.result;
          if (!result) { toast('warn', '暂无可保存的分析结果'); return; }
          let record;
          if (state.loadedRecordId) {
            // 编辑已有记录 → PATCH,任务修改真正关联原始分析记录
            record = await serverApi.records.update(state.loadedRecordId, { title, folderId, images, result });
          } else {
            record = await serverApi.records.create({ title, folderId, images, result, savedAt: Date.now() });
          }
          dispatch({
            type: 'SAVE_RESULT',
            recordId: record.id,
            savedAt: record.savedAt,
            images: record.images,
            folderId: record.folderId,
            title: record.title,
            result: record.result,
          });
          await refreshServerData();
          broadcastSync('records');
          if (!silent) toast('ok', `已保存至文件夹「${folderNameOf(record.folderId) || '未整理'}」`);
        } catch (err) {
          toast('error', friendlyMessage(err));
        }
        return;
      }
      /* 本地模式(旧版逻辑) */
      const savedAt = Date.now();
      const images = state.images.map((i) => ({
        id: i.id, name: i.name, url: i.url && i.url.startsWith('data:') ? i.url : null,
        width: i.width, height: i.height, sizeKb: i.sizeKb, legendIndex: i.legendIndex, quality: i.quality, regions: i.regions,
      }));
      const payload = { savedAt, images, result: state.analysis.result };
      dispatch({
        type: 'SAVE_RESULT',
        savedAt, images, folderId, title: state.analysis.result.summary?.oneLiner?.text || '截图分析结果',
        result: state.analysis.result,
      });
      const folderName = state.folders.find((folder) => folder.id === folderId)?.name;
      if (!silent) toast('ok', folderName ? `已保存至文件夹「${folderName}」` : '已保存');
    };
    const saveCurrent = async () => {
      await saveResult(state.currentFolderId, true);
      toast('ok', '修改已保存');
    };

    const chooseRepository = () => {
      if (isServer()) { toast('info', '云端模式已按账号独立存储,无需切换仓库'); return; }
      const next = state.repositoryName === '我的在线仓库' ? '产品调研仓库' : '我的在线仓库';
      localStorage.setItem('snaptask.repository', JSON.stringify(next));
      dispatch({ type: 'REPOSITORY_SET', name: next });
      toast('ok', `已切换在线仓库「${next}」`);
    };

    /* ---------- 文件夹 ---------- */
    const createFolder = async (name) => {
      const clean = name.trim();
      if (!clean) return toast('warn', '请输入文件夹名称');
      if (state.folders.some((folder) => folder.name === clean)) return toast('warn', '文件夹名称已存在');
      if (isServer()) {
        try {
          const folder = await serverApi.folders.create(clean);
          dispatch({ type: 'FOLDER_CREATE', folder });
          broadcastSync('folders');
          toast('ok', `已创建文件夹「${clean}」`);
          return folder.id;
        } catch (err) {
          toast('error', friendlyMessage(err));
          return null;
        }
      }
      const id = uid('folder');
      dispatch({ type: 'FOLDER_CREATE', folder: { id, name: clean, parentId: null } });
      toast('ok', `已创建文件夹「${clean}」`);
      return id;
    };
    const renameFolder = async (id, name) => {
      const clean = name.trim();
      if (!clean) return toast('warn', '请输入文件夹名称');
      if (state.folders.some((folder) => folder.id !== id && folder.name === clean)) return toast('warn', '文件夹名称已存在');
      if (isServer()) {
        try {
          await serverApi.folders.rename(id, clean);
          dispatch({ type: 'FOLDER_RENAME', id, name: clean });
          broadcastSync('folders');
          toast('ok', '文件夹名称已更新');
        } catch (err) {
          toast('error', friendlyMessage(err));
        }
        return;
      }
      dispatch({ type: 'FOLDER_RENAME', id, name: clean });
      toast('ok', '文件夹名称已更新');
    };
    const deleteFolder = (id) => {
      if (id === 'folder-inbox') return toast('warn', '默认文件夹不能删除');
      const count = state.history.filter((item) => item.folderId === id && !item.isDeleted).length;
      const doDelete = async () => {
        if (isServer()) {
          try {
            await serverApi.folders.remove(id);
            dispatch({ type: 'FOLDER_DELETE', id });
            await refreshServerData();
            broadcastSync('folders');
            toast('ok', count ? `文件夹已删除，${count} 条记录已移入未整理` : '空文件夹已删除');
          } catch (err) {
            toast('error', friendlyMessage(err));
          }
          return;
        }
        dispatch({ type: 'FOLDER_DELETE', id });
        toast('ok', count ? `文件夹已删除，${count} 条记录已移入未整理` : '空文件夹已删除');
      };
      confirmThen({ title: '删除文件夹?', body: count ? `该文件夹下有 ${count} 条记录，删除文件夹后，这些记录将被移入“未整理”，确认删除？` : '确认删除该空文件夹？', confirmLabel: '删除文件夹', danger: true }, doDelete);
    };
    const moveRecordCore = async (id, folderId) => {
      if (isServer()) {
        await serverApi.records.update(id, { folderId });
        dispatch({ type: 'RECORD_MOVE', id, folderId });
        return;
      }
      dispatch({ type: 'RECORD_MOVE', id, folderId });
    };
    const moveRecord = async (id, folderId) => {
      try {
        await moveRecordCore(id, folderId);
        broadcastSync('records');
        toast('ok', '记录已移动');
      } catch (err) {
        toast('error', friendlyMessage(err));
      }
    };
    /* 批量移动(单次确认外的批量逻辑:逐条落库,最后统一广播) */
    const batchMoveRecords = async (ids, folderId) => {
      try {
        for (const id of ids) await moveRecordCore(id, folderId);
        broadcastSync('records');
        toast('ok', `已移动 ${ids.length} 条记录`);
      } catch (err) {
        toast('error', friendlyMessage(err));
      }
    };
    /* 删除核心(不带确认,供单条与批量共用) */
    const removeRecordCore = async (id) => {
      if (isServer()) {
        await serverApi.records.softDelete(id);
        dispatch({ type: 'SOFT_DELETE_RECORD', id });
        return;
      }
      dispatch({ type: 'SOFT_DELETE_RECORD', id });
    };
    const deleteRecord = (id) => {
      const doDelete = async () => {
        try {
          await removeRecordCore(id);
          broadcastSync('records');
          toast('ok', '已移入回收站');
        } catch (err) {
          toast('error', friendlyMessage(err));
        }
      };
      confirmThen({ title: '删除该记录?', body: '确认删除后,记录将移入回收站,可在回收站恢复;回收站中的记录 30 天后自动彻底清除。', confirmLabel: '删除', danger: true }, doDelete);
    };
    /* 批量删除:一次确认,逐条落库,最后统一广播 */
    const batchDeleteRecords = (ids) => {
      const doDelete = async () => {
        let ok = 0;
        for (const id of ids) {
          try {
            await removeRecordCore(id);
            ok += 1;
          } catch {
            /* 单条失败已提示 */
          }
        }
        broadcastSync('records');
        toast(ok === ids.length ? 'ok' : 'warn', `已删除 ${ok}/${ids.length} 条记录`);
      };
      confirmThen({ title: `批量删除 ${ids.length} 条记录?`, body: '确认删除后,记录将移入回收站,可在回收站恢复;回收站中的记录 30 天后自动彻底清除。', confirmLabel: '删除', danger: true }, doDelete);
    };
    const restoreRecord = async (id) => {
      if (isServer()) {
        try {
          await serverApi.records.restore(id);
          dispatch({ type: 'RESTORE_RECORD', id });
          await refreshServerData();
          broadcastSync('records');
          toast('ok', '已恢复');
        } catch (err) {
          toast('error', friendlyMessage(err));
        }
        return;
      }
      dispatch({ type: 'RESTORE_RECORD', id });
      toast('ok', '已恢复');
    };
    const hardDeleteRecord = (id) => {
      const doDelete = async () => {
        if (isServer()) {
          try {
            await serverApi.records.hardDelete(id);
            dispatch({ type: 'HARD_DELETE_RECORD', id });
            broadcastSync('records');
            toast('ok', '记录已彻底删除');
          } catch (err) {
            toast('error', friendlyMessage(err));
          }
          return;
        }
        dispatch({ type: 'HARD_DELETE_RECORD', id });
        toast('ok', '记录已彻底删除');
      };
      confirmThen({ title: '彻底删除分析记录?', body: '彻底删除后无法恢复，确认删除？', confirmLabel: '彻底删除', danger: true }, doDelete);
    };

    /* ---------- 待办 ---------- */
    const syncTasks = async (tasks) => {
      if (isServer()) {
        try {
          const payload = tasks.map((task) => ({
            id: task.id, title: task.title, description: task.description || '', assignee: task.assignee ?? null,
            dueDate: task.dueDate ?? null, priority: task.priority || 'medium', status: task.status || (task.done ? 'done' : 'todo'),
            done: !!task.done, source: '结果页',
          }));
          const res = await serverApi.tasks.sync(payload);
          dispatch({ type: 'URGENT_TASKS_SET', tasks: res.items });
          broadcastSync('tasks');
          toast('ok', `已同步 ${tasks.filter((task) => !task.done).length} 项待办到首页`);
        } catch (err) {
          toast('error', friendlyMessage(err));
        }
        return;
      }
      const next = [...state.urgentTasks];
      tasks.filter((task) => !task.done).forEach((task) => {
        if (!next.some((item) => item.id === task.id)) next.push({ ...task, source: '结果页' });
      });
      dispatch({ type: 'URGENT_TASKS_SET', tasks: next });
      toast('ok', `已同步 ${tasks.filter((task) => !task.done).length} 项待办到首页`);
    };
    const addUrgentTask = async (title) => {
      const clean = title.trim();
      if (!clean) return toast('warn', '请输入待办名称');
      if (isServer()) {
        try {
          const task = await serverApi.tasks.add({ title: clean, description: '', assignee: null, dueDate: null, priority: 'medium', status: 'todo', done: false, src: [], source: '首页' });
          dispatch({ type: 'URGENT_TASK_ADD', task });
          broadcastSync('tasks');
          toast('ok', '待办已添加');
        } catch (err) {
          toast('error', friendlyMessage(err));
        }
        return;
      }
      dispatch({ type: 'URGENT_TASK_ADD', task: { id: uid('urgent'), title: clean, description: '', assignee: null, dueDate: null, priority: 'medium', status: 'todo', done: false, src: [], source: '首页' } });
      toast('ok', '待办已添加');
    };
    const updateUrgentTask = async (id, patch) => {
      if (isServer()) {
        try {
          await serverApi.tasks.update(id, patch);
          dispatch({ type: 'URGENT_TASK_UPDATE', id, patch });
          broadcastSync('tasks');
        } catch (err) {
          toast('error', friendlyMessage(err));
        }
        return;
      }
      dispatch({ type: 'URGENT_TASK_UPDATE', id, patch });
    };
    const removeUrgentTask = async (id) => {
      if (isServer()) {
        try {
          await serverApi.tasks.remove(id);
          dispatch({ type: 'URGENT_TASK_DELETE', id });
          broadcastSync('tasks');
          toast('ok', '待办已删除');
        } catch (err) {
          toast('error', friendlyMessage(err));
        }
        return;
      }
      dispatch({ type: 'URGENT_TASK_DELETE', id });
      toast('ok', '待办已删除');
    };
    /* 首页“已完成淡出”:本地仅移除展示;云端任务已持久化为 done */
    const dismissUrgentTask = (id) => dispatch({ type: 'URGENT_TASKS_SET', tasks: state.urgentTasks.filter((task) => task.id !== id) });

    /* ---------- 归档 ---------- */
    const addArchive = async (archive) => {
      const base = { ...archive, id: uid('archive'), createdAt: Date.now() };
      if (isServer()) {
        try {
          const content = archive.content || '';
          const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
          const file = new File([blob], `${(archive.title || '导出结果').slice(0, 40)}.txt`, { type: 'text/plain' });
          const saved = await serverApi.archives.addFile(file, { title: archive.title, note: archive.taskName || '' });
          dispatch({ type: 'ARCHIVE_ADD', archive: { ...base, id: saved.id, title: saved.title, format: 'TXT', content, createdAt: saved.createdAt, downloadUrl: saved.downloadUrl } });
          broadcastSync('archives');
          toast('ok', '已保存到云端归档');
        } catch (err) {
          toast('error', friendlyMessage(err));
        }
        return;
      }
      dispatch({ type: 'ARCHIVE_ADD', archive: base });
    };
    const deleteArchive = (id) => {
      const doDelete = async () => {
        if (isServer()) {
          try {
            await serverApi.archives.remove(id);
            dispatch({ type: 'ARCHIVE_DELETE', id });
            broadcastSync('archives');
            toast('ok', '归档文件已删除');
          } catch (err) {
            toast('error', friendlyMessage(err));
          }
          return;
        }
        dispatch({ type: 'ARCHIVE_DELETE', id });
        toast('ok', '归档文件已删除');
      };
      confirmThen({ title: '删除归档文件?', body: '确认从归档中删除该文件？', confirmLabel: '删除', danger: true }, doDelete);
    };
    const renameArchive = async (id, title) => {
      const clean = title.trim();
      if (!clean) return toast('warn', '文件名不能为空');
      if (isServer()) {
        try {
          await serverApi.archives.rename(id, { title: clean });
          dispatch({ type: 'ARCHIVE_RENAME', id, title: clean });
          broadcastSync('archives');
          toast('ok', '已重命名');
        } catch (err) {
          toast('error', friendlyMessage(err));
        }
        return;
      }
      dispatch({ type: 'ARCHIVE_RENAME', id, title: clean });
      toast('ok', '已重命名');
    };

    /* ---------- 账号 ---------- */
    const signIn = async (payload) => {
      // 一次认证操作只允许留下本次结果,避免上一轮注册/退出提示叠加。
      dispatch({ type: 'TOAST_CLEAR' });
      authTransitionRef.current = true;
      if (!isServer()) {
        const user = { name: payload.name?.trim() || '本地用户', email: payload.email?.trim() || 'demo@local' };
        localStorage.setItem(USER_KEY, JSON.stringify(user));
        dispatch({ type: 'AUTH_SET', user });
        authTransitionRef.current = false;
        authToast('ok', `欢迎回来，${user.name}`);
        return { ok: true };
      }
      try {
        const res = payload.isRegister
          ? await serverApi.auth.register(payload.name, payload.email, payload.password)
          : await serverApi.auth.login(payload.email, payload.password);
        setTokens(res);
        const data = await serverApi.bootstrap();
        dispatch({ type: 'SESSION_SET', user: res.user, folders: data.folders, history: data.history, urgentTasks: data.tasks, archives: data.archives });
        localStorage.removeItem(USER_KEY);
        authToast('ok', `欢迎回来，${res.user.name}`);
        return { ok: true };
      } catch (err) {
        // 登录页会展示可恢复的内联错误,这里不再额外创建 Toast。
        return { ok: false, error: err };
      } finally {
        authTransitionRef.current = false;
      }
    };
    const signOut = async () => {
      dispatch({ type: 'TOAST_CLEAR' });
      authTransitionRef.current = true;
      if (isServer()) {
        await serverApi.auth.logout();
        clearTokens();
        localStorage.removeItem(USER_KEY);
        dispatch({ type: 'SESSION_SET', user: null, folders: [], history: [], urgentTasks: [], archives: [] });
        broadcastSync('auth');
        authTransitionRef.current = false;
        authToast('info', '已退出登录');
        return;
      }
      localStorage.removeItem(USER_KEY);
      dispatch({ type: 'AUTH_SET', user: null });
      authTransitionRef.current = false;
      authToast('info', '已退出本地账号');
    };
    const loadHistory = async (id) => {
      if (isServer()) {
        try {
          const record = await serverApi.records.get(id);
          dispatch({ type: 'LOAD_SAVED', saved: { savedAt: record.savedAt, images: record.images, result: record.result }, recordId: record.id });
        } catch (err) {
          toast('error', friendlyMessage(err));
        }
        return;
      }
      dispatch({ type: 'LOAD_HISTORY', id });
    };

    const loadSavedResult = () => {
      if (!state.saved) return;
      dispatch({ type: 'LOAD_SAVED', saved: state.saved });
      toast('info', '已恢复上次保存的结果');
    };

    /* 账号设置:更新称呼 */
    const updateProfile = async (name) => {
      if (!isServer()) return { ok: false };
      try {
        const res = await serverApi.me.updateName(name);
        dispatch({ type: 'AUTH_SET', user: res.user });
        toast('ok', '称呼已更新');
        return { ok: true };
      } catch (err) {
        toast('error', friendlyMessage(err));
        return { ok: false, error: err };
      }
    };

    /* 路由守卫用:带脏数据确认的阶段切换 */
    const navigateTo = (stage) => {
      const cur = state.stage;
      if (stage === cur) return;
      const go = () => {
        if (stage === 'home') dispatch({ type: 'BACK_TO_HOME' });
        else if (stage === 'workspace') dispatch({ type: 'BACK_TO_WORKSPACE' });
      };
      if (stage === 'results') {
        if (state.analysis?.result) return; // 已在结果页
        go();
        return;
      }
      if (state.dirty && (stage === 'home' || stage === 'workspace')) {
        confirmThen(
          {
            title: stage === 'home' ? '返回上传首页?' : '返回工作区?',
            body: '当前有未保存的修改,返回后修改将丢失。',
            confirmLabel: '仍然返回',
            danger: true,
          },
          go
        );
      } else {
        go();
      }
    };

    const confirmThen = (confirm, fn) => {
      dispatch({ type: 'CONFIRM_SET', confirm });
      confirmActionRef.current = fn;
    };

    return {
      toast,
      refreshServerData,
      addFiles,
      restoreImage: (image) => dispatch({ type: 'ADD_IMAGE', image: { ...image, id: isServer() ? image.id : uid('img'), uploadedAt: Date.now() } }),
      addHistoryImages: (images) => dispatch({ type: 'ADD_IMAGES_BATCH', images }),
      replaceImage,
      removeImage: (id) => dispatch({ type: 'REMOVE_IMAGE', id }),
      moveImage: (id, dir) => dispatch({ type: 'MOVE_IMAGE', id, dir }),
      setCurrent: (id) => dispatch({ type: 'SET_CURRENT', id }),
      startAnalysis,
      cancelAnalysis,
      reanalyzeCurrent,
      pauseAnalysis,
      resumeAnalysis,
      retryAnalysis,
      backToWorkspace: () => {
        if (state.dirty) {
          confirmThen(
            {
              title: '返回工作区?',
              body: '当前有未保存的修改。返回后修改将丢失;也可以先点击「保存结果」。',
              confirmLabel: '仍然返回',
              danger: true,
            },
            () => dispatch({ type: 'BACK_TO_WORKSPACE' })
          );
        } else {
          dispatch({ type: 'BACK_TO_WORKSPACE' });
        }
      },
      backToHome: () => {
        if (state.dirty) {
          confirmThen(
            {
              title: '返回上传首页?',
              body: '当前有未保存的修改,返回后修改将丢失。',
              confirmLabel: '仍然返回',
              danger: true,
            },
            () => dispatch({ type: 'BACK_TO_HOME' })
          );
        } else {
          dispatch({ type: 'BACK_TO_HOME' });
        }
      },
      returnHome: () => dispatch({ type: 'BACK_TO_HOME' }),
      navigateTo,
      loadDemoShots,
      loadDemoResult,
      loadSavedResult,
      saveResult,
      saveCurrent,
      chooseRepository,
      createFolder,
      renameFolder,
      deleteFolder,
      moveRecord,
      batchMoveRecords,
      deleteRecord,
      batchDeleteRecords,
      updateProfile,
      syncTasks,
      removeUrgentTask,
      addUrgentTask,
      updateUrgentTask,
      dismissUrgentTask,
      addArchive,
      deleteArchive,
      renameArchive,
      restoreRecord,
      hardDeleteRecord,
      selectFolder: (id) => dispatch({ type: 'FOLDER_SET', id }),
      signIn,
      signOut,
      loadHistory,
      setScenario: (scenario) => dispatch({ type: 'SET_SCENARIO', scenario }),

      updateTask: (id, patch) => dispatch({ type: 'UPDATE_TASK', id, patch }),
      addTask: (task) => dispatch({ type: 'ADD_TASK', task }),
      deleteTask: (id) => dispatch({ type: 'DELETE_TASK', id }),
      toggleTask: (id) => dispatch({ type: 'TOGGLE_TASK', id }),
      updateFact: (id, patch) => dispatch({ type: 'UPDATE_FACT', id, patch }),
      updateCell: (rowId, dimId, patch) => dispatch({ type: 'UPDATE_CELL', rowId, dimId, patch }),
      addRow: (label) => dispatch({ type: 'ADD_ROW', label }),
      deleteRow: (id) => dispatch({ type: 'DELETE_ROW', id }),
      addColumn: (label) => dispatch({ type: 'ADD_COLUMN', label }),
      deleteColumn: (id) => dispatch({ type: 'DELETE_COLUMN', id }),
      resolveConflictTask: (id, value) => dispatch({ type: 'RESOLVE_CONFLICT_TASK', id, value }),
      dismissWarning: (id) => dispatch({ type: 'DISMISS_WARNING', id }),

      undo: () => dispatch({ type: 'UNDO' }),
      redo: () => dispatch({ type: 'REDO' }),

      dismissToast: (id) => dispatch({ type: 'TOAST_DISMISS', id }),
      clearToasts: () => dispatch({ type: 'TOAST_CLEAR' }),
      openSourceViewer: (payload) => dispatch({ type: 'OPEN_SOURCE_VIEWER', payload }),
      closeSourceViewer: () => dispatch({ type: 'CLOSE_SOURCE_VIEWER' }),
      flash: (id) => dispatch({ type: 'FLASH_SET', id }),
      clearFlash: () => dispatch({ type: 'FLASH_CLEAR' }),
      confirmThen,
      clearConfirm: () => dispatch({ type: 'CONFIRM_CLEAR' }),
    };
  }, [state.images, state.analysis, state.scenarioChoice, state.saved, state.user, state.repositoryHandle, state.repositoryName, state.history, state.folders, state.currentFolderId, state.mode, state.loadedRecordId, state.urgentTasks, state.archives]);

  /* 启动引导:探测模式 → server 模式尝试恢复会话并拉取数据 */
  useEffect(() => {
    if (!boot) return;
    let cancelled = false;
    (async () => {
      const mode = await detectMode();
      if (cancelled) return;
      dispatch({ type: 'MODE_SET', mode });
      if (mode === 'server') {
        const tokens = getTokens();
        if (tokens?.refreshToken) {
          try {
            const refreshed = await serverApi.auth.refresh();
            const data = await serverApi.bootstrap();
            if (!cancelled) {
              dispatch({ type: 'SESSION_SET', user: refreshed.user, folders: data.folders, history: data.history, urgentTasks: data.tasks, archives: data.archives });
            }
          } catch {
            clearTokens();
            if (!cancelled) dispatch({ type: 'SESSION_SET', user: null });
          }
        }
      }
      if (!cancelled) dispatch({ type: 'BOOT_DONE' });
      bootingRef.current = false;
    })();
    return () => {
      cancelled = true;
    };
  }, [boot]);

  /* 会话过期(任意请求刷新失败)→ 清登录态 */
  useEffect(
    () =>
      onSessionExpired(() => {
        clearTokens();
        dispatch({ type: 'AUTH_SET', user: null });
        // 已经退出或正在登录页时,不要把后台旧请求的 401 再显示成新的过期提示。
        if (!bootingRef.current && userRef.current && !authTransitionRef.current) {
          dispatch({ type: 'TOAST_REPLACE', toast: { kind: 'error', text: '登录已过期,请重新登录', timeout: 5000 } });
        }
      }),
    []
  );

  /* 多标签页同步 + 页面重新可见时重拉(断网恢复) */
  const refreshServerData = useCallback(async () => {
    if (getMode() !== 'server') return;
    try {
      const data = await serverApi.bootstrap();
      dispatch({ type: 'SYNC_SET', folders: data.folders, history: data.history, urgentTasks: data.tasks, archives: data.archives });
    } catch {
      /* 离线:保持缓存 */
    }
  }, []);

  useEffect(() => {
    const close = openSyncChannel((scope) => {
      if (scope === 'auth') {
        clearTokens();
        dispatch({ type: 'AUTH_SET', user: null });
      }
      refreshServerData();
    });
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshServerData();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      close();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshServerData]);

  const runConfirm = useCallback(() => {
    if (confirmActionRef.current) {
      confirmActionRef.current();
      confirmActionRef.current = null;
    }
  }, []);

  const value = useMemo(() => ({ state, actions, runConfirm }), [state, actions, runConfirm]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

/* ---------- helpers ---------- */

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('read-failed'));
    reader.readAsDataURL(file);
  });
}

function probeImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('broken'));
    img.src = dataUrl;
  });
}

/* data URL → Blob(SVG 栅格化为 PNG,与服务端上传白名单一致) */
async function dataUrlToBlob(dataUrl) {
  if (dataUrl.startsWith('data:image/svg')) {
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
  const res = await fetch(dataUrl);
  if (!res.ok) throw new Error('image-load-failed');
  return res.blob();
}

function nextLegendIndex(images, offset) {
  const used = new Set(images.map((i) => i.legendIndex));
  let n = 1;
  while (used.has(n) || n <= offset) n += 1;
  return n;
}

function rejectLabel(reason) {
  switch (reason) {
    case 'format':
      return '格式不支持';
    case 'size':
      return '超过 10MB';
    case 'count':
      return `超过 ${MAX_IMAGES} 张上限`;
    case 'broken':
      return '图片损坏或无法读取';
    default:
      return '未通过校验';
  }
}

/* 示例场景:把数据里的 src 序号映射为示例图 id */
function mapDemoResult(result, images) {
  const byIndex = (n) => (images[n - 1] ? images[n - 1].id : null);
  const mapSrc = (src = []) => src.map(byIndex).filter(Boolean);
  const mapItem = (it) => ({ ...it, src: mapSrc(it.src) });
  const mapped = {
    scenario: result.scenario,
    scene_type: result.scene_type || (result.comparison ? 'COMPARISON' : 'TASK'),
    content_tags: result.content_tags || null,
    summary: {
      oneLiner: mapItem(result.summary.oneLiner),
      facts: result.summary.facts.map(mapItem),
      inferences: result.summary.inferences.map(mapItem),
      suggestions: result.summary.suggestions.map(mapItem),
    },
    facts: result.facts.map((f) => ({ ...mapItem(f), src: mapSrc(f.src) })),
    keyFacts: result.keyFacts.map(mapItem),
    tasks: result.tasks.map((t) => {
      const dueDate =
        t.dueDate && t.dueDate.conflict
          ? { conflict: true, values: t.dueDate.values.map((v) => ({ value: v.value, src: mapSrc(v.src) })) }
          : t.dueDate;
      return { ...mapItem(t), dueDate };
    }),
    comparison: {
      ...result.comparison,
      rows: result.comparison.rows.map((r) => ({
        ...r,
        cells: Object.fromEntries(
          Object.entries(r.cells).map(([dimId, cell]) => {
            if (cell.conflict) {
              return [dimId, { ...cell, conflict: true, values: cell.values.map((v) => ({ value: v.value, src: mapSrc(v.src) })) }];
            }
            return [dimId, { ...cell, src: mapSrc(cell.src) }];
          })
        ),
      })),
    },
    warnings: result.warnings.map((w) => ({ ...w, src: mapSrc(w.src) })),
  };
  return mapped;
}
