/* ============================================================
   文件存储抽象:local(本地磁盘)与 s3(S3 兼容:Cloudflare R2 / MinIO)。
   存储 key 由服务端生成(userId/uuid.ext),杜绝路径穿越与文件名注入。
   ============================================================ */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/* ---------------- 本地驱动 ---------------- */

function createLocalDriver(uploadsDir, logger) {
  return {
    kind: 'local',
    async put(key, buffer, mimeType) {
      const abs = path.join(uploadsDir, key);
      if (!abs.startsWith(uploadsDir)) throw new Error('非法存储 key');
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, buffer);
      return { size: buffer.length };
    },
    async get(key) {
      const abs = path.join(uploadsDir, key);
      if (!abs.startsWith(uploadsDir)) throw new Error('非法存储 key');
      try {
        return await fsp.readFile(abs);
      } catch (err) {
        if (err?.code === 'ENOENT') return null;
        throw err;
      }
    },
    /* 本地模式经鉴权接口直出,无需 URL */
    async getUrl(key) {
      return null;
    },
    async remove(key) {
      const abs = path.join(uploadsDir, key);
      if (!abs.startsWith(uploadsDir)) throw new Error('非法存储 key');
      try {
        await fsp.unlink(abs);
        // 清理空目录(尽力而为)
        const dir = path.dirname(abs);
        const entries = await fsp.readdir(dir).catch(() => []);
        if (entries.length === 0 && dir !== uploadsDir) await fsp.rmdir(dir).catch(() => {});
      } catch (err) {
        if (err?.code !== 'ENOENT') logger.warn({ err: err.message, key }, '存储删除失败');
      }
    },
  };
}

/* ---------------- S3 驱动 ---------------- */

function createS3Driver(cfg, logger) {
  const { endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle, presignTtl } = cfg;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('STORAGE_DRIVER=s3 时必须配置 S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY');
  }
  const client = new S3Client({
    region: region || 'auto',
    endpoint,
    forcePathStyle: !!forcePathStyle,
    credentials: { accessKeyId, secretAccessKey },
  });
  return {
    kind: 's3',
    async put(key, buffer, mimeType) {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: mimeType })
      );
      return { size: buffer.length };
    },
    async get(key) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const bytes = await res.Body.transformToByteArray();
        return Buffer.from(bytes);
      } catch (err) {
        if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) return null;
        throw err;
      }
    },
    async getUrl(key) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn: presignTtl || 900,
      });
    },
    async remove(key) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch (err) {
        logger.warn({ err: err.message, key }, 'S3 删除失败');
      }
    },
  };
}

/* ---------------- 工厂 + 工具 ---------------- */

export function createStorage(cfg, logger) {
  if (cfg.driver === 's3') return createS3Driver(cfg.s3, logger);
  return createLocalDriver(cfg.uploadsDir, logger);
}

/* 生成存储 key:userId/uuid.ext(时间戳前缀便于清理) */
export function storageKeyFor(userId, ext) {
  return `${userId}/${Date.now().toString(36)}-${crypto.randomUUID()}.${ext}`;
}

/* 常见图片扩展名 → mime(魔数校验后使用) */
export const MIME_BY_EXT = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};
