/* ============================================================
   环境配置:zod 解析 + 默认值。所有外部输入(env)在此收敛。
   ============================================================ */

import path from 'node:path';
import { z } from 'zod';

/* 布尔开关:输入为 'true'/'false'/''(env 全字符串),输出 boolean。
   注意 .default 必须给合法枚举成员('false'),zod 会校验默认值。 */
const boolish = z
  .enum(['true', 'false', ''])
  .transform((v) => v === 'true')
  .default('false');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().default('8787'),
  HOST: z.string().default('0.0.0.0'),
  DATA_DIR: z.string().default('./data'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  JWT_SECRET: z.string().optional(),
  JWT_ACCESS_TTL: z.string().default('900'),
  JWT_REFRESH_TTL_DAYS: z.string().default('30'),
  /* 图片访问签名 URL 有效期(秒)。<img> 标签无法携带 Bearer 头,靠短时签名鉴权 */
  IMAGE_URL_TTL: z.string().default('86400'),

  RATE_LIMIT_WINDOW_MS: z.string().default('300000'),
  RATE_LIMIT_MAX: z.string().default('300'),
  AUTH_RATE_LIMIT_MAX: z.string().default('10'),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  MAX_UPLOAD_BYTES: z.string().default('10485760'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: boolish,
  S3_PRESIGN_TTL: z.string().default('900'),

  OCR_PROVIDER: z.enum(['none', 'baidu', 'paddle']).default('none'),
  BAIDU_OCR_API_KEY: z.string().optional(),
  BAIDU_OCR_SECRET_KEY: z.string().optional(),
  PADDLE_OCR_URL: z.string().default('http://localhost:8788'),
  OCR_DAILY_LIMIT: z.string().default('500'),

  VISION_PROVIDER: z.enum(['zhipu', 'siliconflow', 'ollama', 'openai']).default('zhipu'),
  VISION_API_KEY: z.string().optional(),
  VISION_BASE_URL: z.string().optional(),
  VISION_MODEL: z.string().optional(),
  VISION_TIMEOUT_MS: z.string().default('120000'),
  VISION_DAILY_LIMIT: z.string().default('100'),
  /* 单次输出最大 tokens。GLM-4V-Flash 上限 [1,1024],超出报「max_tokens参数非法」 */
  VISION_MAX_TOKENS: z.string().default('1024'),

  RECYCLE_RETENTION_DAYS: z.string().default('30'),
  ANALYSIS_CONCURRENCY: z.string().default('1'),
  ORPHAN_UPLOAD_TTL_HOURS: z.string().default('24'),
  /* 部署在 nginx 等反代之后时设 true,限流才能按真实 IP 计数 */
  TRUST_PROXY: boolish,
});

export function loadConfig(env = process.env) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // 拼出人类可读的错误(缺省值场景下基本不会发生)
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`环境变量配置错误: ${issues}`);
  }
  const raw = parsed.data;

  /* 占位符防护:模板中的 your_api_key_here 等一律视为未配置 */
  const PLACEHOLDER_KEYS = new Set(['your_api_key_here', 'your-api-key-here', 'changeme', 'change-me', 'xxx']);
  const cleanKey = (value) => {
    if (!value) return undefined;
    return PLACEHOLDER_KEYS.has(value.trim().toLowerCase()) ? undefined : value;
  };

  const isProd = raw.NODE_ENV === 'production';
  let jwtSecret = raw.JWT_SECRET;
  const jwtSecretMissing = !jwtSecret || jwtSecret.trim() === '';
  if (jwtSecretMissing) {
    if (isProd) {
      throw new Error('生产环境必须设置 JWT_SECRET(至少 32 位随机字符串)');
    }
    jwtSecret = 'dev-only-insecure-secret-change-me';
  }

  return {
    env: raw.NODE_ENV,
    isProd,
    port: parseInt(raw.PORT, 10),
    host: raw.HOST,
    dataDir: path.resolve(raw.DATA_DIR),
    dbPath: path.resolve(raw.DATA_DIR, 'snaptask.db'),
    uploadsDir: path.resolve(raw.DATA_DIR, 'uploads'),
    corsOrigin: raw.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean),
    logLevel: raw.LOG_LEVEL,

    jwt: {
      secret: jwtSecret,
      secretIsDefault: jwtSecretMissing,
      accessTtlSec: parseInt(raw.JWT_ACCESS_TTL, 10),
      refreshTtlDays: parseInt(raw.JWT_REFRESH_TTL_DAYS, 10),
      imageTtlSec: parseInt(raw.IMAGE_URL_TTL, 10),
    },
    rateLimit: {
      windowMs: parseInt(raw.RATE_LIMIT_WINDOW_MS, 10),
      max: parseInt(raw.RATE_LIMIT_MAX, 10),
      authMax: parseInt(raw.AUTH_RATE_LIMIT_MAX, 10),
    },
    storage: {
      driver: raw.STORAGE_DRIVER,
      maxUploadBytes: parseInt(raw.MAX_UPLOAD_BYTES, 10),
      s3: {
        endpoint: raw.S3_ENDPOINT,
        region: raw.S3_REGION,
        bucket: raw.S3_BUCKET,
        accessKeyId: raw.S3_ACCESS_KEY_ID,
        secretAccessKey: raw.S3_SECRET_ACCESS_KEY,
        forcePathStyle: raw.S3_FORCE_PATH_STYLE,
        presignTtl: parseInt(raw.S3_PRESIGN_TTL, 10),
      },
    },
    ocr: {
      provider: raw.OCR_PROVIDER,
      baidu: { apiKey: cleanKey(raw.BAIDU_OCR_API_KEY), secretKey: cleanKey(raw.BAIDU_OCR_SECRET_KEY) },
      paddleUrl: raw.PADDLE_OCR_URL,
      dailyLimit: parseInt(raw.OCR_DAILY_LIMIT, 10),
    },
    vision: {
      provider: raw.VISION_PROVIDER,
      apiKey: cleanKey(raw.VISION_API_KEY),
      baseUrl: raw.VISION_BASE_URL,
      model: raw.VISION_MODEL,
      timeoutMs: parseInt(raw.VISION_TIMEOUT_MS, 10),
      dailyLimit: parseInt(raw.VISION_DAILY_LIMIT, 10),
      maxTokens: parseInt(raw.VISION_MAX_TOKENS, 10),
    },
    business: {
      recycleRetentionDays: parseInt(raw.RECYCLE_RETENTION_DAYS, 10),
      analysisConcurrency: parseInt(raw.ANALYSIS_CONCURRENCY, 10),
      orphanUploadTtlHours: parseInt(raw.ORPHAN_UPLOAD_TTL_HOURS, 10),
    },
    trustProxy: raw.TRUST_PROXY,
  };
}

/* Provider 默认连接参数(便于单处查阅) */
export const VISION_PROVIDER_DEFAULTS = {
  zhipu: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4v-flash' },
  siliconflow: { baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-VL-72B-Instruct' },
  ollama: { baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5vl:7b' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
};
