/* 测试上下文工厂:内存库 + 临时目录 + 可注入的假 OCR/Vision */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import request from 'supertest';
import { openMemoryDb } from '../src/db.js';
import { createLogger } from '../src/logger.js';
import { createStorage } from '../src/storage/index.js';
import { createAnalysisQueue } from '../src/ai/pipeline.js';
import { createApp } from '../src/app.js';

/* ---------- 构造合法 PNG(无外部依赖,保证魔数与 IHDR 均有效) ---------- */

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

export function makePng(width = 1, height = 1, rgb = [10, 20, 30]) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < width; x++) {
      const o = y * stride + 1 + x * 3;
      raw[o] = rgb[0];
      raw[o + 1] = rgb[1];
      raw[o + 2] = rgb[2];
    }
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- 上下文 ---------- */

export function makeCtx({ vision, ocr } = {}) {
  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snaptask-test-'));
  const config = {
    env: 'test',
    isProd: false,
    port: 0,
    host: '127.0.0.1',
    dataDir: uploadsDir,
    dbPath: path.join(uploadsDir, 'test.db'),
    uploadsDir,
    corsOrigin: ['http://localhost:5173'],
    logLevel: 'silent',
    trustProxy: false,
    jwt: { secret: 'test-secret', secretIsDefault: false, accessTtlSec: 900, refreshTtlDays: 30, imageTtlSec: 86400 },
    rateLimit: { windowMs: 60000, max: 10000, authMax: 10000 },
    storage: { driver: 'local', maxUploadBytes: 10 * 1024 * 1024, s3: {} },
    ocr: { provider: 'none', baidu: {}, paddleUrl: 'http://localhost:8788', dailyLimit: 1000 },
    vision: { provider: 'test', apiKey: 'test', baseUrl: undefined, model: 'fake', timeoutMs: 30000, dailyLimit: 1000 },
    business: { recycleRetentionDays: 30, analysisConcurrency: 1, orphanUploadTtlHours: 24 },
  };
  const db = openMemoryDb();
  const logger = createLogger('silent');
  const storage = createStorage(config, logger);
  const ocrImpl = ocr || { provider: 'none', recognize: async () => ({ lines: [], fullText: '', skipped: true }) };
  const visionImpl = vision || { provider: 'fake', model: 'fake', complete: async () => '{}' };
  const queue = createAnalysisQueue({ db, config, logger, storage, ocr: ocrImpl, vision: visionImpl });
  const ctx = { config, logger, db, storage, ocr: ocrImpl, vision: visionImpl, queue };
  const app = createApp(ctx);
  return { ctx, app, cleanup: () => fs.rmSync(uploadsDir, { recursive: true, force: true }) };
}

/* ---------- 账号辅助 ---------- */

let userSeq = 0;

export async function registerUser(app, overrides = {}) {
  userSeq += 1;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: '测试用户', email: `user${userSeq}-${Date.now()}@test.local`, password: 'password123', ...overrides });
  return res.body; // { user, accessToken, refreshToken }
}

export function authHeader(tokens) {
  return { Authorization: `Bearer ${tokens.accessToken}` };
}

export function uploadPng(app, tokens, buffer = makePng(4, 3)) {
  return request(app)
    .post('/api/uploads')
    .set(authHeader(tokens))
    .attach('file', buffer, { filename: 'shot.png', contentType: 'image/png' });
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* 轮询分析任务直到终态 */
export async function waitJobDone(app, tokens, jobId, timeoutMs = 5000) {
  const start = Date.now();
  for (;;) {
    const res = await request(app).get(`/api/analysis/${jobId}`).set(authHeader(tokens));
    const snap = res.body;
    if (['success', 'partial_success', 'failed', 'cancelled'].includes(snap.status)) return snap;
    if (Date.now() - start > timeoutMs) throw new Error(`分析任务超时未结束: ${JSON.stringify(snap)}`);
    await sleep(25);
  }
}
