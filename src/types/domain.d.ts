/**
 * SnapTask 统一数据模型类型声明(前端 JS 组件通过 JSDoc 引用,后续可平滑迁移 TS)。
 * 与后端 docs/ARCHITECTURE.md §2 及 server/src/ai/normalize.js 对齐。
 */

/** 图幅(工作区 / 记录中的截图) */
export interface ImageRef {
  /** 本地模式:客户端 uid;云端模式:服务端 uploadId */
  id: string;
  name: string;
  /** 本地:data URL;云端:鉴权接口地址 /api/uploads/:id/content */
  url: string | null;
  width: number;
  height: number;
  sizeKb: number;
  uploadedAt?: number;
  legendIndex: number;
  quality: ImageQuality;
  /** OCR 来源区域定位框(归一化坐标) */
  regions: SourceRegion[];
}

export interface ImageQuality {
  score: number; // 0-100
  label: '清晰' | '一般' | '模糊';
  issues: string[];
}

export interface SourceRegion {
  id: string;
  label: string;
  x: number; // 0-1 相对坐标
  y: number;
  w: number;
  h: number;
  note?: string;
}

/** 待办任务(结果内 / 首页待办) */
export interface Task {
  id: string;
  title: string;
  description: string;
  assignee: string | null;
  /** 日期字符串,或冲突结构(多处来源值不一致) */
  dueDate: string | null | ConflictDate;
  priority: 'high' | 'medium' | 'low';
  status: 'todo' | 'doing' | 'done';
  done: boolean;
  /** 来源图幅 id 数组 */
  src: string[];
  source?: string;
  recordId?: string;
}

export interface ConflictDate {
  conflict: true;
  values: { value: string; src: string[] }[];
}

/** 结构化事实 */
export interface Fact {
  id: string;
  label: string;
  value: string | null;
  confidence: number | null;
  status: 'identified' | 'uncertain' | 'not-mentioned';
  src: string[];
}

export interface KeyFact {
  id: string;
  text: string;
  confidence: number | null;
  status: 'identified' | 'uncertain' | 'not-mentioned';
  src: string[];
}

/** 对比表 */
export interface Comparison {
  id: string;
  title: string;
  dims: { id: string; label: string }[];
  rows: {
    id: string;
    label: string;
    cells: Record<string, ComparisonCell>;
  }[];
}

export type ComparisonCell =
  | { value: string | null; missing?: boolean; confidence?: number | null; status?: string; src: string[] }
  | { conflict: true; values: { value: string; src: string[] }[] };

/** 风险与警告 */
export interface Warning {
  id: string;
  type: 'conflict' | 'missing-assignee' | 'missing-due' | 'low-quality' | 'low-confidence' | 'duplicate' | string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  message: string;
  related: { kind: 'task' | 'fact' | 'image'; id: string; label: string };
  src: string[];
  actions: string[];
}

/** 分析结果(前端与后端 records.result 共用) */
export interface AnalysisResult {
  scenario: 'success' | 'partial' | 'failed' | 'saved';
  scene_type: 'TASK' | 'COMPARISON' | 'OTHER' | 'KNOWLEDGE';
  content_tags: string[] | null;
  summary: {
    oneLiner: { text: string; src: string[] };
    facts: { id: string; text: string; src: string[] }[];
    inferences: { id: string; text: string; src: string[] }[];
    suggestions: { id: string; text: string; src: string[] }[];
  };
  facts: Fact[];
  keyFacts: KeyFact[];
  tasks: Task[];
  comparison: Comparison;
  warnings: Warning[];
}

/** 分析任务快照(GET /api/analysis/:id) */
export interface AnalysisJob {
  jobId: string;
  status: 'queued' | 'processing' | 'success' | 'partial_success' | 'failed' | 'cancelled';
  stageIndex: number;
  stageLabel: string | null;
  processed: number;
  total: number;
  note: string | null;
  error: { code: string; title: string; detail?: string; recoverable: boolean } | null;
  result: AnalysisResult | null;
  scenario: string | null;
  images?: { id: string; regions: SourceRegion[]; quality: ImageQuality | null }[];
}

/** 历史记录列表项 */
export interface RecordSummary {
  id: string;
  title: string;
  folderId: string;
  imageCount: number;
  contentTags: string[];
  savedAt: number;
  version: number;
  isDeleted?: boolean;
  deletedAt?: number | null;
  saved?: { savedAt: number; images: ImageRef[]; result: AnalysisResult } | null;
  createdAt?: number;
  updatedAt?: number;
}

/** 文件夹 */
export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  recordCount?: number;
}

/** 归档条目 */
export interface ArchiveItem {
  id: string;
  title: string;
  format?: string;
  content?: string;
  note?: string;
  size?: number;
  originalName?: string;
  hasFile?: boolean;
  downloadUrl?: string | null;
  createdAt: number;
}

/** 用户 */
export interface User {
  id: string;
  name: string;
  email: string;
}
