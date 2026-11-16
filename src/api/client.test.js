/* API 客户端:令牌附加、401 单飞刷新重试、错误归一化、离线错误、会话过期事件 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiRequest, setTokens, clearTokens, onSessionExpired, ApiError, OfflineError, SessionExpiredError } from './client.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('apiRequest', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearTokens();
  });

  it('附加 Authorization 头并序列化 JSON body', async () => {
    setTokens({ accessToken: 'acc-1', refreshToken: 'ref-1' });
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const res = await apiRequest('/api/folders', { method: 'POST', body: { name: '工作' } });
    expect(res).toEqual({ ok: true });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/folders');
    expect(opts.headers.Authorization).toBe('Bearer acc-1');
    expect(JSON.parse(opts.body)).toEqual({ name: '工作' });
  });

  it('401 TOKEN_EXPIRED → 单飞刷新并重试(并发请求只刷新一次)', async () => {
    setTokens({ accessToken: 'expired', refreshToken: 'ref-1' });
    let refreshCalls = 0;
    fetchMock.mockImplementation(async (url, opts) => {
      if (String(url).includes('/api/auth/refresh')) {
        refreshCalls += 1;
        await sleep(20);
        return jsonResponse({ accessToken: 'acc-new', refreshToken: 'ref-2' });
      }
      if (opts.headers?.Authorization === 'Bearer acc-new') return jsonResponse({ data: 'ok' });
      return jsonResponse({ error: { code: 'TOKEN_EXPIRED', message: '登录已过期' } }, 401);
    });
    const [a, b] = await Promise.all([apiRequest('/api/a'), apiRequest('/api/b')]);
    expect(a).toEqual({ data: 'ok' });
    expect(b).toEqual({ data: 'ok' });
    expect(refreshCalls).toBe(1);
  });

  it('刷新失败 → 触发会话过期事件并抛 SessionExpiredError', async () => {
    setTokens({ accessToken: 'expired', refreshToken: 'ref-dead' });
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('/api/auth/refresh')) return jsonResponse({ error: { code: 'REFRESH_INVALID', message: '刷新令牌无效' } }, 401);
      return jsonResponse({ error: { code: 'TOKEN_EXPIRED', message: '登录已过期' } }, 401);
    });
    const expired = vi.fn();
    const off = onSessionExpired(expired);
    await expect(apiRequest('/api/a')).rejects.toBeInstanceOf(SessionExpiredError);
    expect(expired).toHaveBeenCalledTimes(1);
    off();
  });

  it('业务错误 → ApiError 带 code 与 detail', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'EMAIL_TAKEN', message: '该邮箱已注册', detail: { email: 'x@x.com' } } }, 409)
    );
    const err = await apiRequest('/api/auth/register', { method: 'POST', body: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.code).toBe('EMAIL_TAKEN');
  });

  it('网络失败 → OfflineError', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await apiRequest('/api/health').catch((e) => e);
    expect(err).toBeInstanceOf(OfflineError);
  });
});
