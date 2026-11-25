'use client';

import { useCallback, useEffect, useState } from 'react';

type User = {
  username: string;
  role: string;
  disabled: boolean;
  mustChangePassword: boolean;
  createdAt: number;
  lastLoginAt: number | null;
};

type Session = {
  id: number;
  device: string;
  ip: string;
  createdAt: number;
  lastSeenAt: number | null;
  revoked: boolean;
};

type Token = {
  id: number;
  name: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
};

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.message || data.error || `HTTP ${res.status}`);
  return data;
}

const fmt = (ts: number | null) => (ts ? new Date(ts).toLocaleString() : '—');

const input = 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400';
const btn = 'rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600';

export default function AdminApp({ username }: { username: string }) {
  const [users, setUsers] = useState<User[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [mode, setMode] = useState('self');
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [sessionUser, setSessionUser] = useState(username);
  const [newUser, setNewUser] = useState('');
  const [newPass, setNewPass] = useState('');
  const [newRole, setNewRole] = useState('user');
  const [tokenName, setTokenName] = useState('');
  const [newToken, setNewToken] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const toast = useCallback((text: string, ok = true) => {
    if (ok) { setMessage(text); setError(''); } else { setError(text); setMessage(''); }
    setTimeout(() => { setMessage(''); setError(''); }, 3500);
  }, []);

  const loadUsers = useCallback(async () => {
    const data = await api('GET', '/api/v1/admin/users');
    setUsers(data.users);
  }, []);

  const loadSettings = useCallback(async () => {
    const data = await api('GET', '/api/v1/admin/settings');
    setMode(data.mode);
    setRegistrationOpen(!!data.registrationOpen);
    setInviteCode(data.inviteCode || '');
  }, []);

  const loadSessions = useCallback(async (name: string) => {
    const data = await api('GET', `/api/v1/admin/sessions?username=${encodeURIComponent(name)}`);
    setSessions(data.sessions);
  }, []);

  const loadTokens = useCallback(async () => {
    const data = await api('GET', '/api/v1/admin/tokens');
    setTokens(data.tokens);
  }, []);

  useEffect(() => {
    Promise.all([loadUsers(), loadSettings(), loadSessions(username), loadTokens()])
      .catch(e => toast(e.message, false));
  }, [loadUsers, loadSettings, loadSessions, loadTokens, username, toast]);

  const saveSettings = async () => {
    try {
      await api('POST', '/api/v1/admin/settings', { mode, registrationOpen, inviteCode });
      toast('设置已保存');
      await loadSettings();
    } catch (e) { toast((e as Error).message, false); }
  };

  const createUser = async () => {
    try {
      await api('POST', '/api/v1/admin/users', { username: newUser, password: newPass, role: newRole });
      setNewUser('');
      setNewPass('');
      toast('用户已创建');
      await loadUsers();
    } catch (e) { toast((e as Error).message, false); }
  };

  const resetPassword = async (name: string) => {
    const pw = window.prompt(`为 ${name} 设置新密码（至少 8 位）：`);
    if (!pw) return;
    try {
      await api('PATCH', `/api/v1/admin/users/${encodeURIComponent(name)}`, { password: pw });
      toast('密码已更新');
    } catch (e) { toast((e as Error).message, false); }
  };

  const toggleDisabled = async (u: User) => {
    try {
      await api('PATCH', `/api/v1/admin/users/${encodeURIComponent(u.username)}`, { disabled: !u.disabled });
      toast(u.disabled ? '已启用' : '已禁用');
      await loadUsers();
    } catch (e) { toast((e as Error).message, false); }
  };

  const createToken = async () => {
    try {
      const data = await api('POST', '/api/v1/admin/tokens', { name: tokenName || 'script' });
      setNewToken(data.token);
      setTokenName('');
      await loadTokens();
    } catch (e) { toast((e as Error).message, false); }
  };

  return (
    <main className="min-h-screen px-4 py-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-lg font-bold">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 text-white">✦</span>
            Vibe Craft · 管理
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>{username} · 管理员</span>
            <a href="/" className={btn}>返回工作台</a>
            <form action="/api/v1/auth/logout" method="post">
              <button className={btn}>退出</button>
            </form>
          </div>
        </header>

        {(error || message) && (
          <div className={`mb-4 rounded-xl border px-3 py-2.5 text-xs ${error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
            {error || message}
          </div>
        )}

        <section className="mb-4 rounded-2xl border border-white/80 bg-white/75 p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold">账号模式</h2>
          <div className="flex flex-wrap items-center gap-2">
            <select value={mode} onChange={e => setMode(e.target.value)} className={input}>
              <option value="off">off · 匿名</option>
              <option value="self">self · 单账号</option>
              <option value="public">public · 开放注册</option>
            </select>
            <label className="flex items-center gap-2 text-xs text-slate-500">
              <input type="checkbox" checked={registrationOpen} onChange={e => setRegistrationOpen(e.target.checked)} /> 开放注册
            </label>
            <input value={inviteCode} onChange={e => setInviteCode(e.target.value)} placeholder="邀请码（可空）" className={input} />
            <button onClick={saveSettings} className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white">保存</button>
          </div>
        </section>

        <section className="mb-4 rounded-2xl border border-white/80 bg-white/75 p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold">用户</h2>
          <div className="mb-3 flex flex-wrap gap-2">
            <input value={newUser} onChange={e => setNewUser(e.target.value)} placeholder="用户名" className={input} />
            <input value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="初始密码（至少 8 位）" type="password" className={input} />
            <select value={newRole} onChange={e => setNewRole(e.target.value)} className={input}>
              <option value="user">普通用户</option>
              <option value="admin">管理员</option>
            </select>
            <button onClick={createUser} className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white">创建</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-slate-400">
                <tr><th className="py-2 pr-3">用户名</th><th className="py-2 pr-3">角色</th><th className="py-2 pr-3">状态</th><th className="py-2 pr-3">最后登录</th><th className="py-2">操作</th></tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.username} className="border-t border-slate-100">
                    <td className="py-2 pr-3 font-mono text-xs">{u.username}</td>
                    <td className="py-2 pr-3">{u.role}</td>
                    <td className="py-2 pr-3">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ${u.disabled ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>
                        {u.disabled ? '已禁用' : '正常'}
                      </span>
                      {u.mustChangePassword && <span className="ml-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-600">待改密</span>}
                    </td>
                    <td className="py-2 pr-3 text-xs text-slate-400">{fmt(u.lastLoginAt)}</td>
                    <td className="py-2">
                      <div className="flex gap-1.5">
                        <button onClick={() => resetPassword(u.username)} className={btn}>改密</button>
                        <button onClick={() => toggleDisabled(u)} className={btn}>{u.disabled ? '启用' : '禁用'}</button>
                        <button onClick={() => { setSessionUser(u.username); loadSessions(u.username); }} className={btn}>会话</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mb-4 rounded-2xl border border-white/80 bg-white/75 p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold">登录会话</h2>
          <div className="mb-3 flex gap-2">
            <input value={sessionUser} onChange={e => setSessionUser(e.target.value)} placeholder="用户名" className={input} />
            <button onClick={() => loadSessions(sessionUser)} className={btn}>查看</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-slate-400">
                <tr><th className="py-2 pr-3">设备</th><th className="py-2 pr-3">IP</th><th className="py-2 pr-3">登录时间</th><th className="py-2 pr-3">最近活跃</th><th className="py-2 pr-3">状态</th><th className="py-2">操作</th></tr>
              </thead>
              <tbody>
                {sessions.map(s => (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="max-w-[220px] truncate py-2 pr-3 text-xs" title={s.device}>{s.device || '未知设备'}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{s.ip}</td>
                    <td className="py-2 pr-3 text-xs text-slate-400">{fmt(s.createdAt)}</td>
                    <td className="py-2 pr-3 text-xs text-slate-400">{fmt(s.lastSeenAt)}</td>
                    <td className="py-2 pr-3 text-xs">{s.revoked ? '已吊销' : '有效'}</td>
                    <td className="py-2">
                      {!s.revoked && (
                        <button
                          onClick={async () => {
                            try { await api('DELETE', `/api/v1/admin/sessions/${s.id}`); toast('已吊销'); await loadSessions(sessionUser); }
                            catch (e) { toast((e as Error).message, false); }
                          }}
                          className={btn}
                        >
                          踢下线
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-white/80 bg-white/75 p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold">API 令牌</h2>
          <div className="mb-3 flex flex-wrap gap-2">
            <input value={tokenName} onChange={e => setTokenName(e.target.value)} placeholder="用途，例如 script" className={input} />
            <button onClick={createToken} className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white">创建</button>
          </div>
          {newToken && (
            <div className="mb-3 rounded-xl bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100">
              {newToken}
              <div className="mt-1 font-sans text-[11px] text-slate-400">只显示这一次，复制好再关页面。</div>
            </div>
          )}
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-slate-400">
              <tr><th className="py-2 pr-3">名称</th><th className="py-2 pr-3">创建时间</th><th className="py-2 pr-3">最近使用</th><th className="py-2 pr-3">状态</th><th className="py-2">操作</th></tr>
            </thead>
            <tbody>
              {tokens.map(t => (
                <tr key={t.id} className="border-t border-slate-100">
                  <td className="py-2 pr-3">{t.name}</td>
                  <td className="py-2 pr-3 text-xs text-slate-400">{fmt(t.created_at)}</td>
                  <td className="py-2 pr-3 text-xs text-slate-400">{fmt(t.last_used_at)}</td>
                  <td className="py-2 pr-3 text-xs">{t.revoked_at ? '已吊销' : '有效'}</td>
                  <td className="py-2">
                    {!t.revoked_at && (
                      <button
                        onClick={async () => {
                          try { await api('DELETE', `/api/v1/admin/tokens/${t.id}`); toast('已吊销'); await loadTokens(); }
                          catch (e) { toast((e as Error).message, false); }
                        }}
                        className={btn}
                      >
                        吊销
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
