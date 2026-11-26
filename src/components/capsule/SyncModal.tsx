'use client';

import { useRef, useState } from 'react';
import type { SyncConfig, SyncConflict } from './useSync';
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
  config: SyncConfig;
  accountMode: boolean;
  onSaveConfig: (config: SyncConfig) => void;
  onLogout: () => void;
  onClearConflicts: () => void;
  onRestoreConflict: (local: CapsuleDoc) => void;
  onSyncNow: () => Promise<void>;
  onTest: () => Promise<{ seq: number; count: number }>;
  onPullAll: () => Promise<void>;
};

const APP = 'prompt-capsule';

const STATUS_TEXT: Record<string, string> = {
  off: 'Cloud Sync Off',
  idle: 'Synced',
  syncing: 'Syncing…',
  error: 'Sync Error',
  'login-required': 'Sign in to Sync',
};

export default function SyncModal(props: Props) {
  const {
    open,
    onClose,
    status,
    user,
    isAdmin,
    errorText,
    lastSyncAt,
    conflicts,
    config,
    accountMode,
    onSaveConfig,
    onLogout,
    onClearConflicts,
    onRestoreConflict,
    onSyncNow,
    onTest,
    onPullAll,
  } = props;
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<'info' | 'ok' | 'bad'>('info');
  const [server, setServer] = useState(config.server);
  const [token, setToken] = useState(config.token);
  const [enabled, setEnabled] = useState(config.enabled);
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

  const saveManual = () => {
    onSaveConfig({ server, token, enabled });
    say(server ? '已保存手动同步配置。' : '已切回同源账号模式。', 'ok');
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

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/25 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white bg-white/95 shadow-2xl backdrop-blur-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-white/60 px-5 py-4">
          <h3 className="text-lg font-bold text-slate-800">Cloud Sync</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="关闭">✕</button>
        </div>

        <div className="space-y-4 overflow-y-auto p-5">
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 truncate text-sm text-slate-700">
                {accountMode ? '当前账号：' : '连接状态：'}
                <b className="text-slate-900">{accountMode ? user || '未登录' : '手动配置'}</b>
                {accountMode && user === 'anonymous' && <span className="ml-1 text-[11px] text-slate-400">匿名模式</span>}
              </div>
              <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                {STATUS_TEXT[status] || status}
              </span>
            </div>
            <div className="mt-2 text-[11px] leading-relaxed text-slate-500">
              {accountMode
                ? '账号由同源后端管理，数据按账号隔离。浏览器只保存 HttpOnly 会话 Cookie，前端拿不到密码或令牌。'
                : '本地数据仍是主存储；同步只负责多设备增量同步与服务端备份。冲突时云端版本胜出，本地版本会另存为「冲突副本」。'}
              {lastSyncAt ? ` 上次同步 ${new Date(lastSyncAt).toLocaleTimeString()}` : ''}
            </div>
            {errorText && <div className="mt-1 text-[11px] text-red-500">{errorText}</div>}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {accountMode && user && user !== 'anonymous' && (
                <button
                  onClick={onLogout}
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 transition hover:border-red-300 hover:text-red-500"
                >
                  退出登录
                </button>
              )}
              {accountMode && !user && (
                <a
                  href={`/login?next=${encodeURIComponent(typeof window === 'undefined' ? '/prompt-capsule' : window.location.pathname)}`}
                  className="rounded-md border border-indigo-200 bg-white px-2.5 py-1 text-[11px] font-medium text-indigo-600 transition hover:border-indigo-300"
                >
                  去登录
                </a>
              )}
              {isAdmin && (
                <a
                  href="/admin"
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600"
                >
                  管理
                </a>
              )}
            </div>
          </div>

          {!accountMode && (
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-500" htmlFor="sync-server">
                  Server URL
                </label>
                <input
                  id="sync-server"
                  value={server}
                  onChange={(e) => setServer(e.target.value)}
                  placeholder="https://sync.example.com"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-500" htmlFor="sync-token">
                  Access Token
                </label>
                <input
                  id="sync-token"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="vck_..."
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200"
                />
              </div>
              <label className="flex select-none items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-400"
                />
                Enable automatic sync
              </label>
              <div className="text-[11px] leading-relaxed text-slate-400">
                留空 Server URL 即回到同源账号模式。手动模式需要 Access Token（`vck_` 开头），服务器需允许跨域访问。
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button onClick={test} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600">Test</button>
            <button onClick={syncNow} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600">Sync Now</button>
            <button onClick={exportBackup} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600">导出云端备份</button>
            <button onClick={() => restoreRef.current?.click()} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600">从备份恢复</button>
          </div>
          <input
            ref={restoreRef}
            type="file"
            accept=".json,.bri"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importBackup(f);
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

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
          <div className="text-[11px] text-slate-400">本地数据是主存储，同步只做多设备增量。</div>
          <div className="flex flex-wrap gap-2">
            {isAdmin && (
              <a href="/admin" className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600">
                管理
              </a>
            )}
            {!accountMode && (
              <button onClick={saveManual} className="rounded-md bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white shadow-lg shadow-indigo-200 transition hover:bg-indigo-700">
                Save
              </button>
            )}
            <button onClick={onClose} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600">
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
