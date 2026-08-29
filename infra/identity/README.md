# StarStack 本地 Hydra 身份运行时

这里是 SS-AUTH-002 的隔离开发运行时，不是生产部署文件。OIDC 默认关闭。下载的 Hydra 二进制和一次性协议日志位于当前 checkout 中被 Git 忽略的 `.identity-runtime/`；共享 DSN 的 Secret、fixture SQLite 与运行锁不属于任何 checkout，统一位于当前操作系统用户的机器状态目录：

```text
~/.local/state/starstack/identity/hydra-test-57eae204b3826d2c/
```

`57eae204b3826d2c` 是冻结 DSN 的 SHA-256 前 16 位，不是 Secret。状态目录必须是当前 UID 所有的真实目录且权限恰为 `0700`；凭据、状态标记、锁和 fixture SQLite 文件必须是非 symlink 普通文件、权限恰为 `0600` 且 `nlink === 1`。加载时会同时核验 `lstat`、`realpath`、UID、类型、权限、link count 与打开后的 inode，路径替换、symlink 或 hard link 会失败关闭。

固定版本：

- Ory Hydra `v26.2.0-distroless@sha256:ad53a123ddf869fc23ea74f3d76b47e2966dc52f559e93ab31f81440f4d60c5e`
- PostgreSQL `16.15-alpine3.24@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685`

Hydra Public/Admin 只绑定 loopback；Compose 中 PostgreSQL 不发布宿主端口。Admin `4445` 不得通过公网 Nginx、Tunnel 或端口转发暴露。

## 复用双方共享的本地运行时

共享 PostgreSQL 已在 `127.0.0.1:55432` 时，可以直接运行完整协议门禁：

```bash
HYDRA_TEST_BINARY=/tmp/jy-auth-runtime-hydra-pg-16.15/hydra/hydra \
HYDRA_TEST_DSN='postgres://hydra_test@127.0.0.1:55432/hydra_test?sslmode=disable' \
npm run identity:hydra:protocol
```

协议门禁是本地 fixture 的确定性重建，不是生产迁移：它只接受精确的 loopback `hydra_test` DSN，并在跨 checkout 的机器唯一锁、零其他数据库连接和 PostgreSQL 16.15 客户端校验通过后，同步重建 Hydra schema、本地 StarStack fixture SQLite，并把 Hydra 数据库与 canonical 凭据作为一个失败关闭的轮换单元。PostgreSQL reset 位于单个事务内；中断发生在提交前会回滚并删除本次 pending，提交后则先完成凭据切换再响应中断。不得通过 `IDENTITY_TEST_CREDENTIALS_FILE` 或 `IDENTITY_TEST_STARSTACK_DB` 为共享 DSN 指定另一套文件，也不得恢复来源或凭据不匹配的旧数据库快照。

机器状态目录中的关键文件为：

- `ss-auth-002-local-credentials.json`：测试账号及独立 Hydra/Client/Hook/Broker Secret，权限 `0600`；
- `ss-auth-002-starstack.sqlite` 及现存 `-journal`/`-wal`/`-shm`：纯本地、可重建的 StarStack fixture SQLite 单元；
- `state-identity.json`：不含 Secret 的 DSN 身份标记；
- `.credentials-rotation.pending.json`：只在未完成轮换时存在，存在即阻止普通运行器；
- `runtime.lock`：覆盖 reset、migration、protocol 和 run-local 的独占运行锁；
- `runtime.lock.operation`：只保护锁文件 acquire/release 的毫秒级临界区。

协议末尾会停止自身服务，再实际启动一次 `run-local-runtime.mjs`：不仅要求 Public Discovery/JWKS 为 HTTP 200，还会完成一次真实 Authorization Code + PKCE 签发，以 ID Token header 的 `kid` 证明 active RS256 signing key 与公开 JWKS、协议重启前 `kid` 一致。随后通过 Logout Broker 清理协议 SID，并删除只承载协议历史的 StarStack fixture SQLite，让下一个 Jieya E2E/手工联调以同一 Hydra JWK、Client 和凭据重建干净测试账号。新凭据值不会输出到日志；每次协议门禁都会使此前的本地 fixture 凭据失效。

启动可供 Jieya BFF 联调的运行时：

```bash
HYDRA_TEST_BINARY=/tmp/jy-auth-runtime-hydra-pg-16.15/hydra/hydra \
HYDRA_TEST_DSN='postgres://hydra_test@127.0.0.1:55432/hydra_test?sslmode=disable' \
npm run identity:hydra:run
```

启动器会先安全创建或打开 canonical fixture 主库并固定 inode，把精确身份交给 StarStack；StarStack 使用 SQLite `NOFOLLOW` 标志打开，初始化后父子双方再复核主库及 rollback journal/WAL/SHM。随后才会幂等执行 Hydra migration、创建或更新 `jieya-server-local` 并启动 Hydra 与 StarStack；只有 SQLite 单元、固定客户端、Public Discovery 和 JWKS 全部验证通过后才输出 `ready: true`。它不占用 Jieya 的 `4180`；Jieya BFF 应自行监听该端口。按 `Ctrl+C` 会同时停止 Hydra 与 StarStack，不停止共享 PostgreSQL。

界芽当前测试脚本仍需显式获得新的机器 canonical 路径：

```bash
HYDRA_TEST_BINARY=/tmp/jy-auth-runtime-hydra-pg-16.15/hydra/hydra \
HYDRA_TEST_DSN='postgres://hydra_test@127.0.0.1:55432/hydra_test?sslmode=disable' \
IDENTITY_TEST_CREDENTIALS_FILE="$HOME/.local/state/starstack/identity/hydra-test-57eae204b3826d2c/ss-auth-002-local-credentials.json" \
STARSTACK_ROOT=/Users/hht/Desktop/star-stack \
npm run test:auth:e2e
```

## 中断与恢复

- `SIGINT`/`SIGTERM` 会先停止并等待当前 migration、Hydra、StarStack 等全部直接子进程，再释放运行锁；5 秒内不退出的子进程会被强制终止。脚本不会在子进程监听器安装前宣告 ready。
- 普通 stale `runtime.lock` 会在 operation guard 内按 PID、token 与 inode 复核后原子移入唯一 quarantine，再删除并获取新锁；多个 checkout 同时回收时最多一个成功。
- `.credentials-rotation.pending.json` 存在时不要删除、改权限或单独替换凭据。先确认 `4444/4445/5174/4180` 无监听，再重新执行完整 `identity:hydra:protocol`；门禁会在同一机器锁下恢复或重新完成该轮换。
- `runtime.lock.operation` 从不自动判定 stale，避免为修复 stale guard 再引入同一种 check→unlink 竞态。如果它在进程异常终止后残留，先同时确认四个端口无监听、锁文件记录的 PID 已不存在，并通过 PostgreSQL 查询确认 `hydra_test` 无其他连接；之后只把该 guard 原子 `mv` 到同目录唯一 quarantine 名称，不要直接 `rm`，再重跑完整协议门禁。
- 状态目录、marker、凭据、锁或 fixture SQLite/sidecar 发生 symlink、hard link、UID、类型、权限、realpath/inode 校验失败时，不要用 `chmod`、删除链接或复制单个旧文件绕过。确认进程和数据库连接均为空后，将整个 DSN 状态目录移动到仓库外的隔离 quarantine，运行完整协议门禁同时重建数据库与新凭据；旧目录中的测试 Secret 随即失效。
- 恢复后必须再次验证：协议门禁成功、真实 ID Token `kid` 连续、界芽 E2E 6/6、凭据 `0600`、状态目录 `0700`、pending/两层锁不存在，以及四个端口全部释放。

## Compose 备用方案

1. 从 `infra/identity/.env.example` 创建被 Git 忽略的 `.env.identity`，为每项独立生成至少 32 个随机字节，不得复用任何主站、客户端、Hook 或 Broker Secret。
2. 启动固定镜像：

```bash
docker compose --env-file infra/identity/.env.identity \
  -f infra/identity/compose.yaml up -d postgres hydra-migrate hydra

set -a
source infra/identity/.env.identity
set +a
npm run identity:hydra:bootstrap
npm run identity:hydra:verify
```

Hydra 同时连接内部数据库网络与只供 StarStack Hook 使用的出站网络；PostgreSQL 仍只在内部数据库网络中。

## 本地端点与客户端

| 项目 | 值 |
|---|---|
| issuer | `http://auth.localhost:5174` |
| Hydra Public（上游） | `http://127.0.0.1:4444` |
| Hydra Admin（私网） | `http://127.0.0.1:4445` |
| Client ID | `jieya-server-local` |
| callback | `http://jieya.localhost:4180/auth/callback` |
| logout callback | `http://jieya.localhost:4180/auth/logout/callback` |
| back-channel logout | `http://jieya.localhost:4180/auth/backchannel-logout` |

客户端只允许 Authorization Code、Refresh Token、`client_secret_basic` 与 `openid profile offline_access`。Hydra Discovery 同时公布 `plain`，但 StarStack Login challenge policy 只接受 S256。
Refresh Token 每次旋转，运行时显式配置 `rotation_grace_period=0s` 与 `rotation_grace_reuse_count=0`，旧 Token 不保留并发宽限。

浏览器 Cookie 采用严格隔离：Hydra 的四个基础 Cookie 名由运行时固定，开发模式按 Hydra v26.2.0 追加 `_dev`，Login/Consent CSRF 再追加固定 Client ID 的 Murmur3 后缀。StarStack Public 代理只接受最终计算出的精确名称，不接受前缀或任意 Cookie；请求会剥离 `starstack_auth_dev`/`__Host-starstack_auth`，响应也无法写入同名账号 Cookie。允许的 Hydra Cookie 被统一重写为 `Path=/oauth2; HttpOnly; SameSite=Lax`，生产再强制 `Secure` 且移除 `Domain`。

Logout Broker 私网请求头固定为 `X-StarStack-Logout-Broker`，成功响应固定为 HTTP `201` 与 `{ "url", "expires_at" }` 两个字段。Hydra v26.2.0 的 Back-Channel Logout Token protected header 固定验证 `alg=RS256`、`typ=JWT` 与非空 `kid`。

## 生产停止线

`serve all --dev` 和 `sslmode=disable` 只用于 loopback。生产前至少还需要：

- 去掉 `--dev`，启用 `auth.xingzhan.cc` TLS 与可信代理配置；
- PostgreSQL TLS、独立服务账号、备份/恢复演练和容量监控；
- Secret 管理与系统/Client Secret 轮换演练；
- Admin/数据库私网 ACL，Public 与 StarStack 页面路由分离；
- 固定 Linux 架构镜像来源校验；
- 用生产等价网络重跑 migration、protocol、重启、Refresh 重放、#4070 竞态和 Back-Channel Logout；
- 先备份并验证 StarStack SQLite；不得重新生成已签发的 `account_subject`。
