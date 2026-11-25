# 一键部署

`deploy/deploy.sh` 把原来手工的三段命令（构建 → 打包上传 → 解压重启）收成一条命令，并补上部署前备份、健康检查、冒烟测试和回滚。

```bash
cd <仓库根>
bash deploy/deploy.sh
```

目标环境：tx（`ubuntu@124.221.137.194`）上的 `systemd --user vibe-craft-next.service`，目录 `~/workspace/projects/vibe-craft-next`，监听 `127.0.0.1:8794`，由 nginx 反代 `craft.6767.chat`。tx 拉不动 npm registry，所以依赖和构建产物都在本机准备好再上传。

## 前置条件

- 本机在仓库根，已 `npm install`，`node_modules` 与（首次构建后的）`.next` 存在。
- `~/.ssh/config` 里配好 `tx` 别名，公钥免密可用，`ssh tx true` 能直接成功。
- tx 上服务已存在：`systemctl --user status vibe-craft-next` 为 active；项目目录可写。
- 本机有 `npm node ssh scp tar curl`。
- 本机有系统代理也没关系：健康检查和冒烟都会给 curl 加 `--noproxy '*'`，直连公网域名。

## 参数

| 参数 | 作用 |
|---|---|
| 无 | 完整部署：构建 → 打包 → 上传 → 备份 → 解压重启 → 健康检查 → 冒烟 |
| `--skip-build` | 复用本地已有 `.next`；没有 `.next` 会直接报错退出 |
| `--no-backup` | 跳过部署前的服务器备份（不建议在正式环境用） |
| `--no-smoke` | 跳过冒烟测试，健康检查仍然执行 |
| `--dry-run` | 只打印步骤和完整命令序列；不构建、不 ssh、不 scp、不创建临时文件 |
| `--rollback` | 把服务器上最近一次备份恢复回去并重启，随后做健康检查（默认还跑冒烟） |
| `-h` / `--help` | 帮助 |

环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `SSH_HOST` | `tx` | ssh 别名，也可指向跳板别名或另一台机器 |
| `SMOKE_BASE` | `https://craft.6767.chat` | 健康检查与冒烟基址；可改成内网地址或隧道地址 |

示例：

```bash
bash deploy/deploy.sh --dry-run          # 先看计划
bash deploy/deploy.sh --skip-build       # 只改了 public/ 或配置，不想重编
bash deploy/deploy.sh --rollback         # 出问题恢复上一版
SMOKE_BASE=http://127.0.0.1:8794 bash deploy/deploy.sh   # 配合 ssh -L 隧道做本机验证
```

## 流程与实现要点

1. **前置检查**：确认在仓库根（`pwd -P` 与脚本解析出的仓库根一致）、必要文件与命令齐全、`ssh $SSH_HOST true` 可达。所有 ssh/scp 都带 `-o BatchMode=yes`，不会卡在交互提示。
2. **构建**：`npm run build`，日志直接输出；失败立即退出，不上传任何文件。
3. **打包**：只打运行时需要的顶层项：

   ```text
   node_modules .next public src package.json package-lock.json next.config.ts tsconfig.json
   ```

   排除 `node_modules/.cache`。`.env.local`、`.auth-secret` 不在列表内，永不进包；打包后还会再扫一遍 `src/`、`public/`、根目录下的 `.env*`，命中就中止。
4. **上传**：scp 到 `/tmp/vcn-runtime-<时间戳>-<pid>.tar.gz`。
5. **服务器备份**：解压前在服务器执行备份脚本，把当前的 `src public package.json package-lock.json next.config.ts tsconfig.json .next` 打包到：

   ```text
   ~/workspace/projects/vibe-craft-next-backups/<YYYYmmdd-HHMMSS>.tar.gz
   ```

   备份先写 `.part`、`tar -tzf` 校验通过后才改名，只保留最近 5 份。备份失败会中止部署；`--no-backup` 可跳过。`node_modules` 不备份（太大，回滚假设依赖未变）。
6. **解压与重启**：远端脚本先校验 tar 内确实有 `.next/ src/ public/ node_modules/`，然后**先删旧 `.next`** 再解压（避免新旧构建产物混在一起），最后 `systemctl --user restart vibe-craft-next`。远端脚本用 `trap` 在退出时删除 `/tmp` 里的临时包；本机脚本在上传后若中途失败也会尽力清理。
7. **健康检查**：轮询 `$SMOKE_BASE/healthz`，每 2 秒一次，最多 60 秒；超时非 0 退出。
8. **冒烟测试**（任一失败即整体失败并列出失败项）：
   - `GET /healthz` 200
   - `GET /` 200（首页不强制登录，未登录也能看到工具列表）
   - `GET /login` 200
   - `GET /api/v1/sync/state?app=prompt-capsule` 未登录 401
   - `/adhd-text`、`/contextly`、`/expressing`、`/desktop-lite`、`/prompt-capsule` 均 200（工具页都开放，登录只用于同步）
   - `GET /sw.js` 200
9. **摘要**：打印模式、主机、目标目录、备份路径、服务与检查结果、耗时、回滚命令。

## 回滚

```bash
bash deploy/deploy.sh --rollback
```

服务器上取 `~/workspace/projects/vibe-craft-next-backups/` 里最新的 `*.tar.gz`，校验完整性并确认包含 `.next/ src/ public/ package.json`，然后删除目标目录的 `.next src public`、解压备份、重启服务，再做健康检查和（默认）冒烟。没有备份或备份不完整会明确报错，不会盲删。

备份只覆盖运行时文件，不含 `node_modules`、`.env.local`、`.auth-secret`、`data/`（SQLite）。回滚不会碰这些。

## 故障排查

| 现象 | 排查 |
|---|---|
| 提示“请在仓库根运行” | `cd` 到仓库根再执行；脚本只接受从根目录调用 |
| 提示“无法通过 ssh 连接 tx” | `ssh tx true` 手工试；检查 `~/.ssh/config`、私钥、`known_hosts` |
| `--skip-build` 报没有 `.next` | 先 `npm run build`，或去掉 `--skip-build` |
| 健康检查 60 秒超时 | `ssh tx 'systemctl --user status vibe-craft-next'`；`ssh tx 'journalctl --user -u vibe-craft-next -n 100 --no-pager'`；确认 8794 端口和 nginx 正常 |
| 冒烟某项状态码不符 | 看该项是 404 还是 5xx；静态资源缺失多半是 `public/` 没打进去，接口异常看服务日志 |
| 备份失败导致中止 | 看远端磁盘：`ssh tx 'df -h ~'`；备份目录过大时清理旧包；紧急情况可 `--no-backup` |
| 解压/重启失败 | 直接 `bash deploy/deploy.sh --rollback` 回上一版，再查日志 |
| 上传很慢 | `node_modules` 体积大属正常；tx 带宽有限，可考虑后续改增量同步（当前脚本是全量包） |
| 想先看会跑什么 | `bash deploy/deploy.sh --dry-run`，零副作用 |

## 安全与限制

- 脚本不读取、不打印任何密钥；`.env.local` 与 `.auth-secret` 不上传、不备份、不进 tar。
- 部署是**全量覆盖**：`src/`、`public/` 中本地已删除的旧文件不会从服务器删除（`.next` 会先删）。运行时以 `.next` 为准，残留源文件一般无影响；若要彻底干净，需手工清理或后续改成先同步目录。
- 回滚粒度为“最近一次部署前”的运行时快照，最多保留 5 份；依赖（`node_modules`）不随回滚变化。
- 脚本不做 `git` 操作、不 push，也不负责 nginx/证书。
- 只在 Linux 上验证；远端 `tar`/`systemctl --user` 按 Linux 语义使用，未使用 GNU 专属的古怪参数（`--exclude` 为通用参数）。
