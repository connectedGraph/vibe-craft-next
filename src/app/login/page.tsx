'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

type Panel = 'login' | 'register' | 'change' | 'off';
type Me = {
  mode: 'off' | 'self' | 'public';
  registrationOpen: boolean;
  inviteRequired: boolean;
  defaultPasswordHint: boolean;
  user: { username: string; role: string; mustChangePassword: boolean } | null;
};

class ApiClientError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function call(path: string, body?: Record<string, unknown>) {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiClientError('network', '网络连接失败，请检查网络后重试');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiClientError(data.error || `http_${res.status}`, data.message || '请求失败，请稍后重试');
  }
  return data;
}

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white/90 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100';

function Eye({ open }: { open: boolean }) {
  return open ? (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3l18 18" /><path d="M10.6 6.2A10.9 10.9 0 0 1 12 6c6.4 0 10 6 10 6a17.6 17.6 0 0 1-3.1 3.7M6.3 7.6C3.9 9.3 2 12 2 12s3.6 6.5 10 6.5c1.2 0 2.3-.2 3.3-.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" /><circle cx="12" cy="12" r="2.8" />
    </svg>
  );
}

function PasswordField(props: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-slate-500">{props.label}</span>
      <span className="relative block">
        <input
          name={props.name}
          type={show ? 'text' : 'password'}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder={props.placeholder}
          autoComplete={props.autoComplete}
          className={inputClass + ' pr-11'}
        />
        <button
          type="button"
          onClick={() => setShow(v => !v)}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 hover:bg-indigo-50 hover:text-indigo-500"
          aria-label={show ? '隐藏密码' : '显示密码'}
        >
          <Eye open={show} />
        </button>
      </span>
    </label>
  );
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const nextUrl = (() => {
    const raw = params.get('next') || '/';
    return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
  })();

  const [me, setMe] = useState<Me | null>(null);
  const [panel, setPanel] = useState<Panel>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [invite, setInvite] = useState('');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [forced, setForced] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/v1/auth/me', { credentials: 'same-origin' })
      .then(r => r.json())
      .then((data: Me) => {
        if (!alive) return;
        setMe(data);
        if (data.mode === 'off') return setPanel('off');
        if (data.user && !data.user.mustChangePassword) {
          router.replace(nextUrl);
          return;
        }
        if (data.user && data.user.mustChangePassword) {
          setForced(true);
          setPanel('change');
        }
      })
      .catch(() => { /* 后端没起来，保留登录表单 */ });
    return () => { alive = false; };
  }, [router, nextUrl]);

  function resetError() {
    setError('');
  }

  async function run(fn: () => Promise<void>) {
    resetError();
    setLoading(true);
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiClientError) setError(e.message);
      else setError('请求失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }

  const submitLogin = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const out = await call('/api/v1/auth/login', { username, password, remember });
      if (out.user?.mustChangePassword) {
        setForced(true);
        setPanel('change');
        setCurrent(password);
      } else {
        router.replace(nextUrl);
      }
    });
  };

  const submitRegister = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setError('密码至少 8 位');
    run(async () => {
      await call('/api/v1/auth/register', { username, password, invite });
      router.replace(nextUrl);
    });
  };

  const submitChange = (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < 8) return setError('新密码至少 8 位');
    if (next !== repeat) return setError('两次输入的新密码不一致');
    run(async () => {
      await call('/api/v1/auth/password', { current: forced ? '' : current, next });
      router.replace(nextUrl);
    });
  };

  return (
    <div className="min-h-screen bg-[#eef1ff] bg-[radial-gradient(at_8%_6%,rgba(99,102,241,.22)_0px,transparent_45%),radial-gradient(at_95%_92%,rgba(168,85,247,.18)_0px,transparent_42%)] px-4 py-10">
      <div className="mx-auto w-full max-w-[400px] rounded-3xl border border-white/90 bg-white/75 p-8 shadow-[0_24px_60px_-24px_rgba(49,46,129,.35)] backdrop-blur-xl">
        <div className="mb-6 flex items-center gap-2.5 text-[15px] font-bold tracking-tight text-slate-900">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 text-lg text-white shadow-lg shadow-indigo-500/40">✦</span>
          Vibe Craft
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[12.5px] leading-relaxed text-red-700">
            {error}
          </div>
        )}

        {panel === 'login' && (
          <section>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">登入</h1>
            <p className="mb-5 mt-1 text-[13px] leading-relaxed text-slate-500">
              数据存在你浏览器里，云端只做多设备同步与备份。
            </p>
            <form onSubmit={submitLogin} className="space-y-3.5">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-slate-500">用户名</span>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  autoCapitalize="off"
                  required
                  className={inputClass}
                />
              </label>
              <PasswordField label="密码" name="password" value={password} onChange={setPassword} autoComplete="current-password" />
              <label className="flex items-center gap-2 text-xs text-slate-500">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="rounded border-slate-300" />
                保持登录 30 天
              </label>
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:-translate-y-px disabled:cursor-default disabled:opacity-60"
              >
                {loading ? '登录中…' : '登录'}
              </button>
            </form>
            {me?.defaultPasswordHint && (
              <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/70 px-3 py-2.5 text-xs leading-relaxed text-slate-600">
                <b className="text-indigo-700">默认密码 123456</b>
                <br />首次登录会被要求改成自己的密码，不用再输入一遍旧的。
              </div>
            )}
            {me?.registrationOpen && (
              <div className="mt-4 text-center text-xs text-slate-500">
                还没有账号？{' '}
                <button type="button" onClick={() => { resetError(); setPanel('register'); }} className="font-semibold text-indigo-600 hover:underline">
                  注册
                </button>
              </div>
            )}
          </section>
        )}

        {panel === 'register' && (
          <section>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">注册</h1>
            <p className="mb-5 mt-1 text-[13px] leading-relaxed text-slate-500">
              这个实例开放注册，数据按账号隔离。
            </p>
            <form onSubmit={submitRegister} className="space-y-3.5">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-slate-500">用户名</span>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoCapitalize="off"
                  required
                  placeholder="3–32 位字母、数字或下划线"
                  className={inputClass}
                />
              </label>
              <PasswordField label="密码" name="password" value={password} onChange={setPassword} placeholder="至少 8 位" autoComplete="new-password" />
              {me?.inviteRequired && (
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-slate-500">邀请码</span>
                  <input value={invite} onChange={(e) => setInvite(e.target.value)} className={inputClass} />
                </label>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:-translate-y-px disabled:cursor-default disabled:opacity-60"
              >
                {loading ? '创建中…' : '创建账号'}
              </button>
            </form>
            <div className="mt-4 text-center text-xs text-slate-500">
              已有账号？{' '}
              <button type="button" onClick={() => { resetError(); setPanel('login'); }} className="font-semibold text-indigo-600 hover:underline">
                去登录
              </button>
            </div>
          </section>
        )}

        {panel === 'change' && (
          <section>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">设一个新密码</h1>
            <p className="mb-5 mt-1 text-[13px] leading-relaxed text-slate-500">
              初始密码是公开的，换成你自己的才能进主界面。
            </p>
            <form onSubmit={submitChange} className="space-y-3.5">
              {!forced && (
                <PasswordField label="当前密码" name="current" value={current} onChange={setCurrent} autoComplete="current-password" />
              )}
              <PasswordField label="新密码" name="next" value={next} onChange={setNext} placeholder="至少 8 位" autoComplete="new-password" />
              <PasswordField label="再输一次" name="repeat" value={repeat} onChange={setRepeat} autoComplete="new-password" />
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:-translate-y-px disabled:cursor-default disabled:opacity-60"
              >
                {loading ? '保存中…' : '保存并进入'}
              </button>
            </form>
            {forced && (
              <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/70 px-3 py-2.5 text-xs leading-relaxed text-slate-600">
                <b className="text-indigo-700">不用再输一遍</b>
                <br />你刚才已经用初始密码登录过了，直接设新的就行。
              </div>
            )}
          </section>
        )}

        {panel === 'off' && (
          <section>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">匿名模式</h1>
            <p className="mb-5 mt-1 text-[13px] leading-relaxed text-slate-500">
              这个实例没有开启登录，所有访问算同一个账号。
            </p>
            <a
              href="/"
              className="block w-full rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-3 text-center text-sm font-semibold text-white shadow-lg shadow-indigo-500/30"
            >
              直接进入
            </a>
          </section>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#eef1ff]" />}>
      <LoginInner />
    </Suspense>
  );
}
