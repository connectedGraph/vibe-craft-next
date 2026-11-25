import { getDb } from './db';
import { ApiError } from './errors';
import { requireName } from './http';

const MAX_OPS = 500;
const MAX_PULL = 1000;
const CLOCK_SKEW = 24 * 60 * 60 * 1000;

const stmts = {
  getRecord: () => getDb().prepare('SELECT * FROM records WHERE user_id = ? AND app = ? AND collection = ? AND id = ?'),
  maxSeq: () => getDb().prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM changes WHERE user_id = ? AND app = ?'),
  countRecords: () => getDb().prepare('SELECT COUNT(*) AS n FROM records WHERE user_id = ? AND app = ? AND deleted = 0'),
  lastUpdated: () => getDb().prepare('SELECT COALESCE(MAX(updated_at), 0) AS t FROM records WHERE user_id = ? AND app = ?'),
  upsertRecord: () => getDb().prepare(`
    INSERT INTO records (user_id, app, collection, id, data, updated_at, deleted, seq, device_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, app, collection, id) DO UPDATE SET
      data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted,
      seq = excluded.seq, device_id = excluded.device_id
  `),
  insertChange: () => getDb().prepare(`
    INSERT INTO changes (user_id, app, collection, id, data, updated_at, deleted, device_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  lastRowId: () => getDb().prepare('SELECT last_insert_rowid() AS s'),
  pullChanges: () => getDb().prepare(`
    SELECT c.collection, c.id, c.data, c.updated_at, c.seq, c.deleted
    FROM changes c
    JOIN records r ON r.user_id = c.user_id AND r.app = c.app AND r.collection = c.collection AND r.id = c.id
    WHERE c.user_id = ? AND c.app = ? AND c.seq > ? AND r.seq = c.seq
    ORDER BY c.seq ASC LIMIT ?
  `),
};

function safeParse(text: string | null): unknown {
  if (text === null || text === undefined) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function normalizeUpdatedAt(value: number, now: number): number {
  if (!Number.isFinite(value) || value <= 0) return now;
  if (value > now + CLOCK_SKEW) return now;
  if (value < now - CLOCK_SKEW) return now - CLOCK_SKEW;
  return Math.floor(value);
}

export function syncState(userId: string, appRaw: string | null) {
  const app = requireName(appRaw, 'app');
  return {
    ok: true,
    seq: (stmts.maxSeq().get(userId, app) as { seq: number }).seq,
    count: (stmts.countRecords().get(userId, app) as { n: number }).n,
    updatedAt: (stmts.lastUpdated().get(userId, app) as { t: number }).t,
  };
}

export function syncPull(userId: string, appRaw: string | null, sinceRaw: string | null, limitRaw: string | null) {
  const app = requireName(appRaw, 'app');
  const since = Math.max(0, Number(sinceRaw || 0) | 0);
  const limit = Math.min(MAX_PULL, Math.max(1, Number(limitRaw || 500) | 0));

  const rows = stmts.pullChanges().all(userId, app, since, limit + 1) as unknown as {
    collection: string; id: string; data: string | null; updated_at: number; seq: number; deleted: number;
  }[];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return {
    ok: true,
    now: page.length ? page[page.length - 1].seq : Math.max(since, (stmts.maxSeq().get(userId, app) as { seq: number }).seq),
    hasMore,
    changes: page.map(r => ({
      collection: r.collection,
      id: r.id,
      op: r.deleted ? 'delete' : 'upsert',
      data: r.deleted ? null : safeParse(r.data),
      updatedAt: r.updated_at,
      seq: r.seq,
    })),
  };
}

export function syncPush(userId: string, body: Record<string, unknown>) {
  const app = requireName(body.app, 'app');
  const deviceId = typeof body.deviceId === 'string' ? body.deviceId.slice(0, 64) : 'unknown';
  if (!Array.isArray(body.ops)) throw new ApiError(400, 'bad_ops');
  const ops = body.ops as Record<string, unknown>[];
  if (ops.length === 0) return { ok: true, now: (stmts.maxSeq().get(userId, app) as { seq: number }).seq, accepted: [], conflicts: [] };
  if (ops.length > MAX_OPS) throw new ApiError(400, 'too_many_ops');

  const now = Date.now();
  const accepted: unknown[] = [];
  const conflicts: unknown[] = [];

  getDb().exec('BEGIN IMMEDIATE');
  try {
    for (const raw of ops) {
      const collection = requireName(raw.collection, 'collection');
      const id = requireName(raw.id, 'id');
      const op = raw.op === 'delete' ? 'delete' : 'upsert';
      const updatedAt = normalizeUpdatedAt(Number(raw.updatedAt), now);
      const deleted = op === 'delete' ? 1 : 0;
      const data = deleted ? null : (raw.data === undefined ? null : JSON.stringify(raw.data));

      const existing = stmts.getRecord().get(userId, app, collection, id) as
        | { data: string | null; updated_at: number; deleted: number; seq: number } | undefined;

      if (existing && existing.updated_at >= updatedAt) {
        const sameContent = deleted ? !!existing.deleted : (!existing.deleted && existing.data === data);
        if (sameContent) {
          accepted.push({ collection, id, seq: existing.seq, unchanged: true });
          continue;
        }
        conflicts.push({
          collection, id,
          server: {
            data: existing.deleted ? null : safeParse(existing.data),
            updatedAt: existing.updated_at,
            deleted: !!existing.deleted,
            seq: existing.seq,
          },
        });
        continue;
      }

      stmts.insertChange().run(userId, app, collection, id, data, updatedAt, deleted, deviceId, now);
      const realSeq = (stmts.lastRowId().get() as { s: number }).s;
      stmts.upsertRecord().run(userId, app, collection, id, data, updatedAt, deleted, realSeq, deviceId);
      accepted.push({ collection, id, seq: realSeq });
    }
    getDb().exec('COMMIT');
    return { ok: true, now: (stmts.maxSeq().get(userId, app) as { seq: number }).seq, accepted, conflicts };
  } catch (err) {
    try { getDb().exec('ROLLBACK'); } catch {}
    throw err;
  }
}

export function exportBackup(userId: string, appRaw: string | null) {
  const app = appRaw || '';
  const d = getDb();
  const rows = app
    ? d.prepare('SELECT app, collection, id, data, updated_at, deleted FROM records WHERE user_id = ? AND app = ? ORDER BY app, collection, id').all(userId, app)
    : d.prepare('SELECT app, collection, id, data, updated_at, deleted FROM records WHERE user_id = ? ORDER BY app, collection, id').all(userId);
  const list = rows as unknown as { app: string; collection: string; id: string; data: string | null; updated_at: number; deleted: number }[];
  return {
    ok: true,
    format: 'vibe-craft-backup-v1',
    exportedAt: Date.now(),
    user: userId,
    app: app || null,
    count: list.length,
    records: list.map(r => ({
      app: r.app,
      collection: r.collection,
      id: r.id,
      data: r.deleted ? null : safeParse(r.data),
      updatedAt: r.updated_at,
      deleted: !!r.deleted,
    })),
  };
}

export function importBackup(userId: string, body: Record<string, unknown>) {
  const records = body.records;
  if (!Array.isArray(records)) throw new ApiError(400, 'bad_records');
  if (records.length > 20000) throw new ApiError(413, 'too_many_records');
  const mode = body.mode === 'replace' ? 'replace' : 'merge';
  const now = Date.now();
  let imported = 0;
  let skipped = 0;

  getDb().exec('BEGIN IMMEDIATE');
  try {
    if (mode === 'replace') {
      const apps = [...new Set((records as Record<string, unknown>[])
        .map(r => r.app || body.app)
        .filter((a): a is string => typeof a === 'string' && /^[a-zA-Z0-9._-]{1,64}$/.test(a)))];
      for (const app of apps) {
        const live = getDb().prepare('SELECT collection, id FROM records WHERE user_id = ? AND app = ? AND deleted = 0').all(userId, app) as unknown as { collection: string; id: string }[];
        for (const r of live) {
          stmts.insertChange().run(userId, app, r.collection, r.id, null, now, 1, 'restore', now);
          const seq = (stmts.lastRowId().get() as { s: number }).s;
          stmts.upsertRecord().run(userId, app, r.collection, r.id, null, now, 1, seq, 'restore');
        }
      }
    }

    for (const raw of records as Record<string, unknown>[]) {
      const app = requireName(raw.app || body.app, 'app');
      const collection = requireName(raw.collection, 'collection');
      const id = requireName(raw.id, 'id');
      const deleted = raw.deleted ? 1 : 0;
      const existing = stmts.getRecord().get(userId, app, collection, id);
      if (mode === 'merge' && existing) { skipped++; continue; }
      const data = deleted ? null : JSON.stringify(raw.data === undefined ? null : raw.data);
      stmts.insertChange().run(userId, app, collection, id, data, now, deleted, 'restore', now);
      const seq = (stmts.lastRowId().get() as { s: number }).s;
      stmts.upsertRecord().run(userId, app, collection, id, data, now, deleted, seq, 'restore');
      imported++;
    }
    getDb().exec('COMMIT');
  } catch (err) {
    try { getDb().exec('ROLLBACK'); } catch {}
    throw err;
  }
  return { ok: true, mode, imported, skipped };
}

export function syncHistory(userId: string, params: { app: string | null; collection: string | null; id: string | null; limit: string | null }) {
  const app = requireName(params.app, 'app');
  const collection = requireName(params.collection, 'collection');
  const id = requireName(params.id, 'id');
  const limit = Math.min(200, Math.max(1, Number(params.limit || 50) | 0));
  const rows = getDb().prepare(`
    SELECT seq, data, updated_at, deleted, device_id, created_at FROM changes
    WHERE user_id = ? AND app = ? AND collection = ? AND id = ? ORDER BY seq DESC LIMIT ?
  `).all(userId, app, collection, id, limit) as unknown as {
    seq: number; data: string | null; updated_at: number; deleted: number; device_id: string | null; created_at: number;
  }[];
  return {
    ok: true,
    versions: rows.map(r => ({
      seq: r.seq,
      data: r.deleted ? null : safeParse(r.data),
      updatedAt: r.updated_at,
      deleted: !!r.deleted,
      deviceId: r.device_id,
      createdAt: r.created_at,
    })),
  };
}

export function restoreVersion(userId: string, body: Record<string, unknown>) {
  const app = requireName(body.app, 'app');
  const collection = requireName(body.collection, 'collection');
  const id = requireName(body.id, 'id');
  const seq = Number(body.seq);
  const row = getDb().prepare(`
    SELECT data, deleted FROM changes WHERE user_id = ? AND app = ? AND collection = ? AND id = ? AND seq = ?
  `).get(userId, app, collection, id, seq) as { data: string | null; deleted: number } | undefined;
  if (!row) throw new ApiError(404, 'version_not_found');

  const now = Date.now();
  const deleted = row.deleted ? 1 : 0;
  const data = deleted ? null : row.data;
  stmts.insertChange().run(userId, app, collection, id, data, now, deleted, 'restore', now);
  const newSeq = (stmts.lastRowId().get() as { s: number }).s;
  stmts.upsertRecord().run(userId, app, collection, id, data, now, deleted, newSeq, 'restore');
  return { ok: true, seq: newSeq, updatedAt: now };
}
