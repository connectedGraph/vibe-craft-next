/**
 * 测试基础设施：拉起真实的 Next 生产服务（next start），不 mock 路由。
 *
 * - 复用已有的 `.next` 构建产物；缺失时才补跑一次 `npm run build`。
 * - 每个实例独立的临时 DATA_DIR，退出时删掉。
 * - 默认 `RATE_LIMIT=off`，限流用例自己用 env 覆盖成低额度。
 */

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '..');

const NEXT_BIN = join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
export const DEFAULT_ADMIN_PASSWORD = 'admin-pass-123';

const live = new Set();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let buildChecked = false;

/** 有 .next/BUILD_ID 就复用；没有才构建一次（同一测试进程只判断一次）。 */
async function ensureBuild() {
  if (buildChecked) return;
  buildChecked = true;
  if (existsSync(join(ROOT, '.next', 'BUILD_ID'))) return;

  const proc = spawn('npm', ['run', 'build'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  proc.stdout.on('data', (d) => { out = (out + d).slice(-20000); });
  proc.stderr.on('data', (d) => { out = (out + d).slice(-20000); });
  const [code] = await once(proc, 'exit');
  if (code !== 0) throw new Error(`构建失败（exit ${code}）：\n${out}`);
}

function cleanupOnExit() {
  for (const svc of live) {
    try { svc.proc.kill('SIGKILL'); } catch { /* 已退出 */ }
    try { rmSync(svc.dataDir, { recursive: true, force: true }); } catch { /* 忽略 */ }
  }
}
process.on('exit', cleanupOnExit);

/**
 * 取一个当前空闲的本地端口，避免和其他 worktree / 并行测试抢占固定端口。
 * （先 bind 0 拿到内核分配的端口，再立刻释放给 next start。）
 */
async function freePort() {
  return await new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.unref();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close(() => resolvePort(port));
    });
  });
}

/**
 * 启动一个被测服务实例。
 * @param {{port?: number, env?: Record<string,string>, readyPath?: string, timeoutMs?: number}} opts
 */
export async function startServer(opts = {}) {
  const {
    port = await freePort(),
    env = {},
    readyPath = '/api/v1/health',
    timeoutMs = 90000,
    label = 'next',
  } = opts;

  await ensureBuild();

  const dataDir = mkdtempSync(join(tmpdir(), 'vc-next-test-'));
  const fullEnv = {
    ...process.env,
    NODE_ENV: 'production',
    DATA_DIR: dataDir,
    AUTH_MODE: 'public',
    REGISTRATION_OPEN: '1',
    RATE_LIMIT: 'off',
    ADMIN_USER: 'admin',
    ADMIN_PASSWORD: DEFAULT_ADMIN_PASSWORD,
    ...env,
  };

  const proc = spawn(process.execPath, [NEXT_BIN, 'start', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: ROOT,
    env: fullEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  const capture = (d) => { output = (output + String(d)).slice(-40000); };
  proc.stdout.on('data', capture);
  proc.stderr.on('data', capture);

  const base = `http://127.0.0.1:${port}`;
  const svc = {
    base,
    port,
    label,
    dataDir,
    proc,
    output: () => output,
    async stop() {
      live.delete(svc);
      if (proc.exitCode === null && proc.signalCode === null) {
        proc.kill('SIGTERM');
        await Promise.race([once(proc, 'exit'), sleep(5000)]);
        if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
      }
      try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* 忽略 */ }
    },
  };
  live.add(svc);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      await svc.stop();
      throw new Error(`[${label}] next start 提前退出（exit ${proc.exitCode}）：\n${output}`);
    }
    try {
      const res = await fetch(`${base}${readyPath}`);
      // 端口可能是刚释放又被别人占用：确认健康响应来自我们自己的进程。
      if (res.ok && proc.exitCode === null) {
        await sleep(100);
        if (proc.exitCode === null) return svc;
      }
    } catch { /* 还没起 */ }
    await sleep(150);
  }
  await svc.stop();
  throw new Error(`[${label}] 等待 ${base}${readyPath} 超时：\n${output}`);
}

/** 发一个 JSON 请求，返回 status / 解析后的 body / Set-Cookie 数组。 */
export async function req(base, method, path, opts = {}) {
  const { body, rawBody, cookie, token, headers = {}, redirect = 'manual' } = opts;
  const h = { ...headers };
  let payload;
  if (rawBody !== undefined) {
    if (!h['Content-Type']) h['Content-Type'] = 'application/json';
    payload = rawBody;
  } else if (body !== undefined) {
    if (!h['Content-Type']) h['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (cookie) h.Cookie = cookie;
  if (token) h.Authorization = `Bearer ${token}`;

  const res = await fetch(base + path, { method, headers: h, body: payload, redirect });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* 非 JSON */ }
  const setCookie = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  return { status: res.status, headers: res.headers, data, text, setCookie };
}

/** 从 Set-Cookie 数组里取 `vc_session=...`，直接可用于 Cookie 头。 */
export function cookieOf(setCookies, name = 'vc_session') {
  const raw = (setCookies || []).find((c) => c.startsWith(`${name}=`));
  if (!raw) return '';
  const end = raw.indexOf(';');
  return end === -1 ? raw : raw.slice(0, end);
}

let seq = 0;
/** 生成唯一用户名，避免同一次测试进程内重复。 */
export function uniqueName(prefix = 'u') {
  seq += 1;
  return `${prefix}_${process.pid.toString(36)}_${seq}_${Math.random().toString(36).slice(2, 6)}`;
}

export async function register(base, username, password = 'user-pass-123', extra = {}) {
  const res = await req(base, 'POST', '/api/v1/auth/register', {
    body: { username, password, ...extra },
  });
  return { ...res, cookie: cookieOf(res.setCookie) };
}

export async function login(base, username, password) {
  const res = await req(base, 'POST', '/api/v1/auth/login', { body: { username, password } });
  return { ...res, cookie: cookieOf(res.setCookie) };
}
