/* ============================================================
   多标签页同步:BroadcastChannel 广播变更 → 其他标签页重拉服务端数据。
   scope: auth | all | records | folders | tasks | archives
   ============================================================ */

const CHANNEL = 'snaptask-sync';

export function openSyncChannel(onMessage) {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const bc = new BroadcastChannel(CHANNEL);
  bc.onmessage = (e) => {
    if (e?.data && typeof e.data.scope === 'string') onMessage(e.data.scope);
  };
  return () => {
    try {
      bc.close();
    } catch {
      /* ignore */
    }
  };
}

export function broadcastSync(scope) {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      new BroadcastChannel(CHANNEL).postMessage({ scope, ts: Date.now() });
    }
  } catch {
    /* ignore */
  }
}
