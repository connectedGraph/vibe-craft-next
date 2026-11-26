"use client";

import { useCallback, useEffect, useState } from "react";

export type SyncConflictItem = {
  at: number;
  app: string;
  collection: string;
  id: string;
  local: Record<string, unknown> | null;
  server?: Record<string, unknown> | null;
};

const KEY = "vibesync:conflicts:v1";

function readAll(): SyncConflictItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? (list as SyncConflictItem[]) : [];
  } catch {
    return [];
  }
}

function writeAll(list: SyncConflictItem[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(-200)));
  } catch {
    /* 忽略 */
  }
}

function labelOf(item: SyncConflictItem) {
  const local = item.local || {};
  const value = local.title || local.term || local.name || item.id;
  return String(value || item.id);
}

/**
 * 共享同步工具（Expressing / Contextly / Desktop Lite）的冲突入口。
 * 同步冲突时本地记录已经被另存为「冲突副本」；这里再给一个手动恢复/清理的地方。
 */
export default function SyncConflicts({
  app,
  onRestore,
}: {
  app: string;
  onRestore: (item: SyncConflictItem) => void;
}) {
  const [items, setItems] = useState<SyncConflictItem[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    setItems(readAll().filter((x) => x && x.app === app));
  }, [app]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 读取 localStorage 里的外部冲突记录
    load();
    const timer = window.setInterval(load, 5000);
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) load();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", load);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", load);
    };
  }, [load]);

  const remove = useCallback((item: SyncConflictItem) => {
    const rest = readAll().filter(
      (x) => !(x.app === item.app && x.collection === item.collection && x.id === item.id && x.at === item.at),
    );
    writeAll(rest);
    load();
  }, [load]);

  const clear = useCallback(() => {
    writeAll(readAll().filter((x) => x.app !== app));
    load();
  }, [app, load]);

  if (!items.length) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 left-4 z-[80] flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50/95 px-3 py-2 text-[11px] font-semibold text-amber-800 shadow-lg backdrop-blur transition hover:border-amber-300 hover:bg-amber-100"
      >
        <span className="h-2 w-2 rounded-full bg-amber-500" />
        同步冲突 {items.length}
      </button>
      {open && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative z-10 flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white bg-white/95 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
              <div>
                <h3 className="text-sm font-bold text-slate-800">同步冲突</h3>
                <p className="mt-0.5 text-[11px] text-slate-400">云端版本已生效，本地版本已另存为冲突副本。</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600" aria-label="关闭">
                ✕
              </button>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-4">
              {items.slice().reverse().map((item) => (
                <div key={`${item.app}-${item.collection}-${item.id}-${item.at}`} className="rounded-xl border border-amber-100 bg-amber-50/60 p-3">
                  <div className="truncate text-xs font-semibold text-slate-700">{labelOf(item)}</div>
                  <div className="mt-0.5 text-[11px] text-slate-400">
                    {item.collection} · {new Date(item.at).toLocaleString()}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!item.local}
                      onClick={() => {
                        onRestore(item);
                        remove(item);
                      }}
                      className="rounded-md border border-amber-200 bg-white px-2.5 py-1 text-[11px] font-medium text-amber-700 transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      恢复为独立记录
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(item)}
                      className="rounded-md px-2.5 py-1 text-[11px] text-slate-400 transition hover:text-red-500"
                    >
                      删除记录
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-5 py-3">
              <span className="text-[11px] text-slate-400">冲突记录最多保留最近 200 条。</span>
              <div className="flex gap-2">
                <button type="button" onClick={clear} className="rounded-md px-2.5 py-1 text-[11px] text-slate-500 transition hover:text-red-500">
                  全部清除
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md bg-slate-800 px-3 py-1 text-[11px] font-semibold text-white transition hover:bg-slate-900"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
