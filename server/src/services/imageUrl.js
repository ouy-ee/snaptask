/* 图片签名 URL 生成(短时令牌,<img> 标签可直接使用,无需 Bearer 头) */

import { signImageToken } from '../auth/jwt.js';

export function imageContentUrl(ctx, userId, uploadId) {
  const ttlSec = (ctx.config.jwt && ctx.config.jwt.imageTtlSec) || 86400;
  const token = signImageToken(ctx.config.jwt.secret, userId, uploadId, ttlSec);
  return `/api/uploads/${uploadId}/content?token=${encodeURIComponent(token)}`;
}
