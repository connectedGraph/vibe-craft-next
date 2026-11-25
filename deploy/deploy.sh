#!/usr/bin/env bash
# vibe-craft-next 一键部署脚本
# 详细用法见 deploy/README.md，或执行 bash deploy/deploy.sh --help。
set -Eeuo pipefail

# ===== 常量 =====
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
readonly DEFAULT_SSH_HOST="tx"
readonly REMOTE_PROJECT="workspace/projects/vibe-craft-next"
readonly REMOTE_BACKUP_DIR="workspace/projects/vibe-craft-next-backups"
readonly SERVICE_NAME="vibe-craft-next"
readonly HEALTH_TIMEOUT_SEC=60
readonly HEALTH_INTERVAL_SEC=2
readonly BACKUP_KEEP=5
# 运行时需要的文件（.env.local 不在此列，永不打包）
readonly RUNTIME_FILES=(node_modules .next public src package.json package-lock.json next.config.ts tsconfig.json)
# 所有 ssh/scp 都非交互
readonly SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10)
# 冒烟检查：路径 + 期望状态码
readonly SMOKE_STATUS_CHECKS=(
  "/ 307"
  "/login 200"
  "/api/v1/sync/state?app=prompt-capsule 401"
  "/adhd-text 200"
  "/contextly 200"
  "/expressing 200"
  "/desktop-lite 200"
  "/prompt-capsule 200"
  "/sw.js 200"
)

# ===== 运行参数 =====
SSH_HOST="${SSH_HOST:-$DEFAULT_SSH_HOST}"
SMOKE_BASE="${SMOKE_BASE:-https://craft.6767.chat}"
while [[ "$SMOKE_BASE" == */ ]]; do SMOKE_BASE="${SMOKE_BASE%/}"; done

SKIP_BUILD=0
NO_BACKUP=0
NO_SMOKE=0
DRY_RUN=0
ROLLBACK=0

# ===== 运行状态 =====
STAGE="初始化"
TS="$(date +%Y%m%d-%H%M%S)"
TARBALL=""
LOCAL_TMP_DIR=""
REMOTE_TARBALL="/tmp/vcn-runtime-${TS}-$$.tar.gz"
REMOTE_UPLOADED=0
BACKUP_PATH=""
ROLLBACK_PATH=""
SECONDS=0

# ===== 远端脚本（单引号 heredoc，参数经 bash -s -- 传入） =====
readonly REMOTE_BACKUP_SCRIPT="$(cat <<'EOS'
set -euo pipefail
target="$HOME/$1"
backup_dir="$HOME/$2"
stamp="$3"
keep="$4"
mkdir -p "$backup_dir"
items=()
for p in src public package.json package-lock.json next.config.ts tsconfig.json .next; do
  if [ -e "$target/$p" ]; then
    items+=("$p")
  fi
done
if [ "${#items[@]}" -eq 0 ]; then
  echo "NO_RUNTIME_FILES"
  exit 0
fi
tmp="$backup_dir/.$stamp.tar.gz.part"
rm -f -- "$tmp"
tar -czf "$tmp" -C "$target" "${items[@]}"
tar -tzf "$tmp" >/dev/null
mv -- "$tmp" "$backup_dir/$stamp.tar.gz"
ls -1t "$backup_dir"/*.tar.gz 2>/dev/null | tail -n +$((keep + 1)) | while IFS= read -r old; do
  rm -f -- "$old"
done
echo "BACKUP_OK $backup_dir/$stamp.tar.gz"
EOS
)"

readonly REMOTE_DEPLOY_SCRIPT="$(cat <<'EOS'
set -euo pipefail
target="$HOME/$1"
tarball="$2"
service="$3"
trap 'rm -f -- "$tarball"' EXIT
if [ ! -f "$tarball" ]; then
  echo "MISSING_TARBALL: $tarball" >&2
  exit 2
fi
entries=$(tar -tzf "$tarball")
for p in .next src public node_modules; do
  if ! grep -Fqx "$p/" <<<"$entries"; then
    echo "BAD_TARBALL: 缺少 $p/" >&2
    exit 3
  fi
done
mkdir -p "$target"
rm -rf -- "$target/.next"
tar -C "$target" -xzf "$tarball"
systemctl --user restart "$service"
echo "DEPLOY_OK"
EOS
)"

readonly REMOTE_ROLLBACK_SCRIPT="$(cat <<'EOS'
set -euo pipefail
target="$HOME/$1"
backup_dir="$HOME/$2"
service="$3"
latest=$(ls -1t "$backup_dir"/*.tar.gz 2>/dev/null | head -n 1) || true
if [ -z "${latest:-}" ]; then
  echo "NO_BACKUP: $backup_dir 下没有备份" >&2
  exit 3
fi
entries=$(tar -tzf "$latest")
for p in .next src public; do
  if ! grep -Fqx "$p/" <<<"$entries"; then
    echo "BAD_BACKUP: $latest 缺少 $p/" >&2
    exit 4
  fi
done
if ! grep -Fqx "package.json" <<<"$entries"; then
  echo "BAD_BACKUP: $latest 缺少 package.json" >&2
  exit 4
fi
rm -rf -- "$target/.next" "$target/src" "$target/public"
tar -C "$target" -xzf "$latest"
systemctl --user restart "$service"
echo "ROLLBACK_OK $latest"
EOS
)"

# ===== 通用输出与清理 =====
print_cmd() {
  printf '  $'
  printf ' %q' "$@"
  printf '\n'
}

print_remote() {
  local host="$1" script="$2"
  shift 2
  printf '  $ ssh -o BatchMode=yes -o ConnectTimeout=10 %s bash -s --' "$host"
  printf ' %q' "$@"
  printf " <<'REMOTE'\n"
  while IFS= read -r line; do
    printf '    %s\n' "$line"
  done <<<"$script"
  printf '  REMOTE\n'
}

exec_remote() {
  local script="$1"
  shift
  ssh "${SSH_OPTS[@]}" "$SSH_HOST" bash -s -- "$@" <<<"$script"
}

die() {
  printf '[失败] %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "$LOCAL_TMP_DIR" && -d "$LOCAL_TMP_DIR" ]]; then
    rm -rf -- "$LOCAL_TMP_DIR"
  fi
  # 上传后若中途失败，尽力清理远端临时包；dry-run 不做任何 ssh
  if (( REMOTE_UPLOADED )) && (( ! DRY_RUN )); then
    ssh "${SSH_OPTS[@]}" "$SSH_HOST" rm -f -- "$REMOTE_TARBALL" >/dev/null 2>&1 || true
  fi
}

on_error() {
  local rc=$?
  printf '\n[失败] 阶段「%s」出错（退出码 %d）\n' "$STAGE" "$rc" >&2
  if (( ! ROLLBACK )); then
    printf '可尝试恢复上一版本：bash deploy/deploy.sh --rollback\n' >&2
  fi
  exit "$rc"
}

trap cleanup EXIT
trap on_error ERR

# ===== 参数与帮助 =====
usage() {
  cat <<'EOF'
vibe-craft-next 一键部署

用法:
  bash deploy/deploy.sh [选项]

选项:
  --skip-build   复用本地已有 .next，不重新构建
  --no-backup    跳过部署前的服务器备份
  --no-smoke     跳过部署后的冒烟测试（健康检查仍执行）
  --dry-run      只打印将执行的步骤和命令，不构建、不 ssh/scp（零副作用）
  --rollback     恢复服务器上最近一次备份并重启服务
  -h, --help     显示本帮助

环境变量:
  SSH_HOST       ssh 别名，默认 tx
  SMOKE_BASE     健康检查与冒烟基址，默认 https://craft.6767.chat

示例:
  bash deploy/deploy.sh
  bash deploy/deploy.sh --skip-build --no-smoke
  bash deploy/deploy.sh --rollback
  bash deploy/deploy.sh --dry-run
  SMOKE_BASE=http://127.0.0.1:8794 bash deploy/deploy.sh --dry-run
EOF
}

parse_args() {
  while (( $# )); do
    case "$1" in
      --skip-build) SKIP_BUILD=1 ;;
      --no-backup)  NO_BACKUP=1 ;;
      --no-smoke)   NO_SMOKE=1 ;;
      --dry-run)    DRY_RUN=1 ;;
      --rollback)   ROLLBACK=1 ;;
      -h|--help)    usage; exit 0 ;;
      *)
        printf '未知参数: %s\n\n' "$1" >&2
        usage >&2
        exit 2
        ;;
    esac
    shift
  done
}

# ===== 前置检查 =====
need() {
  STAGE="前置检查"
  printf '\n== 前置检查 ==\n'
  if [[ "$(pwd -P)" != "$REPO_ROOT" ]]; then
    die "请在仓库根运行：cd $REPO_ROOT && bash deploy/deploy.sh"
  fi
  local f c
  for f in package.json next.config.ts tsconfig.json; do
    [[ -f "$f" ]] || die "缺少 $f，当前目录不像本项目仓库根"
  done
  [[ -d src ]] || die "缺少 src 目录，当前目录不像本项目仓库根"
  if (( SKIP_BUILD )) && [[ ! -d "$REPO_ROOT/.next" ]]; then
    die "指定了 --skip-build，但本地没有 .next，请先执行 npm run build"
  fi
  if (( ! ROLLBACK )); then
    [[ -d node_modules ]] || die "缺少 node_modules，请先执行 npm install"
    for f in public package-lock.json; do
      [[ -e "$f" ]] || die "缺少 $f，无法打包"
    done
  fi
  for c in npm node ssh scp tar curl; do
    command -v "$c" >/dev/null 2>&1 || die "缺少命令：$c"
  done
  if (( DRY_RUN )); then
    printf '  （dry-run 跳过 ssh 可达性检查）\n'
  else
    if ! ssh "${SSH_OPTS[@]}" "$SSH_HOST" true 2>/dev/null; then
      die "无法通过 ssh 连接 $SSH_HOST，请检查 ~/.ssh/config 与网络"
    fi
    printf '  ssh %s 可达\n' "$SSH_HOST"
  fi
  printf '  仓库根: %s\n' "$REPO_ROOT"
}

# ===== 构建 =====
build() {
  STAGE="构建"
  printf '\n== 构建 ==\n'
  if (( SKIP_BUILD )); then
    printf '  已跳过（--skip-build），复用现有 .next\n'
    return 0
  fi
  if (( DRY_RUN )); then
    print_cmd npm run build
    return 0
  fi
  npm run build || die "构建失败（npm run build 返回非 0），未上传任何文件"
}

# ===== 打包 =====
pack() {
  STAGE="打包"
  printf '\n== 打包运行时文件 ==\n'
  if (( DRY_RUN )); then
    TARBALL="${TMPDIR:-/tmp}/vcn-runtime-$TS.tar.gz"
    print_cmd tar -czf "$TARBALL" --exclude=node_modules/.cache "${RUNTIME_FILES[@]}"
    printf '  打包列表: %s\n' "${RUNTIME_FILES[*]}"
    return 0
  fi
  [[ -d .next ]] || die "本地没有 .next，构建可能未完成"
  LOCAL_TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/vcn-deploy.XXXXXX")"
  TARBALL="$LOCAL_TMP_DIR/vcn-runtime-$TS.tar.gz"
  tar -czf "$TARBALL" --exclude=node_modules/.cache "${RUNTIME_FILES[@]}" \
    || die "打包失败"
  # 安全检查：项目自身的 .env 不许进包
  local env_hits
  env_hits="$(tar -tzf "$TARBALL" | grep -E '^(\./)?(src|public)/\.env|^(\./)?\.env' || true)"
  if [[ -n "$env_hits" ]]; then
    printf '%s\n' "$env_hits" >&2
    die "打包内容包含环境变量文件，已中止"
  fi
  printf '  本地包: %s (%s)\n' "$TARBALL" "$(du -h "$TARBALL" | cut -f1)"
}

# ===== 上传 =====
upload() {
  STAGE="上传"
  printf '\n== 上传到 %s ==\n' "$SSH_HOST"
  if (( DRY_RUN )); then
    print_cmd scp -q "${SSH_OPTS[@]}" "$TARBALL" "$SSH_HOST:$REMOTE_TARBALL"
    return 0
  fi
  if ! scp -q "${SSH_OPTS[@]}" "$TARBALL" "$SSH_HOST:$REMOTE_TARBALL"; then
    die "上传失败：无法把包传到 $SSH_HOST:$REMOTE_TARBALL"
  fi
  REMOTE_UPLOADED=1
  printf '  已上传: %s\n' "$REMOTE_TARBALL"
}

# ===== 服务器备份 =====
backup() {
  if (( NO_BACKUP )); then
    printf '\n== 服务器备份 ==\n  已跳过（--no-backup）\n'
    return 0
  fi
  STAGE="服务器备份"
  printf '\n== 服务器备份 ==\n'
  if (( DRY_RUN )); then
    print_remote "$SSH_HOST" "$REMOTE_BACKUP_SCRIPT" "$REMOTE_PROJECT" "$REMOTE_BACKUP_DIR" "$TS" "$BACKUP_KEEP"
    return 0
  fi
  local out
  if ! out="$(exec_remote "$REMOTE_BACKUP_SCRIPT" "$REMOTE_PROJECT" "$REMOTE_BACKUP_DIR" "$TS" "$BACKUP_KEEP" 2>&1)"; then
    printf '%s\n' "$out" >&2
    die "服务器备份失败，已中止部署（确认无需备份可加 --no-backup）"
  fi
  printf '%s\n' "$out" | sed 's/^/  /'
  if [[ "$out" == *NO_RUNTIME_FILES* ]]; then
    printf '  服务器上暂无可备份的运行时文件（可能是首次部署）\n'
  fi
  BACKUP_PATH="$(printf '%s\n' "$out" | sed -n 's/^BACKUP_OK //p' | tail -n 1)"
}

# ===== 解压与重启 =====
restart() {
  STAGE="解压与重启"
  printf '\n== 解压并重启服务 ==\n'
  if (( DRY_RUN )); then
    print_remote "$SSH_HOST" "$REMOTE_DEPLOY_SCRIPT" "$REMOTE_PROJECT" "$REMOTE_TARBALL" "$SERVICE_NAME"
    return 0
  fi
  local out
  if ! out="$(exec_remote "$REMOTE_DEPLOY_SCRIPT" "$REMOTE_PROJECT" "$REMOTE_TARBALL" "$SERVICE_NAME" 2>&1)"; then
    printf '%s\n' "$out" >&2
    die "服务器解压或重启服务失败（可用 --rollback 恢复上一版本）"
  fi
  # 远端脚本的 EXIT trap 已删除临时包
  REMOTE_UPLOADED=0
  printf '%s\n' "$out" | sed 's/^/  /'
}

# ===== 健康检查 =====
http_code() {
  local code
  code="$(curl -sS --noproxy '*' --max-time 10 -o /dev/null -w '%{http_code}' "$1" 2>/dev/null)" || code="000"
  printf '%s' "${code:-000}"
}

wait_health() {
  STAGE="健康检查"
  if (( DRY_RUN )); then
    printf '\n== 健康检查 ==\n'
    printf '  # 轮询 %s/healthz，最多 %d 秒，每 %d 秒一次\n' "$SMOKE_BASE" "$HEALTH_TIMEOUT_SEC" "$HEALTH_INTERVAL_SEC"
    print_cmd curl -fsS --noproxy '*' --max-time 5 -o /dev/null "$SMOKE_BASE/healthz"
    return 0
  fi
  local deadline=$((SECONDS + HEALTH_TIMEOUT_SEC)) code=""
  printf '\n== 健康检查 ==\n'
  printf '  轮询 %s/healthz ...\n' "$SMOKE_BASE"
  while (( SECONDS < deadline )); do
    code="$(http_code "$SMOKE_BASE/healthz")"
    if [[ "$code" == "200" ]]; then
      printf '  健康检查通过（%ss）\n' "$SECONDS"
      return 0
    fi
    sleep "$HEALTH_INTERVAL_SEC"
  done
  printf '[失败] 健康检查在 %d 秒内未通过（最后状态码 %s）\n' "$HEALTH_TIMEOUT_SEC" "${code:-000}" >&2
  return 1
}

# ===== 冒烟测试 =====
smoke() {
  STAGE="冒烟测试"
  printf '\n== 冒烟测试 ==\n'
  printf '  基址: %s\n' "$SMOKE_BASE"
  if (( DRY_RUN )); then
    print_cmd curl -fsS --noproxy '*' --max-time 10 -o /dev/null "$SMOKE_BASE/healthz"
    local line path expected
    for line in "${SMOKE_STATUS_CHECKS[@]}"; do
      path="${line% *}"
      expected="${line##* }"
      print_cmd curl -sS --noproxy '*' --max-time 10 -o /dev/null -w '%{http_code}' "$SMOKE_BASE$path"
      if [[ "$path" == "/prompt-capsule" ]]; then
        printf '    # 期望 %s；未登录时 307 跳到 /login?next=/prompt-capsule 也算通过\n' "$expected"
      else
        printf '    # 期望 %s\n' "$expected"
      fi
    done
    return 0
  fi

  local failures=() code line path expected location
  code="$(http_code "$SMOKE_BASE/healthz")"
  if [[ "$code" == "200" ]]; then
    printf '  [通过] GET /healthz -> %s\n' "$code"
  else
    printf '  [失败] GET /healthz -> %s（期望 200）\n' "$code"
    failures+=("GET /healthz 期望 200，实际 $code")
  fi

  for line in "${SMOKE_STATUS_CHECKS[@]}"; do
    path="${line% *}"
    expected="${line##* }"
    code="$(http_code "$SMOKE_BASE$path")"
    if [[ "$code" == "$expected" ]]; then
      printf '  [通过] GET %s -> %s\n' "$path" "$code"
      continue
    fi
    # prompt-capsule 本身需要登录；未登录时按设计 307 到登录页，视为路由正常
    if [[ "$path" == "/prompt-capsule" && "$code" == "307" ]]; then
      location="$(curl -sS --noproxy '*' --max-time 10 -o /dev/null -w '%{redirect_url}' "$SMOKE_BASE$path" 2>/dev/null || true)"
      if [[ "$location" == *"/login?next=/prompt-capsule" ]]; then
        printf '  [通过] GET %s -> 307（未登录，重定向到登录页）\n' "$path"
        continue
      fi
    fi
    printf '  [失败] GET %s -> %s（期望 %s）\n' "$path" "$code" "$expected"
    failures+=("GET $path 期望 $expected，实际 $code")
  done

  if (( ${#failures[@]} > 0 )); then
    printf '\n冒烟测试未通过，共 %d 项：\n' "${#failures[@]}"
    printf '  - %s\n' "${failures[@]}"
    return 1
  fi
  printf '  冒烟测试全部通过（%d 项状态码 + healthz）\n' "${#SMOKE_STATUS_CHECKS[@]}"
}

# ===== 回滚 =====
rollback() {
  STAGE="回滚"
  printf '\n== 回滚到最近一次备份 ==\n'
  if (( DRY_RUN )); then
    print_remote "$SSH_HOST" "$REMOTE_ROLLBACK_SCRIPT" "$REMOTE_PROJECT" "$REMOTE_BACKUP_DIR" "$SERVICE_NAME"
    if (( NO_SMOKE )); then
      printf '  # 随后轮询健康检查（冒烟已跳过）\n'
    else
      printf '  # 随后轮询健康检查并执行冒烟测试\n'
    fi
    return 0
  fi
  local out
  if ! out="$(exec_remote "$REMOTE_ROLLBACK_SCRIPT" "$REMOTE_PROJECT" "$REMOTE_BACKUP_DIR" "$SERVICE_NAME" 2>&1)"; then
    printf '%s\n' "$out" >&2
    die "回滚失败：没有可用备份，或备份内容不完整"
  fi
  printf '%s\n' "$out" | sed 's/^/  /'
  ROLLBACK_PATH="$(printf '%s\n' "$out" | sed -n 's/^ROLLBACK_OK //p' | tail -n 1)"
  wait_health
  if (( NO_SMOKE )); then
    printf '\n== 冒烟测试 ==\n  已跳过（--no-smoke）\n'
  else
    smoke
  fi
}

# ===== 结果摘要 =====
print_summary() {
  local mode="$1"
  printf '\n===== 结果摘要 =====\n'
  printf '  模式      : %s\n' "$mode"
  printf '  主机      : %s\n' "$SSH_HOST"
  printf '  远端目录  : ~/%s\n' "$REMOTE_PROJECT"
  if [[ "$mode" == "回滚" ]]; then
    printf '  恢复备份  : %s\n' "${ROLLBACK_PATH:-（未知）}"
  else
    if (( NO_BACKUP )); then
      printf '  部署前备份: 已跳过（--no-backup）\n'
    elif [[ -n "$BACKUP_PATH" ]]; then
      printf '  部署前备份: %s\n' "$BACKUP_PATH"
    else
      printf '  部署前备份: 服务器上暂无可备份文件\n'
    fi
  fi
  printf '  服务      : %s 已重启\n' "$SERVICE_NAME"
  printf '  健康检查  : %s/healthz 通过\n' "$SMOKE_BASE"
  if (( NO_SMOKE )); then
    printf '  冒烟测试  : 已跳过（--no-smoke）\n'
  else
    printf '  冒烟测试  : 通过\n'
  fi
  printf '  耗时      : %ss\n' "$SECONDS"
  printf '  回滚命令  : bash deploy/deploy.sh --rollback\n'
  printf '====================\n'
}

# ===== 主流程 =====
main() {
  parse_args "$@"
  printf 'vibe-craft-next 一键部署\n'
  printf '  仓库根: %s\n' "$REPO_ROOT"
  printf '  主机  : %s\n' "$SSH_HOST"
  printf '  基址  : %s\n' "$SMOKE_BASE"
  if (( DRY_RUN )); then
    printf '  模式  : dry-run（零副作用）\n'
  fi

  need

  if (( ROLLBACK )); then
    rollback
    if (( DRY_RUN )); then
      printf '\n[dry-run] 以上仅为回滚计划，未执行构建、ssh 或 scp。\n'
    else
      print_summary "回滚"
    fi
    return 0
  fi

  build
  pack
  upload
  backup
  restart
  wait_health
  if (( NO_SMOKE )); then
    printf '\n== 冒烟测试 ==\n  已跳过（--no-smoke）\n'
  else
    smoke
  fi

  if (( DRY_RUN )); then
    printf '\n[dry-run] 以上仅为部署计划，未执行构建、ssh 或 scp。\n'
  else
    print_summary "部署"
  fi
}

main "$@"
