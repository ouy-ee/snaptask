/* 上传:合法 PNG 通过、伪造图片拒绝、超限拒绝、内容接口鉴权 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeCtx, registerUser, authHeader, makePng } from './helpers.js';

describe('uploads', () => {
  it('合法 PNG 上传返回尺寸;魔数伪造被拒绝', async () => {
    const { app, cleanup } = makeCtx();
    try {
      const tokens = await registerUser(app);
      const ok = await request(app)
        .post('/api/uploads')
        .set(authHeader(tokens))
        .attach('file', makePng(12, 8), { filename: 'shot.png', contentType: 'image/png' });
      expect(ok.status).toBe(201);
      expect(ok.body.width).toBe(12);
      expect(ok.body.height).toBe(8);

      // 文本内容伪装成 .png → 魔数校验拒绝
      const fake = await request(app)
        .post('/api/uploads')
        .set(authHeader(tokens))
        .attach('file', Buffer.from('<script>alert(1)</script>'), { filename: 'evil.png', contentType: 'image/png' });
      expect(fake.status).toBe(400);
      expect(fake.body.error.code).toBe('UPLOAD_TYPE_FORBIDDEN');

      // SVG 明确拒绝(XSS 向量)
      const svg = await request(app)
        .post('/api/uploads')
        .set(authHeader(tokens))
        .attach('file', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), { filename: 'evil.svg', contentType: 'image/svg+xml' });
      expect(svg.status).toBe(400);
    } finally {
      cleanup();
    }
  });

  it('内容接口需要鉴权,且缓存头为私有', async () => {
    const { app, cleanup } = makeCtx();
    try {
      const tokens = await registerUser(app);
      const up = await request(app)
        .post('/api/uploads')
        .set(authHeader(tokens))
        .attach('file', makePng(2, 2), { filename: 'a.png', contentType: 'image/png' });

      const noAuth = await request(app).get(`/api/uploads/${up.body.id}/content`);
      expect(noAuth.status).toBe(401);

      const ok = await request(app).get(`/api/uploads/${up.body.id}/content`).set(authHeader(tokens));
      expect(ok.status).toBe(200);
      expect(ok.headers['content-type']).toBe('image/png');
      expect(ok.headers['cache-control']).toContain('private');
    } finally {
      cleanup();
    }
  });

  it('被记录引用的图片不可直接删除(409)', async () => {
    const { app, cleanup } = makeCtx();
    try {
      const tokens = await registerUser(app);
      const up = (await request(app).post('/api/uploads').set(authHeader(tokens)).attach('file', makePng(2, 2), { filename: 'a.png', contentType: 'image/png' })).body;
      await request(app).post('/api/records').set(authHeader(tokens)).send({
        title: 'r',
        images: [{ id: up.id, name: 'a.png', legendIndex: 1 }],
        result: { scenario: 'success', content_tags: [], summary: { oneLiner: { text: 'x', src: [] }, facts: [], inferences: [], suggestions: [] }, facts: [], keyFacts: [], tasks: [], comparison: { dims: [], rows: [] }, warnings: [] },
      });
      const del = await request(app).delete(`/api/uploads/${up.id}`).set(authHeader(tokens));
      expect(del.status).toBe(409);
      expect(del.body.error.code).toBe('UPLOAD_IN_USE');
    } finally {
      cleanup();
    }
  });
});
