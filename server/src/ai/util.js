/* AI 调用通用工具:指数退避重试 + 限流等待 */

import { AppError } from '../errors.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class RetryableError extends AppError {
  constructor(status, code, message, retryAfterMs = null) {
    super(status, code, message);
    this.name = 'RetryableError';
    this.retryAfterMs = retryAfterMs;
  }
}

export const retryable = (code, message, retryAfterMs = null, status = 502) =>
  new RetryableError(status, code, message, retryAfterMs);

/* fn 抛 RetryableError 时指数退避重试;其他错误直接抛出 */
export async function withRetry(fn, { retries = 2, baseMs = 900, logger, label = 'call' } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof RetryableError) || attempt >= retries) throw err;
      attempt += 1;
      const wait = err.retryAfterMs ?? baseMs * 2 ** attempt + Math.floor(Math.random() * 300);
      logger?.warn({ attempt, wait, label, code: err.code }, 'AI 调用失败,等待重试');
      await sleep(wait);
    }
  }
}

/* 解析 Retry-After 头(秒或日期),失败返回 null */
export function parseRetryAfter(header) {
  if (!header) return null;
  const sec = Number(header);
  if (Number.isFinite(sec)) return sec * 1000;
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

/* 供视觉模型使用:截取 base64 图片 */
export function dataUrlFor(mime, buffer) {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}
