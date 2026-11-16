/* ============================================================
   视觉理解模型适配层(OpenAI 兼容协议,覆盖 zhipu / siliconflow / ollama / openai)。
   统一输入: images[{mime, buffer}] + prompt → 文本输出(期望 JSON)。
   错误分类:RetryableError(429/5xx/超时/网络)自动退避重试;4xx 鉴权/参数不重试。
   ============================================================ */

import { AppError, tooMany } from '../errors.js';
import { RetryableError, retryable, withRetry, parseRetryAfter, dataUrlFor } from './util.js';
import { usageBump } from '../db.js';
import { VISION_PROVIDER_DEFAULTS } from '../config.js';

function classifyHttpError(status, body, headers) {
  const text = typeof body === 'string' ? body : JSON.stringify(body || {});
  if (status === 429 || /rate.?limit|quota|限流|超限/i.test(text)) {
    return retryable('RATE_LIMITED', 'AI 服务限流或配额不足,请稍后重试', parseRetryAfter(headers.get('retry-after')), 429);
  }
  if (status === 401 || status === 403) {
    return new AppError(502, 'VISION_AUTH_FAILED', 'AI 服务鉴权失败,请检查 VISION_API_KEY');
  }
  if (status === 400) {
    const msg = body?.error?.message || body?.message || '请求参数错误(可能包含不支持的图片)';
    return new AppError(400, 'VISION_BAD_REQUEST', msg);
  }
  return retryable('VISION_PROVIDER_ERROR', `AI 服务错误(HTTP ${status}):${String(text).slice(0, 300)}`);
}

function createVisionCore(config, logger) {
  const defaults = VISION_PROVIDER_DEFAULTS[config.vision.provider] || VISION_PROVIDER_DEFAULTS.zhipu;
  const baseUrl = (config.vision.baseUrl || defaults.baseUrl).replace(/\/$/, '');
  const model = config.vision.model || defaults.model;
  const apiKey = config.vision.apiKey;
  const provider = config.vision.provider;

  return {
    provider,
    model,
    async complete({ images, prompt, maxTokens }) {
      // max_tokens 必须落在模型允许范围内;GLM-4V-Flash 为 [1,1024]
      // (默认取 VISION_MAX_TOKENS,换用上限更高的模型时可调大)
      const maxTokensSafe = Math.max(1, Math.min(maxTokens || config.vision.maxTokens || 1024, 8192));
      if (provider !== 'ollama' && !apiKey) {
        throw new AppError(
          500,
          'VISION_NOT_CONFIGURED',
          '未配置 VISION_API_KEY。免费方案见 docs/COSTS.md(默认:智谱 GLM-4V-Flash)'
        );
      }
      const content = [
        { type: 'text', text: prompt },
        ...images.map((img) => ({
          type: 'image_url',
          image_url: { url: dataUrlFor(img.mime, img.buffer) },
        })),
      ];
      const headers = { 'Content-Type': 'application/json' };
      if (provider !== 'ollama') headers.Authorization = `Bearer ${apiKey}`;

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content }],
          temperature: 0.2,
          max_tokens: maxTokensSafe,
        }),
        signal: AbortSignal.timeout(config.vision.timeoutMs),
      });

      const rawText = await res.text();
      let data = null;
      try {
        data = JSON.parse(rawText);
      } catch {
        data = { raw: rawText.slice(0, 500) };
      }
      if (!res.ok) throw classifyHttpError(res.status, data, res.headers);
      const contentOut = data?.choices?.[0]?.message?.content;
      if (!contentOut) throw retryable('VISION_BAD_RESPONSE', 'AI 服务未返回有效内容');
      return contentOut;
    },
  };
}

export function createVision(config, db, logger) {
  const core = createVisionCore(config, logger);
  const limit = config.vision.dailyLimit;

  return {
    provider: core.provider,
    model: core.model,
    async complete({ images, prompt, maxTokens, userId }) {
      if (db && userId && limit > 0) {
        const usage = usageBump(db, userId, 'vision', limit);
        if (!usage.ok) {
          throw tooMany('QUOTA_EXCEEDED', `今日 AI 分析次数已达上限(${usage.limit}),请明天再试或调整服务端配额`);
        }
      }
      try {
        return await withRetry(() => core.complete({ images, prompt, maxTokens }), {
          retries: 2,
          baseMs: 1000,
          logger,
          label: `vision(${core.provider}/${core.model})`,
        });
      } catch (err) {
        if (err instanceof RetryableError || err instanceof AppError) throw err;
        // fetch 级网络错误(ECONNRESET / undici timeout 等)
        const name = err?.name || 'Error';
        if (name === 'AbortError' || name === 'TimeoutError') {
          throw retryable('VISION_TIMEOUT', `AI 服务响应超时(>${Math.round(config.vision.timeoutMs / 1000)}s)`);
        }
        throw retryable('VISION_NETWORK_ERROR', `AI 服务网络错误:${err.message}`);
      }
    },
  };
}
