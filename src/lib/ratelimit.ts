/**
 * 单进程内存限流（固定窗口）。
 *
 * 设计取舍：
 * - 键按「登录用户」优先，未登录按客户端 IP；不同 scope 各自独立计数。
 * - 固定窗口实现最简单，边界会有最多一个窗口的突发，但对本项目的量级足够。
 * - 状态只存在当前进程的 Map 里：**多进程 / 多实例部署时各自计数，不共享**；
 *   本项目固定单进程跑在 127.0.0.1:8794，所以不引入 Redis 等外部依赖。
 * - 默认额度宽松，不改变现有前端行为；所有额度都能用环境变量覆盖。
 * - `RATE_LIMIT=off` 可整体关闭（自动化测试使用）。
 */

import { ApiError } from './errors';

export type RateScope =
  | 'sync:push'
  | 'sync:pull'
  | 'backup:import'
  | 'auth:register'
  | 'tokens:create';

type Rule = {
  /** 默认窗口内允许的请求数 */
  limit: number;
  /** 窗口长度（毫秒） */
  windowMs: number;
  /** 覆盖额度的环境变量名 */
  env: string;
};

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const RULES: Record<RateScope, Rule> = {
  'sync:push': { limit: 240, windowMs: MINUTE, env: 'RL_SYNC_PUSH_PER_MIN' },
  'sync:pull': { limit: 600, windowMs: MINUTE, env: 'RL_SYNC_PULL_PER_MIN' },
  'backup:import': { limit: 6, windowMs: MINUTE, env: 'RL_BACKUP_IMPORT_PER_MIN' },
  'auth:register': { limit: 10, windowMs: HOUR, env: 'RL_AUTH_REGISTER_PER_HOUR' },
  'tokens:create': { limit: 10, windowMs: HOUR, env: 'RL_TOKENS_CREATE_PER_HOUR' },
};

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
let nextSweepAt = 0;

function envLimit(rule: Rule): number {
  const raw = process.env[rule.env];
  if (raw === undefined || raw === '') return rule.limit;
  const n = Number(raw);
  // 只接受正整数；非法值回退默认，避免 0/NaN 把接口误封死。
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : rule.limit;
}

/** 过期桶清理：按分钟级的节奏顺手扫一遍，避免内存无限增长。 */
function sweep(now: number): void {
  if (now < nextSweepAt) return;
  nextSweepAt = now + MINUTE;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function rateLimitEnabled(): boolean {
  return String(process.env.RATE_LIMIT ?? 'on').trim().toLowerCase() !== 'off';
}

function subjectOf(req: Request, username?: string | null): string {
  if (username) return `user:${username.toLowerCase()}`;
  const headers = req.headers;
  const ip = String(headers.get('x-real-ip') || '').trim()
    || String(headers.get('x-forwarded-for') || '').split(',')[0].trim()
    || 'unknown';
  return `ip:${ip}`;
}

/**
 * 记一次请求；超限抛 429 + Retry-After。
 * 在路由处理器执行前调用，避免超限请求继续读 body / 查库。
 */
export function checkRateLimit(scope: RateScope, req: Request, username?: string | null): void {
  if (!rateLimitEnabled()) return;

  const rule = RULES[scope];
  const now = Date.now();
  sweep(now);

  const key = `${scope}|${subjectOf(req, username)}`;
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + rule.windowMs };
    buckets.set(key, bucket);
  }

  if (bucket.count >= envLimit(rule)) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    throw new ApiError(429, 'too_many_attempts', { 'Retry-After': String(retryAfter) });
  }
  bucket.count += 1;
}

/** 仅供测试/诊断：清空所有计数。 */
export function resetRateLimits(): void {
  buckets.clear();
  nextSweepAt = 0;
}
