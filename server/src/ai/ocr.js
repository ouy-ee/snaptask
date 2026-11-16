/* ============================================================
   OCR 适配层:
   - none   :不 OCR,视觉模型直接读图
   - baidu  :百度智能云 OCR(通用文字识别-高精度),每月免费额度见 docs/COSTS.md
   - paddle :自托管 PaddleOCR 服务(server/ocr/ 提供部署脚本),开源免费无限量
   统一返回: { lines: [{ text, confidence, box: {x,y,w,h}(归一化 0..1) }], fullText }
   ============================================================ */

import { AppError, upstreamError, tooMany } from '../errors.js';
import { RetryableError, retryable, withRetry, parseRetryAfter } from './util.js';
import { usageBump } from '../db.js';

/* 百度错误码 → 语义错误。17/18/19 = 配额/QPS 用尽(可等待重试)。 */
function baiduError(code, msg) {
  if (['17', '18', '19'].includes(String(code))) {
    return retryable('OCR_RATE_LIMITED', `百度 OCR 配额或并发受限:${msg}`, 2000);
  }
  if (String(code) === '4') return retryable('OCR_QUOTA_EXHAUSTED', `百度 OCR 调用量超限:${msg}`, 60000);
  if (String(code) === '110') return new AppError(400, 'OCR_BAD_IMAGE', `图片无法识别:${msg}`);
  if (String(code) === '111') return retryable('OCR_BAD_IMAGE', `图片格式错误:${msg}`, 1000);
  return upstreamError('OCR_PROVIDER_ERROR', `百度 OCR 返回错误 ${code}:${msg}`);
}

/* ---------------- 百度 ---------------- */

function createBaiduOcr(cfg, logger) {
  const { apiKey, secretKey } = cfg.baidu;
  const TOKEN_URL = 'https://aip.baidubce.com/oauth/2.0/token';
  const OCR_URL = 'https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic';
  let tokenCache = { token: null, expiresAt: 0 };

  async function getAccessToken() {
    if (tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token;
    const url = `${TOKEN_URL}?grant_type=client_credentials&client_id=${encodeURIComponent(apiKey)}&client_secret=${encodeURIComponent(secretKey)}`;
    const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw upstreamError('OCR_AUTH_FAILED', `百度 OCR 鉴权失败(HTTP ${res.status})`);
    const data = await res.json();
    if (!data.access_token) throw upstreamError('OCR_AUTH_FAILED', `百度 OCR 鉴权失败:${data.error_description || '无 access_token'}`);
    tokenCache = { token: data.access_token, expiresAt: Date.now() + ((data.expires_in || 2592000) - 120) * 1000 };
    return tokenCache.token;
  }

  async function recognize(buffer) {
    const token = await getAccessToken();
    const body = new URLSearchParams({
      image: buffer.toString('base64'),
      recognize_granularity: 'big',
    });
    const res = await fetch(`${OCR_URL}?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error_code) {
      const code = data.error_code || res.status;
      const msg = data.error_msg || `HTTP ${res.status}`;
      throw baiduError(code, msg);
    }
    return data;
  }

  return {
    provider: 'baidu',
    async recognize(buffer) {
      const data = await withRetry(() => recognize(buffer), {
        retries: 1,
        baseMs: 900,
        logger,
        label: 'baidu-ocr',
      });
      const words = data.words_result || [];
      const lines = words
        .filter((w) => w?.words)
        .map((w) => ({
          text: w.words,
          confidence: typeof w.probability?.average === 'number' ? w.probability.average : null,
          box: w.location
            ? { x: w.location.left, y: w.location.top, w: w.location.width, h: w.location.height }
            : null,
        }));
      return { lines, fullText: lines.map((l) => l.text).join('\n') };
    },
  };
}

/* ---------------- PaddleOCR 自托管 ---------------- */

function createPaddleOcr(cfg, logger) {
  const base = cfg.paddleUrl.replace(/\/$/, '');
  return {
    provider: 'paddle',
    async recognize(buffer) {
      const res = await fetch(`${base}/ocr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: [buffer.toString('base64')] }),
        signal: AbortSignal.timeout(60000),
      });
      if (res.status === 429) throw retryable('OCR_RATE_LIMITED', 'PaddleOCR 服务繁忙', parseRetryAfter(res.headers.get('retry-after')));
      if (!res.ok) throw retryable('OCR_PROVIDER_ERROR', `PaddleOCR 服务错误(HTTP ${res.status})`);
      const data = await res.json();
      const perImage = data?.results?.[0];
      if (!perImage) throw new AppError(502, 'OCR_BAD_RESPONSE', 'PaddleOCR 返回结构异常');
      if (perImage.error) throw new AppError(502, 'OCR_BAD_IMAGE', `PaddleOCR 识别失败:${perImage.error}`);
      const lines = (perImage.words || []).map((w) => {
        const box = w.box && Array.isArray(w.box) && w.box.length >= 4 ? w.box : null;
        return {
          text: w.text ?? '',
          confidence: typeof w.confidence === 'number' ? w.confidence : null,
          box,
        };
      });
      return { lines, fullText: lines.map((l) => l.text).join('\n') };
    },
  };
}

/* ---------------- 工厂 ---------------- */

export function createOcr(config, db, logger) {
  const core =
    config.ocr.provider === 'baidu'
      ? createBaiduOcr(config, logger)
      : config.ocr.provider === 'paddle'
        ? createPaddleOcr(config, logger)
        : null;

  const limit = config.ocr.dailyLimit;

  return {
    provider: config.ocr.provider,
    async recognize(buffer, userId) {
      if (!core) {
        return { lines: [], fullText: '', skipped: true };
      }
      if (db && userId && limit > 0) {
        const usage = usageBump(db, userId, 'ocr', limit);
        if (!usage.ok) {
          throw tooMany('QUOTA_EXCEEDED', `今日 OCR 调用次数已达上限(${usage.limit}),请明天再试或调整服务端配额`);
        }
      }
      try {
        const result = await core.recognize(buffer);
        // 归一化:百度返回像素坐标,由调用方按图片尺寸归一化;此处仅透传
        return result;
      } catch (err) {
        if (err instanceof RetryableError) throw err;
        if (err instanceof AppError) throw err;
        throw retryable('OCR_NETWORK_ERROR', `OCR 网络错误:${err.message}`);
      }
    },
  };
}

/* 像素框 → 归一化框(0..1) */
export function normalizeBox(box, width, height) {
  if (!box || !width || !height) return null;
  // Paddle 4 点框 → 外接矩形
  let x0 = 0;
  let y0 = 0;
  let x1 = 0;
  let y1 = 0;
  if (Array.isArray(box[0])) {
    const xs = box.map((p) => p[0]);
    const ys = box.map((p) => p[1]);
    x0 = Math.min(...xs);
    y0 = Math.min(...ys);
    x1 = Math.max(...xs);
    y1 = Math.max(...ys);
  } else if (typeof box.x === 'number') {
    x0 = box.x;
    y0 = box.y;
    x1 = box.x + box.w;
    y1 = box.y + box.h;
  } else {
    return null;
  }
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  return {
    x: clamp(x0 / width, 0, 1),
    y: clamp(y0 / height, 0, 1),
    w: clamp((x1 - x0) / width, 0, 1),
    h: clamp((y1 - y0) / height, 0, 1),
  };
}

/* OCR 结果 → 图幅质量评分(前端展示用) */
export function qualityFromOcr(lines) {
  const withConf = lines.filter((l) => typeof l.confidence === 'number');
  if (lines.length === 0) return { score: 80, label: '清晰', issues: [] };
  const mean = withConf.reduce((s, l) => s + l.confidence, 0) / Math.max(1, withConf.length);
  const score = Math.round(Math.min(99, Math.max(20, mean * 100)));
  const label = score >= 85 ? '清晰' : score >= 70 ? '一般' : '模糊';
  const issues = [];
  if (score < 70) issues.push('文字分辨率低');
  if (lines.length < 3) issues.push('识别到的文字较少');
  return { score, label, issues };
}
