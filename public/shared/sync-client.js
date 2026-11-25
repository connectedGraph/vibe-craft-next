/**
 * VibeSync — 纯前端工具的云同步客户端
 *
 * 设计：localStorage 仍是本地真源；同步只负责设备间增量同步与备份。
 * 详见 docs/SYNC-DESIGN.md
 */
(function (global) {
  'use strict';

  // 接入同步的页面顺便注册 service worker（离线外壳）
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    global.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }

  const CFG_KEY = 'vibesync:config:v1';
  const STATE_KEY = 'vibesync:state:v1';
  const CONFLICT_KEY = 'vibesync:conflicts:v1';
  const SNAP_PREFIX = 'vibesync:snapshot:';
  const DEFAULTS = {
    enabled: false,
    server: '',
    token: '',
    deviceId: '',
    intervalMs: 5000,
  };

  const listeners = new Set();
  let adapter = null;
  let timer = null;
  let running = false;
  let lastSnapshot = {};   // collection -> id -> { h, updatedAt }
  let status = { phase: 'off', lastSyncAt: 0, lastError: null, pending: 0, authUser: null };
  // 同源账号模式：后端托管前端时自动启用，靠 HttpOnly Cookie 认证，不需要手动填 token
  let account = { available: false, mode: null, user: null, registrationOpen: false };

  function uid() {
    return Math.random().toString(36).slice(2, 10);
  }

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  }

  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn('[vibesync] write failed', e); }
  }

  function loadConfig() {
    const cfg = { ...DEFAULTS, ...readJSON(CFG_KEY, {}) };
    if (!cfg.deviceId) {
      cfg.deviceId = 'dev_' + uid();
      writeJSON(CFG_KEY, cfg);
    }
    return cfg;
  }

  function loadState() {
    return readJSON(STATE_KEY, { cursors: {}, lastSyncAt: 0 });
  }

  function saveState(s) {
    writeJSON(STATE_KEY, s);
  }

  function emit() {
    for (const fn of listeners) {
      try { fn(status); } catch (e) { console.warn(e); }
    }
  }

  function setStatus(patch) {
    status = { ...status, ...patch };
    emit();
  }

  // ---------- snapshot ----------

  function getCollections() {
    return (adapter && adapter.collections) || {};
  }

  // FNV-1a，够用且省 localStorage 空间
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function loadSnapshot() {
    if (!adapter) return {};
    return readJSON(SNAP_PREFIX + adapter.app, {});
  }

  function saveSnapshot(snap) {
    if (!adapter) return;
    // 只持久化哈希与时间戳，避免 localStorage 里存两份数据
    const slim = {};
    for (const [col, map] of Object.entries(snap)) {
      slim[col] = {};
      for (const [id, rec] of Object.entries(map)) {
        slim[col][id] = { h: rec.h, updatedAt: rec.updatedAt };
      }
    }
    writeJSON(SNAP_PREFIX + adapter.app, slim);
  }

  function computeSnapshot() {
    const snap = {};
    for (const [name, col] of Object.entries(getCollections())) {
      const map = {};
      let list = [];
      try { list = col.read() || []; } catch (e) { console.warn('[vibesync] read failed', name, e); }
      for (const rec of list) {
        const id = col.getId(rec);
        if (!id) continue;
        const json = JSON.stringify(rec);
        map[String(id)] = {
          h: hash(json),
          json,
          updatedAt: Number(col.getUpdatedAt(rec)) || 0,
        };
      }
      snap[name] = map;
    }
    return snap;
  }

  function diffSnapshots(prev, curr) {
    const ops = [];
    for (const [name] of Object.entries(getCollections())) {
      const p = prev[name] || {};
      const c = curr[name] || {};
      const col = getCollections()[name];

      for (const [id, rec] of Object.entries(c)) {
        const old = p[id];
        if (!old || old.h !== rec.h) {
          const ts = Math.max(Date.now(), (old ? old.updatedAt : 0) + 1, rec.updatedAt || 0);
          ops.push({
            collection: name,
            id,
            op: 'upsert',
            data: JSON.parse(rec.json),
            updatedAt: ts,
          });
        }
      }
      for (const id of Object.keys(p)) {
        if (!c[id]) {
          ops.push({
            collection: name,
            id,
            op: 'delete',
            updatedAt: Math.max(Date.now(), (p[id] ? p[id].updatedAt : 0) + 1),
          });
        }
      }
    }
    return ops;
  }

  // ---------- http ----------

  async function probeAccount() {
    if (!/^https?:$/.test(location.protocol)) return null;
    try {
      const res = await fetch('/api/v1/auth/me', { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      account = {
        available: true,
        mode: data.mode,
        user: data.user || null,
        registrationOpen: !!data.registrationOpen,
      };
      return account;
    } catch {
      return null;
    }
  }

  function accountReady() {
    return account.available && (account.mode === 'off' || !!account.user);
  }

  async function api(method, path, body) {
    const cfg = loadConfig();
    const accountMode = !cfg.server && account.available;
    if (!accountMode && (!cfg.server || !cfg.token)) throw new Error('sync_not_configured');
    const url = (cfg.server || '').replace(/\/+$/, '') + path;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(url, {
        method,
        credentials: accountMode ? 'same-origin' : 'include',
        headers: {
          ...(cfg.token && !accountMode ? { 'Authorization': 'Bearer ' + cfg.token } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      let payload = null;
      try { payload = await res.json(); } catch {}
      if (!res.ok || !payload || payload.ok === false) {
        const code = payload && payload.error ? payload.error : 'http_' + res.status;
        throw new Error(code);
      }
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  // ---------- conflict ----------

  function noteConflict(collection, id, localData, serverData) {
    const list = readJSON(CONFLICT_KEY, []);
    list.push({
      at: Date.now(),
      app: adapter.app,
      collection,
      id,
      local: localData,
      server: serverData,
    });
    // 最多保留 200 条，避免撑爆 localStorage
    writeJSON(CONFLICT_KEY, list.slice(-200));
  }

  async function handleConflicts(conflicts) {
    if (!conflicts || !conflicts.length) return;
    for (const c of conflicts) {
      const col = getCollections()[c.collection];
      if (!col) continue;
      const local = (col.read() || []).find(r => String(col.getId(r)) === c.id);
      noteConflict(c.collection, c.id, local || null, c.server.data);

      if (typeof adapter.makeConflict === 'function') {
        try {
          adapter.makeConflict(c.collection, local, c.server);
        } catch (e) { console.warn('[vibesync] makeConflict failed', e); }
      }
      if (c.server && !c.server.deleted) {
        applyIncoming(c.collection, [{
          id: c.id,
          op: 'upsert',
          data: c.server.data,
          updatedAt: c.server.updatedAt,
        }]);
      }
    }
    notifyApplied();
  }

  // ---------- pull / push ----------

  function applyIncoming(collection, changes) {
    const col = getCollections()[collection];
    if (!col || typeof col.applyChanges !== 'function') return false;
    try { return !!col.applyChanges(changes); }
    catch (e) { console.warn('[vibesync] applyChanges failed', collection, e); return false; }
  }

  function notifyApplied() {
    if (typeof adapter.onApplied === 'function') {
      try { adapter.onApplied(); } catch (e) { console.warn('[vibesync] onApplied failed', e); }
    }
  }

  async function pull() {
    const cfg = loadConfig();
    const st = loadState();
    let since = st.cursors[adapter.app] || 0;
    let hasMore = true;
    let applied = false;

    while (hasMore) {
      const res = await api('GET', `/api/v1/sync/pull?app=${encodeURIComponent(adapter.app)}&since=${since}&limit=500`);
      const byCollection = {};
      for (const ch of res.changes || []) {
        const localTs = getLocalUpdatedAt(ch.collection, ch.id);
        if (ch.updatedAt > localTs) {
          (byCollection[ch.collection] || (byCollection[ch.collection] = [])).push({
            id: ch.id,
            op: ch.op,
            data: ch.data,
            updatedAt: ch.updatedAt,
          });
        }
      }
      for (const [name, changes] of Object.entries(byCollection)) {
        if (applyIncoming(name, changes)) applied = true;
      }
      since = res.now;
      hasMore = !!res.hasMore;
    }

    st.cursors[adapter.app] = since;
    st.lastSyncAt = Date.now();
    saveState(st);

    if (applied) notifyApplied();
    return applied;
  }

  function getLocalUpdatedAt(collection, id) {
    const col = getCollections()[collection];
    if (!col) return -1;
    const rec = (col.read() || []).find(r => String(col.getId(r)) === String(id));
    if (!rec) return -1;
    return Number(col.getUpdatedAt(rec)) || 0;
  }

  async function push(ops) {
    const cfg = loadConfig();
    const res = await api('POST', '/api/v1/sync/push', {
      app: adapter.app,
      deviceId: cfg.deviceId,
      ops,
    });
    await handleConflicts(res.conflicts);
    return res;
  }

  // ---------- main loop ----------

  async function tick(opts) {
    if (!adapter || running) return;
    const cfg = loadConfig();
    const accountMode = !cfg.server && account.available;

    if (accountMode && !accountReady()) {
      setStatus({ phase: 'login-required', pending: 0, authUser: null });
      return;
    }
    if (!accountMode && (!cfg.enabled || !cfg.server || !cfg.token)) {
      setStatus({ phase: 'off', pending: 0 });
      return;
    }
    running = true;
    setStatus({ phase: 'syncing', lastError: null });
    try {
      const curr = computeSnapshot();
      const ops = diffSnapshots(lastSnapshot, curr);
      setStatus({ pending: ops.length });

      if (ops.length) {
        await push(ops);
      }
      await pull();

      lastSnapshot = computeSnapshot();
      saveSnapshot(lastSnapshot);
      setStatus({ phase: 'idle', lastSyncAt: Date.now(), pending: 0, authUser: account.user ? account.user.username : null });
    } catch (e) {
      console.warn('[vibesync] sync failed', e);
      setStatus({ phase: 'error', lastError: e && e.message ? e.message : String(e) });
    } finally {
      running = false;
    }
  }

  function startTimer() {
    stopTimer();
    const cfg = loadConfig();
    if (!cfg.enabled && !account.available) return;
    timer = setInterval(() => tick(), Math.max(2000, Number(cfg.intervalMs) || 5000));
  }

  function stopTimer() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  function syncTarget() {
    const cfg = loadConfig();
    const accountMode = !cfg.server && account.available;
    return {
      accountMode,
      url: (cfg.server || '').replace(/\/+$/, '') + '/api/v1/sync/push',
      headers: {
        ...(cfg.token && !accountMode ? { 'Authorization': 'Bearer ' + cfg.token } : {}),
        'Content-Type': 'application/json',
      },
      credentials: accountMode ? 'same-origin' : 'include',
      ready: accountMode ? accountReady() : (cfg.enabled && cfg.server && cfg.token),
      deviceId: cfg.deviceId,
    };
  }

  // 页面隐藏/关闭前尽量同步一次
  function flushBeforeUnload() {
    const target = syncTarget();
    if (!target.ready) return;
    const curr = computeSnapshot();
    const ops = diffSnapshots(lastSnapshot, curr);
    if (!ops.length) return;
    try {
      fetch(target.url, {
        method: 'POST',
        credentials: target.credentials,
        headers: target.headers,
        body: JSON.stringify({ app: adapter.app, deviceId: target.deviceId, ops }),
        keepalive: true,
      }).catch(() => {});
    } catch (e) { /* 忽略 */ }
  }

  // ---------- public api ----------

  const VibeSync = {
    /**
     * 注册一个工具。adapter：
     * {
     *   app: 'prompt-capsule',
     *   collections: {
     *     docs: {
     *       read(): array,
     *       getId(rec): string,
     *       getUpdatedAt(rec): number,
     *       applyChanges(changes): boolean,
     *     }
     *   },
     *   makeConflict?(collection, localRecord, serverRecord),
     *   onApplied?(),
     *   onStatus?(status),
     * }
     */
    attach(config) {
      adapter = config;
      lastSnapshot = loadSnapshot();
      if (typeof config.onStatus === 'function') listeners.add(config.onStatus);
      const cfg = loadConfig();
      setStatus({
        phase: cfg.enabled ? 'idle' : 'off',
        lastSyncAt: loadState().lastSyncAt || 0,
        authUser: null,
      });

      // 同源后端可用时自动进入账号模式（Cookie 会话），否则回退到手动 server+token
      probeAccount().then(() => {
        if (account.available) {
          const ready = accountReady();
          setStatus({
            phase: ready ? 'idle' : 'login-required',
            authUser: account.user ? account.user.username : null,
          });
        }
        startTimer();
        if (accountReady() || cfg.enabled) setTimeout(() => tick(), 800);
      });

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') tick();
      });
      global.addEventListener('online', () => tick());
      global.addEventListener('beforeunload', flushBeforeUnload);
      return this;
    },

    getConfig: loadConfig,
    getAccount: () => ({ ...account }),

    configure(patch) {
      const prev = loadConfig();
      const cfg = { ...prev, ...patch };
      writeJSON(CFG_KEY, cfg);
      if (cfg.enabled || account.available) startTimer(); else stopTimer();
      setStatus({ phase: cfg.enabled || accountReady() ? 'idle' : 'off', lastError: null });

      const serverChanged = String(prev.server || '').replace(/\/+$/, '') !== String(cfg.server || '').replace(/\/+$/, '');
      if (serverChanged) {
        // 换服务器等于换一份数据源：清空游标与快照，下次同步按全量合并
        const st = loadState();
        delete st.cursors[adapter.app];
        saveState(st);
        lastSnapshot = {};
        saveSnapshot({});
      }

      if (cfg.enabled || accountReady()) setTimeout(() => tick(), 300);
      return cfg;
    },

    async testConnection(overrides) {
      const cfg = { ...loadConfig(), ...(overrides || {}) };
      const appName = (adapter && adapter.app) || 'prompt-capsule';

      // 账号模式：直接问同源后端
      if (!cfg.server && account.available) {
        const res = await fetch(`/api/v1/sync/state?app=${encodeURIComponent(appName)}`, { credentials: 'same-origin' });
        const state = await res.json();
        if (!res.ok || state.ok === false) throw new Error(state && state.error ? state.error : 'auth_failed');
        return { health: { ok: true }, state };
      }

      const base = String(cfg.server || '').replace(/\/+$/, '');
      if (!base) throw new Error('server_required');
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(base + '/healthz', { signal: controller.signal });
        if (!res.ok) throw new Error('health_failed');
        const health = await res.json();
        if (!cfg.token) throw new Error('token_required');
        const stateRes = await fetch(base + `/api/v1/sync/state?app=${encodeURIComponent(appName)}`, {
          headers: { 'Authorization': 'Bearer ' + cfg.token },
          signal: controller.signal,
        });
        const state = await stateRes.json();
        if (!stateRes.ok || state.ok === false) {
          throw new Error(state && state.error ? state.error : 'auth_failed');
        }
        return { health, state };
      } finally { clearTimeout(t); }
    },

    logout: async () => {
      await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
      account = { available: account.available, mode: account.mode, user: null, registrationOpen: account.registrationOpen };
      stopTimer();
      setStatus({ phase: account.mode === 'off' ? 'idle' : 'login-required', authUser: null });
      if (location.protocol === 'http:' || location.protocol === 'https:') {
        const next = encodeURIComponent(location.pathname + location.search);
        location.href = `/login.html?next=${next}`;
      }
    },

    loginUrl: (next) => `/login.html?next=${encodeURIComponent(next || (location.pathname + location.search))}`,

    syncNow: () => tick({ manual: true }),

    getStatus: () => ({ ...status }),

    getConflicts: () => readJSON(CONFLICT_KEY, []),

    clearConflicts: () => writeJSON(CONFLICT_KEY, []),

    /** 清空游标后重新全量拉取，并把本地独有内容推上去（双向合并，不删除本地） */
    async restoreFromCloud() {
      const st = loadState();
      st.cursors[adapter.app] = 0;
      saveState(st);
      lastSnapshot = {};
      saveSnapshot({});
      await tick();
    },
  };

  global.VibeSync = VibeSync;
})(window);
