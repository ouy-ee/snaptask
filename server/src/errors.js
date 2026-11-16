/* ============================================================
   错误体系:AppError 携带 HTTP 状态 + 语义化错误码。
   响应统一格式: { error: { code, message, detail? } }
   ============================================================ */

export class AppError extends Error {
  constructor(status, code, message, detail = undefined, cause = undefined) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.detail = detail;
    if (cause) this.cause = cause;
  }

  toPayload() {
    return { error: { code: this.code, message: this.message, ...(this.detail !== undefined ? { detail: this.detail } : {}) } };
  }
}

export const badRequest = (code, message, detail) => new AppError(400, code, message, detail);
export const unauthorized = (code = 'UNAUTHORIZED', message = '未登录或登录已失效') => new AppError(401, code, message);
export const forbidden = (code = 'FORBIDDEN', message = '没有权限执行该操作') => new AppError(403, code, message);
export const notFound = (code = 'NOT_FOUND', message = '资源不存在') => new AppError(404, code, message);
export const conflict = (code, message, detail) => new AppError(409, code, message, detail);
export const tooMany = (code = 'RATE_LIMITED', message = '请求过于频繁,请稍后再试') => new AppError(429, code, message);

/* 外部服务错误(可恢复,前端允许重试) */
export const upstreamError = (code, message, detail) => new AppError(502, code, message, detail);

/* 断言助手 */
export function assert(condition, error) {
  if (!condition) throw error;
}
