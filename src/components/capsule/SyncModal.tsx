'use client';

import { useRef, useState } from 'react';
import type { SyncConflict } from './useSync';
import type { CapsuleDoc } from '@/lib/tools/capsule';

type Props = {
  open: boolean;
  onClose: () => void;
  status: string;
  user: string | null;
  isAdmin: boolean;
  errorText: string;
  lastSyncAt: number;
  conflicts: SyncConflict[];
  onClearConflicts: () => void;
  onRestoreConflict: (local: CapsuleDoc) => void;
  onSyncNow: () => Promise<void>;
  onTest: () => Promise<{ seq: number; count: number }>;
  onPullAll: () => Promise<void>;
};

const APP = 'prompt-capsule';

export default function SyncModal(props: Props) {
  const { open, onClose, status, user, isAdmin, errorText, lastSyncAt, conflicts, onClearConflicts, onRestoreConflict, onSyncNow, onTest, onPullAll } = props;
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<'info' | 'ok' | 'bad'>('info');
  const restoreRef = useRef<HTMLInputElement | null>(null);

  if (!open) return null;

  const say = (text: string, next: 'info' | 'ok' | 'bad' = 'info') => {
    setMessage(text);
    setTone(next);
  };

  const test = async () => {
    say('Testing…');
    try {
      const res = await onTest();
      say(`Connected. Server seq ${res.seq}, ${res.count} records.`, 'ok');
    } catch (e) {
      say('Failed: ' + (e instanceof Error ? e.message : String(e)), 'bad');
    }
  };

  const syncNow = async () => {
    say('Syncing…');
    await onSyncNow();
    say('Synced at ' + new Date().toLocaleTimeString(), 'ok');
  };

  const exportBackup = async () => {
    try {
      const res = await fetch(`/api/v1/backup/export?app=${APP}`, { credentials: 'same-origin' });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.message || data.error || `HTTP ${res.status}`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `prompt-capsule-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      say(`已导出 ${data.count} 条记录。`, 'ok');
    } catch (e) {
      say('导出失败：' + (e instanceof Error ? e.message : String(e)), 'bad');
    }
  };

  const importBackup = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      const records = Array.isArray(parsed.records) ? parsed.records : Array.isArray(parsed) ? parsed : null;
      if (!records) throw new Error('文件里没有 records 字段');
      const replace = window.confirm(
        '确定要用备份覆盖云端吗？\n\n确定 = 替换云端（先删除云上现有记录再导入）\n取消 = 仅合并缺失记录',
      );
      const res = await fetch('/api/v1/backup/import', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app: APP, mode: replace ? 'replace' : 'merge', records }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.message || data.error || `HTTP ${res.status}`);
      await onPullAll();
      say(`恢复完成：导入 ${data.imported} 条，跳过 ${data.skipped} 条。`, 'ok');
    } catch (e) {
      say('恢复失败：' + (e instanceof Error ? e.message : String(e)), 'bad');
    }
  };

  const statusText: Record<string, string> = {
    off: '同步未启用',
    idle: '已同步',
    syncing: '同步中…',
    error: '同步失败',
    'login-required': '需要登录',
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/25 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-white bg-white/95 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-slate-100 bg-white/60 px-5 py-4">
          <h3 className="text-lg font-bold text-slate-800">Cloud Sync</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="关闭">✕</button>
        </div>

        <div className="space-y-4 p-5">
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm text-slate-700">
                当前账号：<b className="text-slate-900">{user || '未登录'}</b>
              </div>
              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                {statusText[status] || status}
              </span>
            </div>
            <div className="mt-2 text-[11px] leading-relaxed text-slate-500">
              本实例使用同源账号登录，浏览器只保存 HttpOnly 会话 Cookie。{lastSyncAt ? `上次同步 ${new Date(lastSyncAt).toLocaleTimeString()}` : ''}
            </div>
            {errorText && <div className="mt-1 text-[11px] text-red-500">{errorText}</div>}
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={test} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600">Test</button>
            <button onClick={syncNow} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600">Sync Now</button>
            <button onClick={exportBackup} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600">导出云端备份</button>
            <button onClick={() => restoreRef.current?.click()} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600">从备份恢复</button>
            {isAdmin && (
              <a href="/admin" className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600">
                管理
              </a>
            )}
          </div>
          <input
            ref={restoreRef}
            type="file"
            accept=".json,.bri"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importBackup(f);
              e.target.value = '';
            }}
          />

          {message && (
            <div className={`text-xs ${tone === 'ok' ? 'text-emerald-600' : tone === 'bad' ? 'text-red-500' : 'text-slate-500'}`}>
              {message}
            </div>
          )}

          {conflicts.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-slate-600">冲突记录（{conflicts.length}）</div>
                <button onClick={onClearConflicts} className="text-[11px] text-slate-400 hover:text-red-500">清除</button>
              </div>
              <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
                {conflicts.slice(-20).reverse().map((c) => (
                  <div key={`${c.id}-${c.at}`} className="rounded-lg border border-amber-100 bg-amber-50/70 p-2.5">
                    <div className="truncate text-xs text-slate-700">{c.local.title || c.id}</div>
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      {new Date(c.at).toLocaleString()} · {c.collection}
                    </div>
                    <button onClick={() => onRestoreConflict(c.local)} className="mt-1.5 text-[11px] font-medium text-amber-700 hover:underline">
                      把本地版本恢复为独立文档
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
          <div className="text-[11px] text-slate-400">本地数据是主存储，同步只做多设备增量。</div>
          <button onClick={onClose} className="rounded-md bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white shadow-lg shadow-indigo-200 transition hover:bg-indigo-700">
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
