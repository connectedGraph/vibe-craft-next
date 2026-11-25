# Vibe Craft

学习与表达积累工具集，Next.js 16 + React 19 全栈版。数据默认留在浏览器 localStorage，账号负责多设备增量同步。

- 线上：<https://craft.6767.chat/>
- 仓库：<https://github.com/connectedGraph/vibe-craft-next>

## 工具

| 工具 | 入口 | 实现 |
|---|---|---|
| Prompt Capsule | `/prompt-capsule` | React，Markdown + 选区黄框标注 |
| Contextly | `/contextly/index.html` | 静态单页（词汇 + 上下文） |
| Expressing | `/expressing/index.html` | 静态单页（中文 → 地道英文对比） |
| Desktop Lite | `/desktop-lite/index.html` | 静态单页（Aura PKM / 番茄专注） |
| ADHD Text | `/adhd-text/index.html` | 静态单页（阅读排版实验） |

四个静态工具放在 `public/`，由同一个 Next 进程托管，共用 `public/shared/sync-client.js` 与 `/api/v1`。

## 技术栈

- Next.js 16（App Router、route handlers）+ React 19 + Tailwind 4
- SQLite（Node 内置 `node:sqlite`，WAL）
- 鉴权：scrypt 密码哈希 + HttpOnly `vc_session` JWT Cookie（`pv` 改密失效、`jti` 单会话吊销）+ `vck_` Bearer
- Markdown：`marked` + `DOMPurify`

## 本地开发

```bash
npm install
cat > .env.local <<'EOF'
DATA_DIR=./data
AUTH_MODE=public        # off | self | public
REGISTRATION_OPEN=1
EOF
npm run dev
```

首次启动会自动建表并种下管理员 `admin`（随机初始密码，`must_change_password`），日志里会打印一次。

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/v1/auth/register` | 注册（`REGISTRATION_OPEN=1` 时开放） |
| POST | `/api/v1/auth/login` | 登录，种 `vc_session` |
| POST | `/api/v1/auth/logout` | 退出，吊销当前会话 |
| GET | `/api/v1/auth/me` | 当前身份 |
| POST | `/api/v1/auth/password` | 改密（旧会话全部失效） |
| GET/POST/DELETE | `/api/v1/auth/sessions` | 会话列表 / 吊销 |
| GET/POST | `/api/v1/tokens` | API 令牌 |
| GET | `/api/v1/sync/state` | 游标与记录数 |
| GET | `/api/v1/sync/pull?app=&since=` | 增量拉取（`since=0` 为全量） |
| POST | `/api/v1/sync/push` | 增量推送 |
| GET | `/api/v1/backup/export` / POST `import` | 云端备份导出 / 恢复 |
| GET | `/api/v1/history` / POST `restore` | 历史版本与回滚 |
| GET/POST | `/api/v1/admin/*` | 用户、会话、令牌、账号模式（管理员） |

同步是**记录级 LWW**：每条记录带 `id / h(内容哈希) / updatedAt / deleted`，服务端用单调 `changes.seq` 做游标；相同内容返回 `unchanged`，不产生冲突副本；真正的并发修改进冲突列表由前端选择。

## 部署

tx 上由 `systemd --user vibe-craft-next.service` 跑 `next start`，nginx 反代 `craft.6767.chat` → `127.0.0.1:8794`。

```bash
npm run build
tar --exclude=./node_modules/.cache -czf /tmp/vcn-runtime.tar.gz \
  node_modules .next public src package.json package-lock.json next.config.ts tsconfig.json
scp /tmp/vcn-runtime.tar.gz tx:/tmp/
ssh tx 'tar -C ~/workspace/projects/vibe-craft-next -xzf /tmp/vcn-runtime.tar.gz && systemctl --user restart vibe-craft-next'
```

`public/` 必须一起传（四个静态工具、`sw.js`、manifest、图标都在里面）。

## 兼容地址

`/login.html` → `/login`、`/admin.html` → `/admin`、`/index.html` → `/`、`/contextly` → `/contextly/index.html`（其余同理）、`/legacy/*` → `/*`，全部 307。

## 数据

- 云端 SQLite：`$DATA_DIR/sync.db`（`user / api_token / session / records / changes / meta`）。
- 浏览器本地：各工具自己的 localStorage key，云端只是同步与备份。
- `.env.local`、`.auth-secret` 权限保持 `600`。
