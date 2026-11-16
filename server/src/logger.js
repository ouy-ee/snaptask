/* pino JSON 日志:生产可接入任意日志/错误监控系统(见 docs/COSTS.md) */

import pino from 'pino';

export function createLogger(level = 'info') {
  return pino({
    level,
    base: { service: 'snaptask-server' },
    timestamp: pino.stdTimeFunctions.isoTime,
    // 测试环境静默,避免噪音
    ...(level === 'silent' ? { enabled: false } : {}),
  });
}
