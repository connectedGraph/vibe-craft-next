# 测试

只用 Node 内置 `node --test`，不引入任何测试依赖。

## 怎么跑

```bash
npm run build      # 首次或改过 src 后需要；测试复用已有的 .next
npm test           # 全部（API + 单测）
npm run test:api   # 只跑 HTTP 契约测试
npm run test:unit  # 只跑数据层纯函数单测
```

- `tests/helpers.mjs` 会用 `next start` 拉起真实生产服务，端口由内核分配（避免和别的 worktree 抢固定端口），每个实例一个临时 `DATA_DIR`，结束后 kill 子进程并删目录。
- 测试进程如果发现没有 `.next/BUILD_ID`，会自动补跑一次 `npm run build`。改过 `src/` 之后请手动 `npm run build`，否则跑的是旧构建。
- 服务默认环境：`AUTH_MODE=public`、`REGISTRATION_OPEN=1`、`RATE_LIMIT=off`、`ADMIN_PASSWORD=admin-pass-123`。限流用例自己用环境变量覆盖成低额度。
- 单测直接 `import src/lib/tools/*.ts`（Node 24 类型擦除）；依赖 `window.localStorage` 的函数在测试里用内存桩。

## 覆盖范围

### `tests/api.test.mjs`（真实 HTTP）

| 用例 | 断言点 |
| --- | --- |
| 未登录 `/sync/state` | 401、`{ok:false,error:"unauthenticated"}`、message 非空 |
| 注册 / 登录 / me / logout | 非法用户名 400、弱密码 400、注册成功种 `vc_session`、重复用户名（大小写不敏感）409、错误密码 401、`/auth/me` 返回用户、logout 清 Cookie（`Max-Age=0`）并吊销会话；之后再访问 `/auth/me` 是 **200 + `user:null`**（该路由 `open:true`，与代码一致，不是 401） |
| 登录限流 | 连续 5 次失败后，第 6 次即使密码正确也 429 + `Retry-After`（保留原有 15 分钟锁定） |
| 同步主流程 | push 接收、`pull?since=0` 取到；同内容同 `updatedAt` 再推返回 `unchanged`；更新后 pull 得到新版本；`since=最新 seq` 无增量；`delete` 后 pull 返回 `op:"delete"`、`data:null`、state.count=0；非法 app/collection/id、`ops` 非数组、501 条 ops 均 400 |
| pull 分页 | `limit=1` 时 `hasMore=true`，用 `now` 作游标取下一页，两页 id 不重复 |
| 冲突 | 同一 `updatedAt` 推不同内容：`accepted` 为空、`conflicts[0].server.data` 为旧版、state.count 不变；`updatedAt` 更大的一方获胜 |
| 备份 | `/backup/export` 格式 `vibe-craft-backup-v1`；新账号 merge 导入 2 条、pull 还原；重复 merge 全部 skipped；replace 后旧记录 tombstone、state.count=1；`records` 非数组 400、记录 app 非法 400 |
| 历史 / 回滚 | `/sync/history` 按 seq 倒序返回两个版本及 deviceId/createdAt；`/sync/restore` 恢复旧版本后 pull 得到旧内容且 seq 更新；不存在的 seq 404；缺 id 400 |
| 管理端 | 普通用户 `/admin/users` 403；管理员可列用户（含 admin/alice）、建用户、弱密码 400、重复 409、读设置（public + 开放注册）；禁用用户后登录 403 `account_disabled` |
| Bearer 令牌 | `/api/v1/admin/tokens` 创建 `vck_` 令牌 → 仅用 Bearer 访问 `/sync/state` 成功；列表不回显明文；吊销后 401；`/api/v1/tokens`（旧路径）404 |
| 限流（第二个实例） | `RL_SYNC_PUSH_PER_MIN=3`：第 4 次 push 429 + `Retry-After`；换用户不受影响（按身份隔离）；`RL_SYNC_PULL_PER_MIN=2`：第 3 次 pull 429；`RL_TOKENS_CREATE_PER_HOUR=1`：第 2 次建令牌 429 |
| `RATE_LIMIT=off` | 同一用户连续 6 次 push 全 200 |
| 体积上限 | `sync/push` 收到 2MB+ body 返回 413 `payload_too_large`；同样 2MB+ 走 `backup/import` 仍成功（阈值 8MB） |

### `tests/tools.test.mjs`（纯函数）

- `contextly`
  - `dailyQueue`：过滤未到期、按 `due` 升序。
  - `rateCard`：评级 1（1 分钟 / learning / 难度 +2）、评级 2（10 分钟 / 难度 +1）、评级 3（新卡 1 天、复习卡 `reps*2.5` 天、`reps=0` 走 `||2` 兜底）、评级 4（新卡 4 天、复习卡 `reps*4` 天、难度下限 0），难度上限 10；`_isFreeReview` 不写回 `due` 且清理标记；不改原对象。
  - `applyRemoteChanges`：新增追加、较新覆盖、较旧/相同 `updatedAt` 忽略、外层 `updatedAt` 兜底、无 data 忽略、delete 移除、结果落 localStorage。
  - `loadData`：无 window / 空存储 / 坏 JSON 都返回空结构。
- `expressing`
  - `newDoc` 默认字段；`filterDocs` 标题/译文大小写/中文、分类、标签、docs 覆盖参数、无标签文档；`allTags` 去重排序。
  - `wrapHighlights`：大小写不敏感、正则特殊字符按字面量（`a.b` 不命中 `axb`、`C++`）、空白匹配换行、不包裹标签属性、空文本/未命中原样返回。
  - `applyAnnotationHighlights`：不重叠标注各包一层、最长文本优先、特殊字符转义、空标注数组。
- `desktopLite`
  - `defaultState` / `todayString` 的默认结构与本地日期格式。
  - `loadState`：空存储取默认并补今日日志（不写盘）；已有数据合并、空 `logTopics` 回退默认、`isRunning` 强制为 false、其余字段保留；`loadLang` 默认 `cn`。
  - `applyListChanges`：更新原地、新增追加、较旧/相同时间忽略、外层 `updatedAt` 兜底、无 data 忽略、delete 当 tombstone 移除、字符串 id 对齐、空变更返回 false。

### 已知不覆盖

- `desktopLite.playSound` 依赖 `window.AudioContext`，`confettiBurst` 依赖第三方 `window.confetti`：纯 DOM/WebAudio 副作用，没有可断言的业务逻辑，跳过。
- 组件渲染（React 页面）不在本套件范围内，只测 API 与数据层。

## 备注

- `applyAnnotationHighlights` 对「一个标注文本是另一个的子串」的情况会嵌套包裹（先套长文本，再在长文本内部套短文本）。这是现有实现的行为，本次测试只断言「不重叠标注各包一层」和「最长优先」，未改动业务逻辑。
- 限流是单进程内存实现，多进程/多实例部署时各进程独立计数，不共享。
