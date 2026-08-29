# StarStack 本地 Hydra 身份运行时

这里是 SS-AUTH-002 的隔离开发运行时，不是生产部署文件。OIDC 默认关闭；任何 Secret、fixture SQLite 与下载的二进制均位于被 Git 忽略且权限为 `0600/0700` 的 `.identity-runtime/`。

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

门禁成功后会保留：

- `.identity-runtime/ss-auth-002-starstack.sqlite`：纯本地 fixture StarStack 数据库；
- `.identity-runtime/ss-auth-002-local-credentials.json`：测试账号及独立 Hydra/Client/Hook/Broker Secret，权限 `0600`。

启动可供 Jieya BFF 联调的运行时：

```bash
HYDRA_TEST_BINARY=/tmp/jy-auth-runtime-hydra-pg-16.15/hydra/hydra \
HYDRA_TEST_DSN='postgres://hydra_test@127.0.0.1:55432/hydra_test?sslmode=disable' \
npm run identity:hydra:run
```

启动器会幂等执行 Hydra migration、创建或更新 `jieya-server-local`，然后启动 Hydra 与 StarStack。它不占用 Jieya 的 `4180`；Jieya BFF 应自行监听该端口。按 `Ctrl+C` 会同时停止 Hydra 与 StarStack，不停止共享 PostgreSQL。

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
