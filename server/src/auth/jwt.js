/* ============================================================
   令牌体系:
   - access:HS256 JWT,短寿(15 分钟)
   - refresh:48 字节随机不透明令牌,sha256 落库,30 天,轮换 + 复用检测
     复用已轮换的 refresh → 视为泄露 → 撤销整个令牌家族。
   ============================================================ */

import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { now, tx } from '../db.js';
import { unauthorized, forbidden } from '../errors.js';

function sha256(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/* ---------- access ---------- */

export function signAccessToken(secret, userId, ttlSec) {
  return jwt.sign({ sub: userId, typ: 'access' }, secret, { expiresIn: ttlSec });
}

export function verifyAccessToken(secret, token) {
  try {
    const payload = jwt.verify(token, secret);
    if (payload.typ !== 'access' || !payload.sub) throw new Error('bad payload');
    return { userId: payload.sub, expired: false };
  } catch (err) {
    if (err?.name === 'TokenExpiredError') return { userId: null, expired: true };
    return { userId: null, expired: false };
  }
}

/* ---------- 图片访问签名令牌 ----------
   <img> 标签无法携带 Authorization 头,因此图片 URL 带短时签名:
   /api/uploads/:id/content?token=<jwt>
   校验:签名有效 + typ=image + img 与路径一致 + sub 与资源属主一致。 */

export function signImageToken(secret, userId, uploadId, ttlSec) {
  // ttlSec 未配置时兜底 24 小时(测试环境 config 可能不含该键)
  return jwt.sign({ sub: userId, typ: 'image', img: uploadId }, secret, { expiresIn: ttlSec || 86400 });
}

export function verifyImageToken(secret, token, uploadId, userId) {
  try {
    const payload = jwt.verify(token, secret);
    if (payload.typ !== 'image') return false;
    if (payload.img !== uploadId) return false;
    if (payload.sub !== userId) return false;
    return true;
  } catch {
    return false;
  }
}

/* ---------- refresh ---------- */

export function issueRefreshToken(db, userId, ttlDays) {
  const id = crypto.randomUUID();
  const raw = crypto.randomBytes(48).toString('base64url');
  const expiresAt = now() + ttlDays * 24 * 3600 * 1000;
  db.prepare(
    'INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, created_at, expires_at) VALUES (?,?,?,?,?,?)'
  ).run(id, userId, id, sha256(raw), now(), expiresAt);
  return { token: raw, id };
}

/* 轮换:验证 + 作废旧令牌 + 签发新令牌(同家族)。
   返回 null 表示无效;抛 forbidden 表示检测到复用(家族整体撤销)。 */
export function rotateRefreshToken(db, rawToken, ttlDays) {
  const hash = sha256(rawToken);
  const row = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(hash);
  if (!row) throw unauthorized('REFRESH_INVALID', '刷新令牌无效');

  if (row.revoked_at) {
    // 已被「轮换」过的令牌再次出现 = 疑似泄露 → 撤销整个家族
    if (row.revoked_reason === 'rotated') {
      db.prepare(
        "UPDATE refresh_tokens SET revoked_at = ?, revoked_reason = 'reuse' WHERE family_id = ? AND revoked_at IS NULL"
      ).run(now(), row.family_id);
      throw forbidden('REFRESH_REUSE', '检测到刷新令牌被重复使用,已撤销该登录会话,请重新登录');
    }
    // 登出/改密/注销后撤销的令牌 → 视为无效
    throw unauthorized('REFRESH_INVALID', '刷新令牌已失效,请重新登录');
  }
  if (row.expires_at < now()) throw unauthorized('REFRESH_EXPIRED', '登录已过期,请重新登录');

  const nextId = crypto.randomUUID();
  const nextRaw = crypto.randomBytes(48).toString('base64url');
  const nextExpires = now() + ttlDays * 24 * 3600 * 1000;
  tx(db, () => {
    db.prepare(
      "UPDATE refresh_tokens SET revoked_at = ?, replaced_by = ?, revoked_reason = 'rotated' WHERE id = ?"
    ).run(now(), nextId, row.id);
    db.prepare(
      'INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, created_at, expires_at) VALUES (?,?,?,?,?,?)'
    ).run(nextId, row.user_id, row.family_id, sha256(nextRaw), now(), nextExpires);
  });
  return { token: nextRaw, id: nextId, userId: row.user_id };
}

/* 登出:撤销指定令牌 */
export function revokeRefreshToken(db, rawToken) {
  const hash = sha256(rawToken);
  db.prepare(
    "UPDATE refresh_tokens SET revoked_at = ?, revoked_reason = 'logout' WHERE token_hash = ? AND revoked_at IS NULL"
  ).run(now(), hash);
}

/* 撤销用户全部会话(改密码/注销) */
export function revokeAllForUser(db, userId) {
  db.prepare(
    "UPDATE refresh_tokens SET revoked_at = ?, revoked_reason = 'security' WHERE user_id = ? AND revoked_at IS NULL"
  ).run(now(), userId);
}
