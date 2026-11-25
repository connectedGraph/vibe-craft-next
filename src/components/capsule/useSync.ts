'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Annotation, CapsuleDoc } from '@/lib/tools/capsule';

export type { Annotation, CapsuleDoc };

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'error' | 'login-required';
export type SyncConflict = { id: string; collection: string; at: number; local: CapsuleDoc };

const CURSOR_KEY = 'vibesync:cursor:prompt-capsule';
const SNAP_KEY = 'vibesync:snap:prompt-capsule';
const APP = 'prompt-capsule';

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.message || data.error || `HTTP ${res.status}`);
  }
  return data;
}

export type ApplyRemote = (payload: {
  upserts: CapsuleDoc[];
  deletes: string[];
  categories: string[] | null;
}) => void;

export function useCapsuleSync(opts: {
  docs: CapsuleDoc[];
  categories: string[];
  applyRemote: ApplyRemote;
  onConflict: (local: CapsuleDoc, server: CapsuleDoc) => void;
  enabled: boolean;
}) {
  const [status, setStatus] = useState<SyncStatus>('off');
  const [user, setUser] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [lastSyncAt, setLastSyncAt] = useState(0);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);

  const snapRef = useRef<Record<string, string>>({});
  const runningRef = useRef(false);
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SNAP_KEY);
      if (saved) snapRef.current = JSON.parse(saved);
    } catch { /* 忽略 */ }
  }, []);

  const persistSnap = useCallback(() => {
    try { localStorage.setItem(SNAP_KEY, JSON.stringify(snapRef.current)); } catch { /* 忽略 */ }
  }, []);

  const tick = useCallback(async () => {
    if (!optsRef.current.enabled || runningRef.current) return;
    runningRef.current = true;
    try {
      const me = await api('GET', '/api/v1/auth/me');
      if (!me.user && me.mode !== 'off') {
        setStatus('login-required');
        setUser(null);
        return;
      }
      setUser(me.user?.username || (me.mode === 'off' ? 'anonymous' : null));
      setStatus('syncing');
      setError('');

      const current = optsRef.current;

      // 1. push 本地变化
      const snap: Record<string, string> = {};
      for (const d of current.docs) snap[d.id] = hash(JSON.stringify(d));
      const catHash = hash(JSON.stringify(current.categories));
      const ops: Record<string, unknown>[] = [];

      for (const d of current.docs) {
        if (snapRef.current[d.id] !== snap[d.id]) {
          ops.push({
            collection: 'docs',
            id: d.id,
            op: 'upsert',
            data: d,
            updatedAt: Math.max(Date.now(), Number(d.updatedAt) || 0, 1),
          });
        }
      }
      for (const id of Object.keys(snapRef.current)) {
        if (id === '__categories__') continue;
        if (!snap[id]) ops.push({ collection: 'docs', id, op: 'delete', updatedAt: Date.now() });
      }
      if (snapRef.current.__categories__ !== catHash) {
        ops.push({
          collection: 'settings',
          id: '__singleton__',
          op: 'upsert',
          data: { categories: current.categories, updatedAt: Date.now() },
          updatedAt: Date.now(),
        });
      }

      if (ops.length) {
        const pushed = await api('POST', '/api/v1/sync/push', {
          app: APP,
          deviceId: getDeviceId(),
          ops,
        });
        for (const c of pushed.conflicts || []) {
          if (c.collection === 'docs') {
            const local = current.docs.find(d => d.id === c.id);
            if (local && c.server?.data) {
              optsRef.current.onConflict(local, c.server.data);
              setConflicts(prev => [
                ...prev.filter(x => x.id !== c.id),
                { id: c.id, collection: c.collection, at: Date.now(), local: c.server.data ?? local },
              ]);
            }
          }
        }
      }

      // 2. pull 远端变化
      let since = Number(localStorage.getItem(CURSOR_KEY) || 0);
      const upserts: CapsuleDoc[] = [];
      const deletes: string[] = [];
      let remoteCategories: string[] | null = null;
      let hasMore = true;

      while (hasMore) {
        const res = await api('GET', `/api/v1/sync/pull?app=${APP}&since=${since}&limit=500`);
        for (const ch of res.changes || []) {
          if (ch.collection === 'docs') {
            if (ch.op === 'delete') {
              deletes.push(ch.id);
            } else if (ch.data) {
              upserts.push(ch.data as CapsuleDoc);
            }
          } else if (ch.collection === 'settings' && ch.data?.categories) {
            remoteCategories = ch.data.categories;
          }
        }
        since = res.now;
        hasMore = !!res.hasMore;
      }
      localStorage.setItem(CURSOR_KEY, String(since));

      if (upserts.length || deletes.length || remoteCategories) {
        optsRef.current.applyRemote({ upserts, deletes, categories: remoteCategories });
      }

      // 3. 以当前状态为准更新快照
      const after = optsRef.current;
      const newSnap: Record<string, string> = { __categories__: hash(JSON.stringify(after.categories)) };
      for (const d of after.docs) newSnap[d.id] = hash(JSON.stringify(d));
      snapRef.current = newSnap;
      persistSnap();

      setStatus('idle');
      setLastSyncAt(Date.now());
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      runningRef.current = false;
    }
  }, [persistSnap]);

  const clearConflicts = useCallback(() => setConflicts([]), []);

  const testConnection = useCallback(async () => {
    const res = await api('GET', `/api/v1/sync/state?app=${APP}`);
    return { seq: Number(res.seq) || 0, count: Number(res.count) || 0 };
  }, []);

  /** 从云端重新拉全量（用于「从备份恢复」后刷新本地）。 */
  const pullAll = useCallback(async () => {
    try {
      localStorage.setItem(CURSOR_KEY, '0');
    } catch { /* 忽略 */ }
    await tick();
  }, [tick]);

  useEffect(() => {
    if (!opts.enabled) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 启动同步轮询（外部系统订阅），首次立刻跑一次
    tick();
    const timer = setInterval(tick, 6000);
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [opts.enabled, tick]);

  // enabled=false 时对外统一显示 off（避免在 effect 里同步 setState）
  return {
    status: opts.enabled ? status : 'off',
    user, error, lastSyncAt, syncNow: tick, conflicts, clearConflicts, testConnection, pullAll,
  };
}

function getDeviceId(): string {
  const key = 'vibesync:device';
  let id = localStorage.getItem(key);
  if (!id) {
    id = 'web_' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(key, id);
  }
  return id;
}
