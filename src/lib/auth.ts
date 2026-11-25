import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cookies } from 'next/headers';
import { getDb, DB_PATH } from './db';

export type Role = 'admin' | 'user';
export type AuthMode = 'off' | 'self' | 'public';

export type UserRow = {
  id: number;
  username: string;
  password_hash: string;
  role: Role;
  disabled: number;
  must_change_password: number;
  password_changed_at: number;
  created_at: number;
  last_login_at: number | null;
};

export type Identity = { username: string; role: Role; user: UserRow };

export const SESSION_COOKIE = 'vc_session';
export const TOKEN_PREFIX = 'vck_';

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

export const authConfig = {
  mode: str('AUTH_MODE', 'self') as AuthMode,
  authSecret: str('AUTH_SECRET', ''),
  sessionHours: num('SESSION_HOURS', 8),
  rememberDays: num('REMEMBER_DAYS', 30),
  adminUser: str('ADMIN_USER', 'admin'),
  adminPassword: str('ADMIN_PASSWORD', '123456'),
  registrationOpen: str('REGISTRATION_OPEN', '1') === '1',
  registrationCode: str('REGISTRATION_CODE', ''),
  trustProxyAuth: str('TRUST_PROXY_AUTH', '') === '1',
  legacyToken: str('SYNC_TOKEN', ''),
};

const DATA_DIR = dirname(DB_PATH);

/* ───────────── 运行时设置 ───────────── */

function metaGet(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

function metaSet(key: string, value: string): void {
  getDb().prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
}

export function getMode(): AuthMode {
  const v = metaGet('auth_mode') ?? authConfig.mode;
  return v === 'off' || v === 'public' ? v : 'self';
}

export function setMode(mode: AuthMode): void { metaSet('auth_mode', mode); }

export function getRegistrationOpen(): boolean {
  if (getMode() !== 'public') return false;
  const v = metaGet('registration_open');
  return v === null ? authConfig.registrationOpen : v === '1';
}

export function setRegistrationOpen(open: boolean): void { metaSet('registration_open', open ? '1' : '0'); }

export function getInviteCode(): string {
  const v = metaGet('invite_code');
  return v === null ? authConfig.registrationCode : v;
}

export function setInviteCode(code: string): void { metaSet('invite_code', code); }

/* ───────────── 密码 ───────────── */

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${key.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltHex, keyHex] = parts;
  try {
    const expected = Buffer.from(keyHex, 'hex');
    const got = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
    });
    return got.length === expected.length && timingSafeEqual(got, expected);
  } catch { return false; }
}

export function isDefaultPassword(password: string): boolean {
  return password === '123456' || password.length < 8;
}

/* ───────────── JWT ───────────── */

let cachedSecret: string | null = null;

function secret(): string {
  if (cachedSecret) return cachedSecret;
  if (authConfig.authSecret) return (cachedSecret = authConfig.authSecret);
  const file = join(DATA_DIR, '.auth-secret');
  try {
    const existing = readFileSync(file, 'utf8').trim();
    if (existing) return (cachedSecret = existing);
  } catch { /* 首次 */ }
  const generated = randomBytes(48).toString('hex');
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, generated, { mode: 0o600 });
  } catch { /* 只读文件系统 */ }
  return (cachedSecret = generated);
}

function b64url(input: Buffer | string): string { return Buffer.from(input).toString('base64url'); }
function hmac(body: string): string { return createHmac('sha256', secret()).update(body).digest('base64url'); }

export function signSession(user: UserRow, days: number, jti: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({
    sub: user.username, role: user.role, pv: user.password_changed_at, jti,
    iat: now, exp: now + Math.round(days * 86400),
  }));
  const unsigned = `${header}.${body}`;
  return `${unsigned}.${hmac(unsigned)}`;
}

export function createSession(user: UserRow, opts: { days: number; device?: string; ip?: string }): string {
  const jti = randomBytes(18).toString('base64url');
  getDb().prepare(
    'INSERT INTO session (user_id, jti, device, ip, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(user.username, jti, String(opts.device ?? '').slice(0, 200), String(opts.ip ?? '').slice(0, 64), Date.now(), Date.now());
  return signSession(user, opts.days, jti);
}

function readSession(token: string | null | undefined): { sub: string; pv: number; jti: string } | null {
  const raw = String(token ?? '').trim();
  const parts = raw.split('.');
  if (parts.length !== 3) return null;
  const unsigned = `${parts[0]}.${parts[1]}`;
  const expected = hmac(unsigned);
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: { sub?: string; pv?: number; exp?: number; jti?: string };
  try { payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return null; }
  if (!payload || typeof payload.sub !== 'string') return null;
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) return null;
  if (typeof payload.jti !== 'string' || !payload.jti) return null;
  return { sub: payload.sub, pv: Number(payload.pv ?? 0), jti: payload.jti };
}

export function userFromToken(token: string | null | undefined): UserRow | null {
  const payload = readSession(token);
  if (!payload) return null;
  const s = getDb().prepare('SELECT id, revoked_at, last_seen_at FROM session WHERE jti = ?').get(payload.jti) as
    | { id: number; revoked_at: number | null; last_seen_at: number | null } | undefined;
  if (!s || s.revoked_at != null) return null;
  const user = findUser(payload.sub);
  if (!user || user.disabled) return null;
  if (Number(payload.pv) !== Number(user.password_changed_at)) return null;
  const now = Date.now();
  if (!s.last_seen_at || now - s.last_seen_at > 5 * 60 * 1000) {
    getDb().prepare('UPDATE session SET last_seen_at = ? WHERE id = ?').run(now, s.id);
  }
  return user;
}

export function jtiOfToken(token: string | null | undefined): string | null {
  const p = readSession(token);
  return p ? p.jti : null;
}

export function sessionMaxAgeSeconds(remember: boolean): number {
  return remember ? authConfig.rememberDays * 86400 : authConfig.sessionHours * 3600;
}

/* ───────────── Cookie ───────────── */

export function parseCookie(header: string | null | undefined, name: string): string | null {
  for (const part of String(header ?? '').split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    if (trimmed.slice(0, eq).trim() === name) return decodeURIComponent(trimmed.slice(eq + 1).trim());
  }
  return null;
}

export function sessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`
    + (secure ? '; Secure' : '');
}

export function clearedCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
    + (secure ? '; Secure' : '');
}

/* ───────────── 用户 ───────────── */

const USER_COLUMNS = 'id, username, password_hash, role, disabled, must_change_password, password_changed_at, created_at, last_login_at';

export function findUser(username: string): UserRow | null {
  if (!username) return null;
  const row = getDb().prepare(`SELECT ${USER_COLUMNS} FROM user WHERE username = ? COLLATE NOCASE`).get(username) as UserRow | undefined;
  return row ?? null;
}

export function listUsers(): UserRow[] {
  return getDb().prepare(`SELECT ${USER_COLUMNS} FROM user ORDER BY id`).all() as unknown as UserRow[];
}

export function countUsers(): number {
  return Number((getDb().prepare('SELECT COUNT(*) AS n FROM user').get() as { n: number }).n);
}

export function countAdmins(): number {
  return Number((getDb().prepare("SELECT COUNT(*) AS n FROM user WHERE role = 'admin' AND disabled = 0").get() as { n: number }).n);
}

export function createUser(input: { username: string; password: string; role?: Role; mustChange?: boolean }): UserRow {
  const now = Date.now();
  const username = String(input.username).trim();
  getDb().prepare(
    'INSERT INTO user (username, password_hash, role, disabled, must_change_password, password_changed_at, created_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(username, hashPassword(input.password), input.role ?? 'user', input.mustChange ? 1 : 0, now, now);
  const user = findUser(username);
  if (!user) throw new Error('创建账号失败');
  return user;
}

export function setPassword(username: string, password: string, mustChange: boolean): UserRow | null {
  const now = Date.now();
  const info = getDb().prepare(
    'UPDATE user SET password_hash = ?, must_change_password = ?, password_changed_at = ? WHERE username = ? COLLATE NOCASE',
  ).run(hashPassword(password), mustChange ? 1 : 0, now, username);
  const user = Number(info.changes) > 0 ? findUser(username) : null;
  if (user) revokeAllSessions(user.username);
  return user;
}

export function setDisabled(username: string, disabled: boolean): boolean {
  const info = getDb().prepare('UPDATE user SET disabled = ? WHERE username = ? COLLATE NOCASE').run(disabled ? 1 : 0, username);
  return Number(info.changes) > 0;
}

export function touchLogin(username: string): void {
  getDb().prepare('UPDATE user SET last_login_at = ? WHERE username = ? COLLATE NOCASE').run(Date.now(), username);
}

export function ensureSeedUser(): void {
  if (countUsers() > 0) return;
  const password = authConfig.adminPassword || '123456';
  const weak = isDefaultPassword(password);
  createUser({ username: authConfig.adminUser || 'admin', password, role: 'admin', mustChange: weak });
}

let seedChecked = false;

/** 首次请求时创建管理员。幂等，进程内只查一次。 */
export function ensureSeedOnce(): void {
  if (seedChecked) return;
  seedChecked = true;
  ensureSeedUser();
}

/* ───────────── 会话管理 ───────────── */

export function listSessions(userId: string) {
  return getDb().prepare(
    'SELECT id, user_id, device, ip, created_at, last_seen_at, revoked_at FROM session WHERE user_id = ? ORDER BY id DESC',
  ).all(userId) as unknown as { id: number; user_id: string; device: string; ip: string; created_at: number; last_seen_at: number | null; revoked_at: number | null }[];
}

export function revokeSession(userId: string, id: number): boolean {
  const info = getDb().prepare('UPDATE session SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL').run(Date.now(), id, userId);
  return Number(info.changes) > 0;
}

export function revokeSessionByJti(jti: string): boolean {
  const info = getDb().prepare('UPDATE session SET revoked_at = ? WHERE jti = ? AND revoked_at IS NULL').run(Date.now(), jti);
  return Number(info.changes) > 0;
}

export function revokeAllSessions(userId: string): void {
  getDb().prepare('UPDATE session SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(Date.now(), userId);
}

/* ───────────── 登录限流 ───────────── */

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const failures = new Map<string, { n: number; until: number }>();

export function loginRetryAfterMs(key: string): number {
  const hit = failures.get(key);
  if (!hit) return 0;
  if (hit.until > Date.now()) return hit.until - Date.now();
  if (hit.until > 0) failures.delete(key);
  return 0;
}

export function noteLoginFailure(key: string): void {
  const hit = failures.get(key) ?? { n: 0, until: 0 };
  hit.n += 1;
  if (hit.n >= LOGIN_MAX_FAILURES) { hit.n = 0; hit.until = Date.now() + LOGIN_WINDOW_MS; }
  failures.set(key, hit);
}

export function clearLoginFailures(key: string): void { failures.delete(key); }

/* ───────────── API 令牌 ───────────── */

function tokenHash(token: string): string { return createHash('sha256').update(token).digest('hex'); }

export function createToken(userId: string, name = 'script'): { id: number; token: string } {
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
  const info = getDb().prepare('INSERT INTO api_token (user_id, name, token_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(userId, name, tokenHash(token), Date.now());
  return { id: Number(info.lastInsertRowid), token };
}

export function listTokens(userId: string) {
  return getDb().prepare('SELECT id, user_id, name, created_at, last_used_at, revoked_at FROM api_token WHERE user_id = ? ORDER BY id DESC').all(userId);
}

export function revokeToken(userId: string, id: number): boolean {
  const info = getDb().prepare('UPDATE api_token SET revoked_at = ? WHERE user_id = ? AND id = ? AND revoked_at IS NULL').run(Date.now(), userId, id);
  return Number(info.changes) > 0;
}

export function verifyToken(raw: string | null | undefined): string | null {
  const token = String(raw ?? '').trim();
  if (!token.startsWith(TOKEN_PREFIX) || token.length < 20) return null;
  const d = getDb();
  const row = d.prepare('SELECT id, user_id, token_hash, revoked_at FROM api_token WHERE token_hash = ?')
    .get(tokenHash(token)) as { id: number; user_id: string; token_hash: string; revoked_at: number | null } | undefined;
  if (!row || row.revoked_at != null) return null;
  const a = Buffer.from(row.token_hash, 'hex');
  const b = Buffer.from(tokenHash(token), 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  d.prepare('UPDATE api_token SET last_used_at = ? WHERE id = ?').run(Date.now(), row.id);
  return row.user_id;
}

/* ───────────── 身份解析 ───────────── */

function identityFromHeaders(headers: Headers): Identity | null {
  if (authConfig.trustProxyAuth) {
    const name = String(headers.get('x-auth-user') || '').trim();
    if (name) {
      let user = findUser(name);
      if (!user) user = createUser({ username: name, password: randomBytes(24).toString('hex'), role: countUsers() === 0 ? 'admin' : 'user' });
      return user.disabled ? null : { username: user.username, role: user.role, user };
    }
  }

  const auth = String(headers.get('authorization') || '');
  if (auth.toLowerCase().startsWith('bearer ')) {
    const raw = auth.slice(7).trim();
    if (authConfig.legacyToken && raw === authConfig.legacyToken) {
      const admin = findUser(authConfig.adminUser || 'admin');
      if (admin && !admin.disabled) return { username: admin.username, role: admin.role, user: admin };
    }
    if (raw.startsWith(TOKEN_PREFIX)) {
      const uid = verifyToken(raw);
      const user = uid ? findUser(uid) : null;
      if (user && !user.disabled) return { username: user.username, role: user.role, user };
    } else {
      const user = userFromToken(raw);
      if (user) return { username: user.username, role: user.role, user };
    }
  }

  const fromCookie = userFromToken(parseCookie(headers.get('cookie'), SESSION_COOKIE));
  if (fromCookie) return { username: fromCookie.username, role: fromCookie.role, user: fromCookie };

  if (getMode() === 'off') {
    const admin = findUser(authConfig.adminUser || 'admin');
    if (admin && !admin.disabled) return { username: admin.username, role: admin.role, user: admin };
  }
  return null;
}

export function identityFromRequest(req: Request): Identity | null {
  return identityFromHeaders(req.headers);
}

export async function identityFromCookies(): Promise<Identity | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  const user = token ? userFromToken(token) : null;
  return user ? { username: user.username, role: user.role, user } : null;
}

export function clientIpFromHeaders(headers: Headers): string {
  return String(headers.get('x-real-ip') || '').trim()
    || String(headers.get('x-forwarded-for') || '').split(',')[0].trim()
    || 'unknown';
}

export function userPayload(user: UserRow) {
  return { username: user.username, role: user.role, mustChangePassword: user.must_change_password === 1 };
}

export function authPayload(identity: Identity | null) {
  const admin = findUser(authConfig.adminUser || 'admin');
  return {
    mode: getMode(),
    registrationOpen: getRegistrationOpen(),
    inviteRequired: getInviteCode().length > 0,
    trustProxyAuth: authConfig.trustProxyAuth,
    defaultPasswordHint: !!(admin && admin.must_change_password === 1),
    user: identity ? userPayload(identity.user) : null,
  };
}
