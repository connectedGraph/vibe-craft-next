'use client';

import { useEffect, useState } from 'react';
import type { CapsuleDoc } from '@/lib/tools/capsule';

type Version = {
  seq: number;
  updatedAt: number;
  deviceId?: string;
  deleted?: boolean;
  data?: { title?: string } | null;
};

type Props = {
  open: boolean;
  doc: CapsuleDoc | null;
  onClose: () => void;
  onRestored: () => Promise<void> | void;
};

const APP = 'prompt-capsule';

export default function HistoryModal({ open, doc, onClose, onRestored }: Props) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!open || !doc) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 打开弹窗时重置并拉取历史，属于外部数据同步
    setState('loading');
    setVersions([]);
    setMessage('');
    (async () => {
      try {
        const res = await fetch(
          `/api/v1/sync/history?app=${APP}&collection=docs&id=${encodeURIComponent(doc.id)}&limit=100`,
          { credentials: 'same-origin' },
        );
        const data = await res.json();
        if (!res.ok || data.ok === false) throw new Error(data.message || data.error || `HTTP ${res.status}`);
        if (cancelled) return;
        setVersions(Array.isArray(data.versions) ? data.versions : []);
        setState('ready');
      } catch (e) {
        if (cancelled) return;
        setMessage(e instanceof Error ? e.message : String(e));
        setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [open, doc]);

  if (!open || !doc) return null;

  const restore = async (seq: number) => {
    if (!window.confirm('恢复到这个版本？当前内容会作为新版本保留在历史里。')) return;
    try {
      const res = await fetch('/api/v1/sync/restore', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app: APP, collection: 'docs', id: doc.id, seq }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.message || data.error || `HTTP ${res.status}`);
      await onRestored();
      onClose();
      window.alert('已恢复。');
    } catch (e) {
      window.alert('恢复失败：' + (e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/25 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl border border-white bg-white/95 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-slate-100 bg-white/60 px-5 py-4">
          <div>
            <h3 className="text-lg font-bold text-slate-800">版本历史</h3>
            <div className="mt-0.5 text-xs text-slate-400">{doc.title || '无标题'}</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="关闭">✕</button>
        </div>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto p-4">
          {state === 'loading' && <div className="p-2 text-xs text-slate-400">加载中…</div>}
          {state === 'error' && <div className="p-2 text-xs text-red-500">加载失败：{message}</div>}
          {state === 'ready' && versions.length === 0 && (
            <div className="p-2 text-xs text-slate-400">还没有云端历史。同步过一次后，每次修改都会留下版本。</div>
          )}
          {state === 'ready' &&
            versions.map((v, i) => (
              <div key={v.seq} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-slate-700">
                    {v.deleted ? '（已删除）' : v.data?.title || '无标题'}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-400">
                    {new Date(v.updatedAt).toLocaleString()} · {v.deviceId || '未知设备'}
                    {i === 0 ? ' · 当前' : ''}
                  </div>
                </div>
                {i !== 0 && (
                  <button
                    onClick={() => restore(v.seq)}
                    className="shrink-0 rounded-md border border-indigo-200 bg-white px-2.5 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
                  >
                    恢复
                  </button>
                )}
              </div>
            ))}
        </div>
        <div className="border-t border-slate-100 bg-slate-50 px-5 py-3 text-[11px] text-slate-400">
          恢复操作会生成一个新版本，不会删除历史记录。
        </div>
      </div>
    </div>
  );
}
