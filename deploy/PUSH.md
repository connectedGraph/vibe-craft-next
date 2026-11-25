# GitHub 推送说明

2026-11-25 推送时环境问题：

- `api.github.com` 全部 IP 的 TLS 握手被中断（直连和代理都一样），`gh` 无法创建仓库。
- `gh auth status` 显示 keyring 里的 token 已失效。
- `ssh.github.com:443` 可以连，但本机 SSH key 被 GitHub 拒绝。
- `git ls-remote` 也因 TLS 中断失败。

代码已在本地 `git commit`，并生成了 `deploy/vibe-craft-next.bundle`。

网络/凭据恢复后，任选一种：

## A. 直接创建并推送

```bash
gh auth login            # 重新认证
gh repo create connectedGraph/vibe-craft-next --public --source=. --remote=origin --push
```

如果仓库已经存在：

```bash
git remote add origin https://github.com/connectedGraph/vibe-craft-next.git
git push -u origin main
```

## B. 从 bundle 恢复

```bash
git clone deploy/vibe-craft-next.bundle vibe-craft-next-restore
cd vibe-craft-next-restore
git remote add origin https://github.com/connectedGraph/vibe-craft-next.git
git push -u origin main
```

`~/.git-credentials` 里已有 HTTPS 凭据，网络恢复后 git 会自动使用。
