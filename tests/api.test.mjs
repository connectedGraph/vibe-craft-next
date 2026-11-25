/**
 * API 契约测试：真实 HTTP + 真实 Next 生产服务（next start），不 mock 路由。
 * 断言全部以本仓 src/lib 的实际实现为准。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer, req, register, login, uniqueName, DEFAULT_ADMIN_PASSWORD,
} from './helpers.mjs';

const server = await startServer({ label: 'main' });
const BASE = server.base;

test.after(async () => { await server.stop(); });

const adminLogin = await login(BASE, 'admin', DEFAULT_ADMIN_PASSWORD);

/* ───────────── 1. 鉴权基础 ───────────── */

test('未登录访问 /sync/state 返回 401 与 unauthenticated 错误体', async () => {
  const res = await req(BASE, 'GET', '/api/v1/sync/state?app=demo');
  assert.equal(res.status, 401);
  assert.equal(res.data.ok, false);
  assert.equal(res.data.error, 'unauthenticated');
  assert.equal(typeof res.data.message, 'string');
  assert.ok(res.data.message.length > 0);
});

test('注册 / 登录 / me / logout 生命周期', async () => {
  // 用户名不合法
  const badName = await req(BASE, 'POST', '/api/v1/auth/register', { body: { username: 'ab', password: 'user-pass-123' } });
  assert.equal(badName.status, 400);
  assert.equal(badName.data.error, 'bad_username');

  // 弱密码
  const weak = await req(BASE, 'POST', '/api/v1/auth/register', { body: { username: 'alice', password: 'short' } });
  assert.equal(weak.status, 400);
  assert.equal(weak.data.error, 'weak_password');

  // 正常注册，服务端种 vc_session
  const reg = await register(BASE, 'alice', 'user-pass-123');
  assert.equal(reg.status, 200);
  assert.equal(reg.data.ok, true);
  assert.equal(reg.data.user.username, 'alice');
  assert.equal(reg.data.user.role, 'user');
  assert.ok(reg.cookie.startsWith('vc_session='));

  // 重复用户名（大小写不敏感）→ 409
  const dup = await req(BASE, 'POST', '/api/v1/auth/register', { body: { username: 'ALICE', password: 'user-pass-123' } });
  assert.equal(dup.status, 409);
  assert.equal(dup.data.error, 'username_taken');

  // 错误密码 401
  const bad = await login(BASE, 'alice', 'wrong-password');
  assert.equal(bad.status, 401);
  assert.equal(bad.data.error, 'invalid_credentials');

  // 正确密码拿到会话
  const ok = await login(BASE, 'alice', 'user-pass-123');
  assert.equal(ok.status, 200);
  assert.ok(ok.cookie.startsWith('vc_session='));

  const me = await req(BASE, 'GET', '/api/v1/auth/me', { cookie: ok.cookie });
  assert.equal(me.status, 200);
  assert.equal(me.data.user.username, 'alice');
  assert.equal(me.data.mode, 'public');

  // logout 清 Cookie 并吊销服务端会话
  const out = await req(BASE, 'POST', '/api/v1/auth/logout', { cookie: ok.cookie });
  assert.equal(out.status, 200);
  assert.ok(out.setCookie.some((c) => c.startsWith('vc_session=;') && /Max-Age=0/i.test(c)));

  // /auth/me 是 open 路由：会话失效后仍是 200，但 user 为 null（与代码一致，不是 401）
  const after = await req(BASE, 'GET', '/api/v1/auth/me', { cookie: ok.cookie });
  assert.equal(after.status, 200);
  assert.equal(after.data.user, null);
});

test('登录失败 5 次后锁定（保留原有登录限流，返回 429 + Retry-After）', async () => {
  const username = uniqueName('locky');
  assert.equal((await register(BASE, username)).status, 200);

  for (let i = 0; i < 5; i++) {
    const r = await login(BASE, username, 'definitely-wrong');
    assert.equal(r.status, 401);
  }
  const locked = await login(BASE, username, 'user-pass-123');
  assert.equal(locked.status, 429);
  assert.equal(locked.data.error, 'too_many_attempts');
  const retry = Number(locked.headers.get('retry-after'));
  assert.ok(Number.isFinite(retry) && retry > 0 && retry <= 15 * 60, `Retry-After 应接近 15 分钟，实际 ${retry}`);
});

/* ───────────── 2. 同步 ───────────── */

test('同步：push → pull → unchanged → 更新 → tombstone → 非法名字', async () => {
  const user = await register(BASE, uniqueName('syncer'));
  assert.equal(user.status, 200);
  const cookie = user.cookie;
  const app = 'sync-app';
  const t0 = Date.now() - 5000;

  // push 一条
  const push1 = await req(BASE, 'POST', '/api/v1/sync/push', {
    cookie,
    body: { app, deviceId: 'dev-a', ops: [{ collection: 'docs', id: 'd1', op: 'upsert', data: { id: 'd1', title: 'v1' }, updatedAt: t0 }] },
  });
  assert.equal(push1.status, 200);
  assert.equal(push1.data.accepted.length, 1);
  assert.equal(push1.data.conflicts.length, 0);
  const seq1 = push1.data.accepted[0].seq;
  assert.equal(typeof seq1, 'number');

  // pull 能拿到
  const pull1 = await req(BASE, 'GET', `/api/v1/sync/pull?app=${app}&since=0`, { cookie });
  assert.equal(pull1.status, 200);
  assert.equal(pull1.data.changes.length, 1);
  assert.equal(pull1.data.changes[0].id, 'd1');
  assert.equal(pull1.data.changes[0].op, 'upsert');
  assert.equal(pull1.data.changes[0].data.title, 'v1');
  assert.equal(pull1.data.changes[0].seq, seq1);
  assert.equal(pull1.data.hasMore, false);

  // 同内容同 updatedAt 再 push → unchanged
  const same = await req(BASE, 'POST', '/api/v1/sync/push', {
    cookie,
    body: { app, deviceId: 'dev-a', ops: [{ collection: 'docs', id: 'd1', data: { id: 'd1', title: 'v1' }, updatedAt: t0 }] },
  });
  assert.equal(same.status, 200);
  assert.equal(same.data.accepted.length, 1);
  assert.equal(same.data.accepted[0].unchanged, true);
  assert.equal(same.data.conflicts.length, 0);

  // 更新后 push → pull 得到新版本（pull 只回放每条记录的最新版本）
  const push2 = await req(BASE, 'POST', '/api/v1/sync/push', {
    cookie,
    body: { app, deviceId: 'dev-a', ops: [{ collection: 'docs', id: 'd1', data: { id: 'd1', title: 'v2' }, updatedAt: t0 + 1000 }] },
  });
  assert.equal(push2.status, 200);
  assert.equal(push2.data.accepted.length, 1);
  assert.equal(push2.data.accepted[0].unchanged, undefined);
  const seq2 = push2.data.accepted[0].seq;

  const pull2 = await req(BASE, 'GET', `/api/v1/sync/pull?app=${app}&since=0`, { cookie });
  assert.equal(pull2.data.changes.length, 1);
  assert.equal(pull2.data.changes[0].data.title, 'v2');
  assert.equal(pull2.data.changes[0].seq, seq2);

  // 增量拉取：since=seq2 已经没有更新
  const pull3 = await req(BASE, 'GET', `/api/v1/sync/pull?app=${app}&since=${seq2}`, { cookie });
  assert.equal(pull3.data.changes.length, 0);

  // 删除 → tombstone
  const del = await req(BASE, 'POST', '/api/v1/sync/push', {
    cookie,
    body: { app, deviceId: 'dev-a', ops: [{ collection: 'docs', id: 'd1', op: 'delete', updatedAt: t0 + 2000 }] },
  });
  assert.equal(del.status, 200);
  assert.equal(del.data.accepted.length, 1);

  const pullDel = await req(BASE, 'GET', `/api/v1/sync/pull?app=${app}&since=0`, { cookie });
  assert.equal(pullDel.data.changes.length, 1);
  assert.equal(pullDel.data.changes[0].op, 'delete');
  assert.equal(pullDel.data.changes[0].data, null);

  const state = await req(BASE, 'GET', `/api/v1/sync/state?app=${app}`, { cookie });
  assert.equal(state.data.count, 0);

  // 非法 app / collection / id
  const badApp = await req(BASE, 'GET', '/api/v1/sync/state?app=bad%20app', { cookie });
  assert.equal(badApp.status, 400);
  assert.equal(badApp.data.error, 'bad_app');

  const badCollection = await req(BASE, 'POST', '/api/v1/sync/push', {
    cookie,
    body: { app, ops: [{ collection: 'bad/collection', id: 'x', data: {} }] },
  });
  assert.equal(badCollection.status, 400);
  assert.equal(badCollection.data.error, 'bad_collection');

  const badId = await req(BASE, 'POST', '/api/v1/sync/push', {
    cookie,
    body: { app, ops: [{ collection: 'docs', id: 'bad id', data: {} }] },
  });
  assert.equal(badId.status, 400);
  assert.equal(badId.data.error, 'bad_id');

  const badOps = await req(BASE, 'POST', '/api/v1/sync/push', { cookie, body: { app, ops: 'nope' } });
  assert.equal(badOps.status, 400);
  assert.equal(badOps.data.error, 'bad_ops');

  const tooMany = await req(BASE, 'POST', '/api/v1/sync/push', {
    cookie,
    body: { app, ops: Array.from({ length: 501 }, (_, i) => ({ collection: 'docs', id: `o${i}`, data: { i } })) },
  });
  assert.equal(tooMany.status, 400);
  assert.equal(tooMany.data.error, 'too_many_ops');
});

test('同步：pull 分页 limit 与 hasMore', async () => {
  const user = await register(BASE, uniqueName('pager'));
  const cookie = user.cookie;
  const app = 'paging-app';
  const push = await req(BASE, 'POST', '/api/v1/sync/push', {
    cookie,
    body: {
      app,
      ops: [
        { collection: 'docs', id: 'a', data: { v: 1 }, updatedAt: Date.now() - 2000 },
        { collection: 'docs', id: 'b', data: { v: 2 }, updatedAt: Date.now() - 1000 },
      ],
    },
  });
  assert.equal(push.data.accepted.length, 2);

  const page1 = await req(BASE, 'GET', `/api/v1/sync/pull?app=${app}&since=0&limit=1`, { cookie });
  assert.equal(page1.data.changes.length, 1);
  assert.equal(page1.data.hasMore, true);
  const cursor = page1.data.now;

  const page2 = await req(BASE, 'GET', `/api/v1/sync/pull?app=${app}&since=${cursor}&limit=1`, { cookie });
  assert.equal(page2.data.changes.length, 1);
  assert.equal(page2.data.hasMore, false);
  assert.notEqual(page2.data.changes[0].id, page1.data.changes[0].id);
});

test('冲突：同一 updatedAt 推送不同内容，服务端保留旧版并回报 conflicts', async () => {
  const user = await register(BASE, uniqueName('conflicter'));
  const cookie = user.cookie;
  const app = 'conflict-app';
  const t = Date.now() - 3000;

  const first = await req(BASE, 'POST', '/api/v1/sync/push', {
    cookie,
    body: { app, ops: [{ collection: 'docs', id: 'c1', data: { title: 'A' }, updatedAt: t }] },
  });
  assert.equal(first.data.accepted.length, 1);

  // 相同 updatedAt、不同内容 → 冲突，服务端不变
  const second = await req(BASE, 'POST', '/api/v1/sync/push', {
    cookie,
    body: { app, ops: [{ collection: 'docs', id: 'c1', data: { title: 'B' }, updatedAt: t }] },
  });
  assert.equal(second.status, 200);
  assert.equal(second.data.accepted.length, 0);
  assert.equal(second.data.conflicts.length, 1);
  const conflict = second.data.conflicts[0];
  assert.equal(conflict.id, 'c1');
  assert.equal(conflict.server.data.title, 'A');
  assert.equal(conflict.server.updatedAt, t);
  assert.equal(conflict.server.deleted, false);

  const state = await req(BASE, 'GET', `/api/v1/sync/state?app=${app}`, { cookie });
  assert.equal(state.data.count, 1);

  // updatedAt 更新的一方获胜
  const third = await req(BASE, 'POST', '/api/v1/sync/push', {
    cookie,
    body: { app, ops: [{ collection: 'docs', id: 'c1', data: { title: 'B' }, updatedAt: t + 1 }] },
  });
  assert.equal(third.data.accepted.length, 1);
  const pull = await req(BASE, 'GET', `/api/v1/sync/pull?app=${app}&since=0`, { cookie });
  assert.equal(pull.data.changes[0].data.title, 'B');
});

/* ───────────── 3. 备份 / 历史 ───────────── */

test('备份：导出 → 新账号导入 → pull 还原；错误格式 400', async () => {
  const owner = await register(BASE, uniqueName('bakowner'));
  const app = 'backup-app';
  const push = await req(BASE, 'POST', '/api/v1/sync/push', {
    cookie: owner.cookie,
    body: {
      app,
      ops: [
        { collection: 'docs', id: 'b1', data: { id: 'b1', title: 'one' }, updatedAt: Date.now() - 2000 },
        { collection: 'docs', id: 'b2', data: { id: 'b2', title: 'two' }, updatedAt: Date.now() - 1000 },
      ],
    },
  });
  assert.equal(push.data.accepted.length, 2);

  const exp = await req(BASE, 'GET', `/api/v1/backup/export?app=${app}`, { cookie: owner.cookie });
  assert.equal(exp.status, 200);
  assert.equal(exp.data.format, 'vibe-craft-backup-v1');
  assert.equal(exp.data.count, 2);
  assert.equal(exp.data.records.length, 2);
  assert.ok(exp.data.records.every((r) => r.app === app && r.deleted === false));

  // 新账号导入
  const target = await register(BASE, uniqueName('baktarget'));
  const imp = await req(BASE, 'POST', '/api/v1/backup/import', {
    cookie: target.cookie,
    body: { mode: 'merge', records: exp.data.records },
  });
  assert.equal(imp.status, 200);
  assert.equal(imp.data.mode, 'merge');
  assert.equal(imp.data.imported, 2);
  assert.equal(imp.data.skipped, 0);

  const pulled = await req(BASE, 'GET', `/api/v1/sync/pull?app=${app}&since=0`, { cookie: target.cookie });
  assert.equal(pulled.data.changes.length, 2);
  const byId = Object.fromEntries(pulled.data.changes.map((c) => [c.id, c.data.title]));
  assert.deepEqual(byId, { b1: 'one', b2: 'two' });

  // 再导入一次 merge：已存在 → skipped
  const again = await req(BASE, 'POST', '/api/v1/backup/import', {
    cookie: target.cookie,
    body: { mode: 'merge', records: exp.data.records },
  });
  assert.equal(again.data.imported, 0);
  assert.equal(again.data.skipped, 2);

  // replace：旧记录被 tombstone，只剩新记录
  const replaced = await req(BASE, 'POST', '/api/v1/backup/import', {
    cookie: target.cookie,
    body: { mode: 'replace', records: [{ app, collection: 'docs', id: 'd3', data: { id: 'd3', title: 'only' } }] },
  });
  assert.equal(replaced.data.mode, 'replace');
  assert.equal(replaced.data.imported, 1);
  const state = await req(BASE, 'GET', `/api/v1/sync/state?app=${app}`, { cookie: target.cookie });
  assert.equal(state.data.count, 1);
  const afterReplace = await req(BASE, 'GET', `/api/v1/sync/pull?app=${app}&since=0`, { cookie: target.cookie });
  const statuses = Object.fromEntries(afterReplace.data.changes.map((c) => [c.id, c.op]));
  assert.deepEqual(statuses, { b1: 'delete', b2: 'delete', d3: 'upsert' });

  // 错误格式
  const bad = await req(BASE, 'POST', '/api/v1/backup/import', { cookie: target.cookie, body: { records: 'nope' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.error, 'bad_records');

  const badRecord = await req(BASE, 'POST', '/api/v1/backup/import', {
    cookie: target.cookie,
    body: { records: [{ app: 'bad app', collection: 'docs', id: 'x', data: {} }] },
  });
  assert.equal(badRecord.status, 400);
  assert.equal(badRecord.data.error, 'bad_app');
});

test('历史：/sync/history 与 /sync/restore 往返', async () => {
  const user = await register(BASE, uniqueName('hist'));
  const cookie = user.cookie;
  const app = 'history-app';
  const t = Date.now() - 5000;

  for (const [title, updatedAt] of [['v1', t], ['v2', t + 1000]]) {
    const r = await req(BASE, 'POST', '/api/v1/sync/push', {
      cookie,
      body: { app, deviceId: 'hist-dev', ops: [{ collection: 'docs', id: 'h1', data: { id: 'h1', title }, updatedAt }] },
    });
    assert.equal(r.status, 200);
  }

  const hist = await req(BASE, 'GET', `/api/v1/sync/history?app=${app}&collection=docs&id=h1`, { cookie });
  assert.equal(hist.status, 200);
  assert.equal(hist.data.versions.length, 2);
  assert.equal(hist.data.versions[0].data.title, 'v2');
  assert.equal(hist.data.versions[1].data.title, 'v1');
  assert.equal(hist.data.versions[1].deleted, false);
  assert.equal(hist.data.versions[1].deviceId, 'hist-dev');
  assert.equal(typeof hist.data.versions[1].seq, 'number');
  assert.equal(typeof hist.data.versions[1].createdAt, 'number');

  const target = hist.data.versions[1];
  const restore = await req(BASE, 'POST', '/api/v1/sync/restore', {
    cookie,
    body: { app, collection: 'docs', id: 'h1', seq: target.seq },
  });
  assert.equal(restore.status, 200);
  assert.equal(restore.data.ok, true);
  assert.ok(restore.data.seq > target.seq);

  const pull = await req(BASE, 'GET', `/api/v1/sync/pull?app=${app}&since=0`, { cookie });
  assert.equal(pull.data.changes.length, 1);
  assert.equal(pull.data.changes[0].data.title, 'v1');
  assert.equal(pull.data.changes[0].seq, restore.data.seq);

  // 不存在的版本 → 404
  const missing = await req(BASE, 'POST', '/api/v1/sync/restore', {
    cookie,
    body: { app, collection: 'docs', id: 'h1', seq: 999999999 },
  });
  assert.equal(missing.status, 404);
  assert.equal(missing.data.error, 'version_not_found');

  // 缺 id → 400
  const bad = await req(BASE, 'GET', `/api/v1/sync/history?app=${app}&collection=docs`, { cookie });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.error, 'bad_id');
});

/* ───────────── 4. 管理端 / 令牌 ───────────── */

test('管理端：普通用户 403，管理员可列用户/建用户/改设置', async () => {
  const alice = await login(BASE, 'alice', 'user-pass-123');
  assert.equal(alice.status, 200);

  const forbidden = await req(BASE, 'GET', '/api/v1/admin/users', { cookie: alice.cookie });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.data.error, 'forbidden');

  assert.equal(adminLogin.status, 200);
  const users = await req(BASE, 'GET', '/api/v1/admin/users', { cookie: adminLogin.cookie });
  assert.equal(users.status, 200);
  const names = users.data.users.map((u) => u.username);
  assert.ok(names.includes('admin'));
  assert.ok(names.includes('alice'));
  const admin = users.data.users.find((u) => u.username === 'admin');
  assert.equal(admin.role, 'admin');
  assert.equal(admin.disabled, false);

  const managed = uniqueName('managed');
  const created = await req(BASE, 'POST', '/api/v1/admin/users', {
    cookie: adminLogin.cookie,
    body: { username: managed, password: 'managed-pass-123', role: 'user' },
  });
  assert.equal(created.status, 200);
  assert.equal(created.data.user.username, managed);

  const weak = await req(BASE, 'POST', '/api/v1/admin/users', {
    cookie: adminLogin.cookie,
    body: { username: uniqueName('weak'), password: 'short' },
  });
  assert.equal(weak.status, 400);
  assert.equal(weak.data.error, 'weak_password');

  const dup = await req(BASE, 'POST', '/api/v1/admin/users', {
    cookie: adminLogin.cookie,
    body: { username: managed, password: 'managed-pass-123' },
  });
  assert.equal(dup.status, 409);
  assert.equal(dup.data.error, 'username_taken');

  const settings = await req(BASE, 'GET', '/api/v1/admin/settings', { cookie: adminLogin.cookie });
  assert.equal(settings.status, 200);
  assert.equal(settings.data.mode, 'public');
  assert.equal(settings.data.registrationOpen, true);

  // 禁用后不能登录
  const disable = await req(BASE, 'PATCH', `/api/v1/admin/users/${encodeURIComponent(managed)}`, {
    cookie: adminLogin.cookie,
    body: { disabled: true },
  });
  assert.equal(disable.status, 200);
  const disabledLogin = await login(BASE, managed, 'managed-pass-123');
  assert.equal(disabledLogin.status, 403);
  assert.equal(disabledLogin.data.error, 'account_disabled');

  // 恢复
  await req(BASE, 'PATCH', `/api/v1/admin/users/${encodeURIComponent(managed)}`, {
    cookie: adminLogin.cookie,
    body: { disabled: false },
  });
});

test('Bearer 令牌：创建 vck_ → 访问 sync → 吊销后 401', async () => {
  assert.equal(adminLogin.status, 200);

  const created = await req(BASE, 'POST', '/api/v1/admin/tokens', {
    cookie: adminLogin.cookie,
    body: { name: 'api-test' },
  });
  assert.equal(created.status, 200);
  assert.ok(created.data.token.startsWith('vck_'));
  assert.equal(typeof created.data.id, 'number');

  // 只用 Bearer，不带 Cookie
  const state = await req(BASE, 'GET', '/api/v1/sync/state?app=token-app', { token: created.data.token });
  assert.equal(state.status, 200);
  assert.equal(state.data.ok, true);

  // 列表不回显明文
  const list = await req(BASE, 'GET', '/api/v1/admin/tokens', { cookie: adminLogin.cookie });
  assert.equal(list.status, 200);
  const row = list.data.tokens.find((t) => t.id === created.data.id);
  assert.ok(row);
  assert.equal(row.token, undefined);
  assert.equal(row.revoked_at, null);

  const revoked = await req(BASE, 'DELETE', `/api/v1/admin/tokens/${created.data.id}`, { cookie: adminLogin.cookie });
  assert.equal(revoked.status, 200);
  assert.equal(revoked.data.ok, true);

  const after = await req(BASE, 'GET', '/api/v1/sync/state?app=token-app', { token: created.data.token });
  assert.equal(after.status, 401);
  assert.equal(after.data.error, 'unauthenticated');

  // 本仓令牌路由在 /api/v1/admin/tokens，旧的 /api/v1/tokens 不存在
  const legacy = await req(BASE, 'POST', '/api/v1/tokens', { cookie: adminLogin.cookie, body: { name: 'x' } });
  assert.equal(legacy.status, 404);
  assert.equal(legacy.data.error, 'not_found');

  const bogus = await req(BASE, 'GET', '/api/v1/sync/state?app=token-app', { token: `vck_${'x'.repeat(40)}` });
  assert.equal(bogus.status, 401);
});

/* ───────────── 5. 限流与体积上限 ───────────── */

function pushBody(app, id) {
  return {
    app,
    deviceId: 'rl-dev',
    ops: [{ collection: 'docs', id, data: { id }, updatedAt: Date.now() - 1000 }],
  };
}

test('限流：低额度实例下 push/pull/tokens/create 超限返回 429 + Retry-After', async (t) => {
  const rl = await startServer({
    label: 'ratelimit',
    env: {
      RATE_LIMIT: 'on',
      RL_SYNC_PUSH_PER_MIN: '3',
      RL_SYNC_PULL_PER_MIN: '2',
      RL_TOKENS_CREATE_PER_HOUR: '1',
    },
  });
  t.after(async () => { await rl.stop(); });

  const user = await register(rl.base, uniqueName('rlu'));
  assert.equal(user.status, 200);

  // 前 3 次 push 正常
  for (let i = 0; i < 3; i++) {
    const r = await req(rl.base, 'POST', '/api/v1/sync/push', { cookie: user.cookie, body: pushBody('rl-app', `p${i}`) });
    assert.equal(r.status, 200, `第 ${i + 1} 次 push 应通过`);
  }

  // 第 4 次 429
  const limited = await req(rl.base, 'POST', '/api/v1/sync/push', { cookie: user.cookie, body: pushBody('rl-app', 'p3') });
  assert.equal(limited.status, 429);
  assert.equal(limited.data.ok, false);
  assert.equal(limited.data.error, 'too_many_attempts');
  assert.equal(typeof limited.data.message, 'string');
  const retry = Number(limited.headers.get('retry-after'));
  assert.ok(Number.isInteger(retry) && retry >= 1 && retry <= 61, `Retry-After 应为 1–61 秒，实际 ${retry}`);

  // 键按用户隔离：另一个用户不受影响
  const other = await register(rl.base, uniqueName('rlu2'));
  assert.equal(other.status, 200);
  const otherPush = await req(rl.base, 'POST', '/api/v1/sync/push', { cookie: other.cookie, body: pushBody('rl-app', 'o1') });
  assert.equal(otherPush.status, 200);

  // pull 额度 2/分钟
  for (let i = 0; i < 2; i++) {
    const r = await req(rl.base, 'GET', '/api/v1/sync/pull?app=rl-app&since=0', { cookie: user.cookie });
    assert.equal(r.status, 200);
  }
  const pullLimited = await req(rl.base, 'GET', '/api/v1/sync/pull?app=rl-app&since=0', { cookie: user.cookie });
  assert.equal(pullLimited.status, 429);
  assert.equal(pullLimited.data.error, 'too_many_attempts');
  assert.ok(Number(pullLimited.headers.get('retry-after')) >= 1);

  // 管理端令牌创建 1/小时
  const admin = await login(rl.base, 'admin', DEFAULT_ADMIN_PASSWORD);
  assert.equal(admin.status, 200);
  const token1 = await req(rl.base, 'POST', '/api/v1/admin/tokens', { cookie: admin.cookie, body: { name: 'one' } });
  assert.equal(token1.status, 200);
  const token2 = await req(rl.base, 'POST', '/api/v1/admin/tokens', { cookie: admin.cookie, body: { name: 'two' } });
  assert.equal(token2.status, 429);
  assert.equal(token2.data.error, 'too_many_attempts');
});

test('RATE_LIMIT=off 时连续请求不触发限流', async () => {
  const user = await register(BASE, uniqueName('off'));
  assert.equal(user.status, 200);
  for (let i = 0; i < 6; i++) {
    const r = await req(BASE, 'POST', '/api/v1/sync/push', { cookie: user.cookie, body: pushBody('off-app', `q${i}`) });
    assert.equal(r.status, 200, `RATE_LIMIT=off 下第 ${i + 1} 次 push 不应被限流`);
  }
});

test('体积上限：sync/push 收紧到 2MB 返回 413，backup/import 仍可用 8MB 上限', async () => {
  const user = await register(BASE, uniqueName('big'));
  assert.equal(user.status, 200);

  const oversized = 'x'.repeat(2 * 1024 * 1024 + 256);
  const tooBig = await req(BASE, 'POST', '/api/v1/sync/push', {
    cookie: user.cookie,
    body: { app: 'big-app', deviceId: 'big', ops: [{ collection: 'docs', id: 'big', data: { blob: oversized }, updatedAt: Date.now() }] },
  });
  assert.equal(tooBig.status, 413);
  assert.equal(tooBig.data.error, 'payload_too_large');

  // 同样的 2MB+ 走 backup/import 应该被接受（阈值仍是 8MB）
  const blob = 'y'.repeat(2 * 1024 * 1024 + 4096);
  const imported = await req(BASE, 'POST', '/api/v1/backup/import', {
    cookie: user.cookie,
    body: { records: [{ app: 'big-app', collection: 'docs', id: 'bigbak', data: { blob } }] },
  });
  assert.equal(imported.status, 200);
  assert.equal(imported.data.imported, 1);
});
