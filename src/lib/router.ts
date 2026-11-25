import { NextResponse } from 'next/server';
import {
  authConfig, authPayload, clearedCookie, clearLoginFailures, createSession, createToken, ensureSeedOnce,
  createUser, findUser, getInviteCode, getMode, getRegistrationOpen, identityFromRequest,
  jtiOfToken, listSessions, listTokens, listUsers, loginRetryAfterMs, noteLoginFailure,
  parseCookie, revokeSession, revokeSessionByJti, revokeToken, SESSION_COOKIE, sessionCookie,
  sessionMaxAgeSeconds, setDisabled, setInviteCode, setMode, setPassword, setRegistrationOpen,
  touchLogin, userPayload, verifyPassword, clientIpFromHeaders,
  type Identity,
} from './auth';
import { ApiError, messageOf } from './errors';
import { fail, isSecureRequest, json, readJson } from './http';
import { exportBackup, importBackup, restoreVersion, syncHistory, syncPull, syncPush, syncState } from './sync';

type Ctx = {
  req: Request;
  url: URL;
  identity: Identity;
  body: () => Promise<Record<string, unknown>>;
};

type Route = {
  method: string;
  pattern: RegExp;
  handler: (ctx: Ctx, match: RegExpExecArray) => unknown | Promise<unknown>;
  open?: boolean;
  admin?: boolean;
};

const routes: Route[] = [];

function route(method: string, pattern: RegExp, handler: Route['handler'], opts: { open?: boolean; admin?: boolean } = {}) {
  routes.push({ method, pattern, handler, ...opts });
}

function setCookie(res: NextResponse, cookie: string) {
  res.headers.append('Set-Cookie', cookie);
  return res;
}

/* ───────────── 鉴权 ───────────── */

function handleLogin(ctx: Ctx) {
  return (async () => {
    if (getMode() === 'off') throw new ApiError(400, 'anonymous_mode');
    const body = await ctx.body();
    const username = String(body.username ?? '').trim();
    const password = String(body.password ?? '');
    const remember = body.remember === true || String(body.remember) === '1';
    if (!username || !password) throw new ApiError(400, 'missing_credentials');

    const key = `${clientIpFromHeaders(ctx.req.headers)}|${username.toLowerCase()}`;
    const retry = loginRetryAfterMs(key);
    if (retry > 0) {
      throw new ApiError(429, 'too_many_attempts', { 'Retry-After': String(Math.ceil(retry / 1000)) });
    }

    const user = findUser(username);
    if (!user || !verifyPassword(password, user.password_hash)) {
      noteLoginFailure(key);
      throw new ApiError(401, 'invalid_credentials');
    }
    if (user.disabled) throw new ApiError(403, 'account_disabled');

    clearLoginFailures(key);
    touchLogin(user.username);
    const maxAge = sessionMaxAgeSeconds(remember);
    const token = createSession(user, {
      days: maxAge / 86400,
      device: String(ctx.req.headers.get('user-agent') || '').slice(0, 200),
      ip: clientIpFromHeaders(ctx.req.headers),
    });
    const res = json({ ok: true, user: userPayload(user) });
    return setCookie(res, sessionCookie(token, maxAge, isSecureRequest(ctx.req)));
  })();
}

async function handleRegister(ctx: Ctx) {
  if (getMode() !== 'public' || !getRegistrationOpen()) throw new ApiError(403, 'registration_closed');
  const body = await ctx.body();
  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '');
  const invite = String(body.invite ?? '').trim();

  const code = getInviteCode();
  if (code && invite !== code) throw new ApiError(403, 'bad_invite_code');
  if (!/^[A-Za-z0-9_]{3,32}$/.test(username)) throw new ApiError(400, 'bad_username');
  if (password.length < 8) throw new ApiError(400, 'weak_password');
  if (findUser(username)) throw new ApiError(409, 'username_taken');

  const user = createUser({ username, password, role: 'user' });
  touchLogin(user.username);
  const maxAge = sessionMaxAgeSeconds(false);
  const token = createSession(user, {
    days: maxAge / 86400,
    device: String(ctx.req.headers.get('user-agent') || '').slice(0, 200),
    ip: clientIpFromHeaders(ctx.req.headers),
  });
  const res = json({ ok: true, user: userPayload(user) });
  return setCookie(res, sessionCookie(token, maxAge, isSecureRequest(ctx.req)));
}

async function handleChangePassword(ctx: Ctx) {
  const body = await ctx.body();
  const current = String(body.current ?? '');
  const next = String(body.next ?? '');
  if (next.length < 8) throw new ApiError(400, 'weak_password');
  if (next === '123456') throw new ApiError(400, 'default_password');
  if (next === current) throw new ApiError(400, 'same_password');

  const forced = ctx.identity.user.must_change_password === 1;
  if (!forced && !verifyPassword(current, ctx.identity.user.password_hash)) {
    throw new ApiError(401, 'wrong_password');
  }
  if (forced && current && !verifyPassword(current, ctx.identity.user.password_hash)) {
    throw new ApiError(401, 'wrong_password');
  }

  const updated = setPassword(ctx.identity.username, next, false);
  if (!updated) throw new ApiError(500, 'password_update_failed');
  const maxAge = sessionMaxAgeSeconds(false);
  const token = createSession(updated, { days: maxAge / 86400, device: 'password-change', ip: clientIpFromHeaders(ctx.req.headers) });
  const res = json({ ok: true, user: userPayload(updated) });
  return setCookie(res, sessionCookie(token, maxAge, isSecureRequest(ctx.req)));
}

/* ───────────── 路由表 ───────────── */

route('GET', /^\/healthz$/, () => ({ ok: true, version: '2.1.0', time: Date.now() }), { open: true });
route('GET', /^\/api\/v1\/health$/, () => ({ ok: true, version: '2.1.0', time: Date.now() }), { open: true });

route('GET', /^\/api\/v1\/auth\/me$/, (ctx) => authPayload(ctx.identity), { open: true });
route('POST', /^\/api\/v1\/auth\/login$/, handleLogin, { open: true });
route('POST', /^\/api\/v1\/auth\/register$/, handleRegister, { open: true });
route('POST', /^\/api\/v1\/auth\/logout$/, (ctx) => {
  const jti = jtiOfToken(parseCookie(ctx.req.headers.get('cookie'), SESSION_COOKIE));
  if (jti) revokeSessionByJti(jti);
  const res = json({ ok: true });
  return setCookie(res, clearedCookie(isSecureRequest(ctx.req)));
}, { open: true });
route('POST', /^\/api\/v1\/auth\/password$/, handleChangePassword);

route('GET', /^\/api\/v1\/auth\/sessions$/, (ctx) => ({
  ok: true,
  sessions: listSessions(ctx.identity.username).map(s => ({
    id: s.id, device: s.device, ip: s.ip, createdAt: s.created_at, lastSeenAt: s.last_seen_at, revoked: s.revoked_at != null,
  })),
}));
route('DELETE', /^\/api\/v1\/auth\/sessions\/(\d+)$/, (ctx, m) => ({ ok: revokeSession(ctx.identity.username, Number(m[1])) }));

route('GET', /^\/api\/v1\/sync\/state$/, (ctx) => syncState(ctx.identity.username, ctx.url.searchParams.get('app')));
route('GET', /^\/api\/v1\/sync\/pull$/, (ctx) => syncPull(
  ctx.identity.username,
  ctx.url.searchParams.get('app'),
  ctx.url.searchParams.get('since'),
  ctx.url.searchParams.get('limit'),
));
route('POST', /^\/api\/v1\/sync\/push$/, async (ctx) => syncPush(ctx.identity.username, await ctx.body()));
route('GET', /^\/api\/v1\/sync\/history$/, (ctx) => syncHistory(ctx.identity.username, {
  app: ctx.url.searchParams.get('app'),
  collection: ctx.url.searchParams.get('collection'),
  id: ctx.url.searchParams.get('id'),
  limit: ctx.url.searchParams.get('limit'),
}));
route('POST', /^\/api\/v1\/sync\/restore$/, async (ctx) => restoreVersion(ctx.identity.username, await ctx.body()));

route('GET', /^\/api\/v1\/backup\/export$/, (ctx) => exportBackup(ctx.identity.username, ctx.url.searchParams.get('app')));
route('POST', /^\/api\/v1\/backup\/import$/, async (ctx) => importBackup(ctx.identity.username, await ctx.body()));

/* ───────────── 管理端 ───────────── */

function publicUser(u: ReturnType<typeof findUser>) {
  if (!u) return null;
  return {
    username: u.username, role: u.role, disabled: u.disabled === 1,
    mustChangePassword: u.must_change_password === 1, createdAt: u.created_at, lastLoginAt: u.last_login_at,
  };
}

route('GET', /^\/api\/v1\/admin\/users$/, () => ({ ok: true, users: listUsers().map(publicUser) }), { admin: true });
route('POST', /^\/api\/v1\/admin\/users$/, async (ctx) => {
  const body = await ctx.body();
  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '');
  const role = body.role === 'admin' ? 'admin' : 'user';
  if (!/^[A-Za-z0-9_]{3,32}$/.test(username)) throw new ApiError(400, 'bad_username');
  if (password.length < 8) throw new ApiError(400, 'weak_password');
  if (findUser(username)) throw new ApiError(409, 'username_taken');
  return { ok: true, user: publicUser(createUser({ username, password, role, mustChange: false })) };
}, { admin: true });
route('PATCH', /^\/api\/v1\/admin\/users\/([^/]+)$/, async (ctx, m) => {
  const username = decodeURIComponent(m[1]);
  const user = findUser(username);
  if (!user) throw new ApiError(404, 'user_not_found');
  const body = await ctx.body();
  if (username.toLowerCase() === ctx.identity.username.toLowerCase() && body.disabled === true) {
    throw new ApiError(400, 'cannot_disable_self');
  }
  if (typeof body.disabled === 'boolean') setDisabled(username, body.disabled);
  if (typeof body.password === 'string' && body.password) {
    if (body.password.length < 8) throw new ApiError(400, 'weak_password');
    setPassword(username, body.password, !!body.mustChange);
  }
  return { ok: true, user: publicUser(findUser(username)) };
}, { admin: true });

route('GET', /^\/api\/v1\/admin\/settings$/, () => ({
  ok: true, mode: getMode(), registrationOpen: getRegistrationOpen(),
  inviteRequired: getInviteCode().length > 0, inviteCode: getInviteCode(),
}), { admin: true });
route('POST', /^\/api\/v1\/admin\/settings$/, async (ctx) => {
  const body = await ctx.body();
  if (body.mode === 'off' || body.mode === 'self' || body.mode === 'public') setMode(body.mode);
  if (typeof body.registrationOpen === 'boolean') setRegistrationOpen(body.registrationOpen);
  if (typeof body.inviteCode === 'string') setInviteCode(body.inviteCode.trim());
  return { ok: true, mode: getMode(), registrationOpen: getRegistrationOpen(), inviteRequired: getInviteCode().length > 0 };
}, { admin: true });

route('GET', /^\/api\/v1\/admin\/sessions$/, (ctx) => {
  const username = ctx.url.searchParams.get('username') || ctx.identity.username;
  return {
    ok: true,
    sessions: listSessions(username).map(s => ({
      id: s.id, device: s.device, ip: s.ip, createdAt: s.created_at, lastSeenAt: s.last_seen_at, revoked: s.revoked_at != null,
    })),
  };
}, { admin: true });
route('DELETE', /^\/api\/v1\/admin\/sessions\/(\d+)$/, (ctx, m) => ({ ok: revokeSession(ctx.identity.username, Number(m[1])) }), { admin: true });

route('GET', /^\/api\/v1\/admin\/tokens$/, (ctx) => ({ ok: true, tokens: listTokens(ctx.identity.username) }), { admin: true });
route('POST', /^\/api\/v1\/admin\/tokens$/, async (ctx) => {
  const body = await ctx.body();
  return { ok: true, ...createToken(ctx.identity.username, String(body.name ?? 'script').slice(0, 40)) };
}, { admin: true });
route('DELETE', /^\/api\/v1\/admin\/tokens\/(\d+)$/, (ctx, m) => ({ ok: revokeToken(ctx.identity.username, Number(m[1])) }), { admin: true });

/* ───────────── dispatch ───────────── */

export async function dispatch(req: Request, pathname: string, url: URL): Promise<Response> {
  ensureSeedOnce();
  const identity = identityFromRequest(req);

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.pattern.exec(pathname);
    if (!m) continue;
    if (!r.open && !identity) {
      return json({ ok: false, error: 'unauthenticated', message: messageOf('unauthenticated') }, 401);
    }
    if (r.admin && identity?.role !== 'admin') {
      return json({ ok: false, error: 'forbidden', message: messageOf('forbidden') }, 403);
    }
    const ctx: Ctx = {
      req,
      url,
      identity: identity as Identity,
      body: () => readJson(req),
    };
    try {
      const out = await r.handler(ctx, m);
      return out instanceof NextResponse ? out : json(out);
    } catch (err) {
      return fail(err);
    }
  }
  return json({ ok: false, error: 'not_found', message: messageOf('not_found') }, 404);
}
