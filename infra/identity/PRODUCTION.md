# StarStack 身份服务生产预发布手册

本手册对应 SS-AUTH-003 的方案 A。它只建立可审查的生产/预发布底座，默认不启用 OIDC，也不授权直接部署。开发运行时仍只使用 `compose.yaml`；production/staging 不能复用开发数据库、volume、Secret、Cookie 后缀或 `--dev` 参数。

## 冻结拓扑

```text
Internet -> Cloudflare/1Panel Nginx :443 -> StarStack Node 127.0.0.1:5174
                                            | public protocol proxy
                                            v
                                    Hydra 127.0.0.1:4444

Hydra container -> internal hook bridge -> Nginx bridge-IP:5175
                                           | exact POST + CIDR allowlist
                                           v
                                    StarStack Node 127.0.0.1:5174

Hydra -> identity-database (internal) -> PostgreSQL 16.15 (no host port)
Hydra Admin -> host 127.0.0.1:4445 only
```

禁止把 Node 改为 `0.0.0.0`，禁止 `network_mode: host`，禁止公开 Admin、PostgreSQL、Token Hook 或 Logout Broker。Hydra Public/Admin 的 Compose 发布地址必须保留 `127.0.0.1`。专用 hook 网络保持 `internal: true`；只有确认目标 Docker 版本能从该 bridge 到达其 host-gateway 后才能继续。

## 文件与版本

- production：`compose.production.yaml`、`hydra.production.yaml`、`postgres.production.pg_hba.conf`
- staging：`compose.staging.yaml`、`hydra.staging.yaml`、`postgres.staging.pg_hba.conf`
- Hydra：`v26.2.0-distroless`，固定 digest `sha256:ad53a123...d60c5e`
- PostgreSQL：`16.15-alpine3.24`，固定 digest `sha256:cf78e766...20685`
- production 与 staging 使用不同项目名、network、volume、数据库用户和全部 Secret；二者不得同时在 2C2GiB 主机常驻。

## Secret 与文件权限

生产需要六个互不相同、至少 32 字节的随机值：

- `HYDRA_POSTGRES_PASSWORD`
- `HYDRA_SYSTEM_SECRET`
- `HYDRA_COOKIE_SECRET`
- `OIDC_TOKEN_HOOK_SECRET`
- `OIDC_LOGOUT_BROKER_SECRET`
- `JIEYA_OIDC_CLIENT_SECRET`

从 `production.env.example` 或 `staging.env.example` 复制名称到仓库外文件。文件必须为普通单链接文件、`0600`（或受控身份运维组的 `0640`），不能经 symlink 到达。Secret 不得出现在 Git、PM2/Nginx 日志、Shell history、工单或聊天中。Hydra system/cookie Secret 与 PostgreSQL 数据库是同一恢复单元，不能只轮换文件后挂回旧库。

PostgreSQL TLS 证书的 SAN 必须包含容器 DNS 名 `postgres`。固定 Alpine 镜像中的 `postgres` UID 必须在服务器只读检查后记录；私钥设为该 UID 所有、`0600`，证书与 CA 可为 root 所有、`0644`。不得为了让容器读取私钥而改成全局可读。

## 预发布顺序（保持关闭）

1. 只读确认 Docker/Compose、Nginx/1Panel 布局、Cloudflare 模式、空闲端口、bridge CIDR、磁盘、内存、swap、当前 SQLite/备份状态。
2. 创建独立 Secret、PostgreSQL TLS 材料和 production/staging env 文件；此时 `OIDC_ENABLED=false`。
3. 用 `identity:production:render-hook-nginx` 输出 bridge Nginx 配置到标准输出，由管理员审查后安装。监听地址是服务器实测的 Docker `host-gateway` RFC1918 地址；allowlist 是独立 hook bridge 的 RFC1918 `/28`～`/30` 小网段，两者通常不是同一网段。
4. 将 `auth.xingzhan.cc.conf` 合并进现有 TLS 配置；不得覆盖 1Panel/Certbot 的证书配置。公网模板明确拒绝 `/internal/oidc/`。
5. 运行下面的只读预检。它只读文件、资源、Compose 渲染及可选 HTTP 健康状态，不执行 pull/up/migrate/reload/写库。
6. 另行审批后才允许在 staging 执行镜像拉取、migration、客户端创建与真实协议测试。SS-AUTH-003 不执行这一步。

```bash
export NODE_ENV=production OIDC_ENABLED=false
export OIDC_ISSUER=https://auth.xingzhan.cc
export OIDC_HYDRA_PUBLIC_URL=http://127.0.0.1:4444
export OIDC_HYDRA_ADMIN_URL=http://127.0.0.1:4445
export OIDC_TOKEN_HOOK_URL=http://host.docker.internal:5175/internal/oidc/token-hook
export IDENTITY_COMPOSE_FILE=/opt/star-stack/infra/identity/compose.production.yaml
export IDENTITY_ENV_FILE=/etc/starstack/identity/production.env
export IDENTITY_NGINX_AUTH_CONFIG=/etc/nginx/sites-enabled/auth.xingzhan.cc
export IDENTITY_NGINX_HOOK_CONFIG=/etc/nginx/conf.d/starstack-token-hook.conf
export POSTGRES_TLS_CERT_FILE=/etc/starstack/identity/postgres/server.crt
export POSTGRES_TLS_KEY_FILE=/etc/starstack/identity/postgres/server.key
export POSTGRES_TLS_CA_FILE=/etc/starstack/identity/postgres/ca.crt
npm run identity:production:preflight
```

运行时已由另行审批启动后，可加 `IDENTITY_PREFLIGHT_RUNTIME=1`，只读校验 Hydra Admin ready、Public Discovery 与 JWKS。预检成功仍不代表可把 `OIDC_ENABLED` 改为 true。

## 2C2GiB 资源预算与停止线

| 项目 | 门禁预算 |
| --- | ---: |
| 操作系统、Docker、Nginx、PM2 基础 | 350～500 MiB |
| StarStack Node（PM2 上限） | 500 MiB |
| 单个判题任务 | 最多 256 MiB，`JUDGE_CONCURRENCY=1` |
| PostgreSQL 容器 | 384 MiB，30 connections，64 MiB shared buffers |
| Hydra 容器 | 256 MiB |
| 峰值余量 | 至少 250 MiB，且不能持续 swap |

staging 不与 production 同机常驻。出现 OOM、持续 swap、PM2/容器重启、健康检查超时、判题延迟显著回退或可用内存长期低于 250 MiB，立即保持/恢复 `OIDC_ENABLED=false` 并停止继续启用。至少保留 5 GiB 可用磁盘；PostgreSQL volume、Docker 日志与双数据库备份必须纳入磁盘告警。

## 备份与隔离恢复演练

身份备份必须同时包含 StarStack SQLite 和 Hydra PostgreSQL，生成同一 manifest 与 SHA-256。PostgreSQL 不发布宿主端口，脚本通过固定 Compose 的 `postgres` 服务执行 `pg_dump`，不会临时开放端口。宿主需要 `sqlite3` 与 PostgreSQL 16 客户端的 `pg_restore`。

```bash
export IDENTITY_BACKUP_CONFIRM=CREATE_VERIFIED_BACKUP
export IDENTITY_ENVIRONMENT=production
export IDENTITY_BACKUP_DIR=/srv/backups/starstack-identity
export STARSTACK_DB_PATH=/opt/star-stack/server/data/starstack.sqlite
export IDENTITY_COMPOSE_FILE=/opt/star-stack/infra/identity/compose.production.yaml
export IDENTITY_ENV_FILE=/etc/starstack/identity/production.env
npm run identity:production:backup

export IDENTITY_BACKUP_SET=/srv/backups/starstack-identity/starstack-identity-YYYY-MM-DD_HH-MM-SS
npm run identity:production:verify-backup
```

恢复演练必须在隔离主机或独立 Docker project/network/volume 中进行，目标数据库和 SQLite 路径必须为空且不能指向生产。步骤是：验证 manifest/hash；把 SQLite 复制到隔离路径并执行 `PRAGMA integrity_check`、迁移和核心计数；在新的 PostgreSQL 16.15 空库执行 `pg_restore --exit-on-error --clean --if-exists`；使用与备份绑定的 Hydra system/cookie Secret 启动隔离 Hydra；验证 Discovery/JWKS、active signing `kid`、授权码+PKCE、Refresh 轮换/重放和全局退出。任何一项失败都不得覆盖生产 volume 或 SQLite。生产恢复需要独立变更审批、停写窗口和恢复前二次备份。

## 启用前仍需确认

- `auth.xingzhan.cc` DNS、Cloudflare TLS 模式、源站证书路径与真实 Nginx include 归属。
- Docker bridge 的空闲 RFC1918 `/29`、host-gateway IP、Hydra 实际代理源 `/32`，并证明 internal bridge 可达 5175。
- 1Panel 是否会重写手工 Nginx include，以及 bridge listener 的防火墙/SELinux/AppArmor 状态。
- Jieya BFF 到私有 Logout Broker 的网络与双向认证边界；公网模板不会开放它。
- PostgreSQL TLS 私钥对应的固定容器 UID、备份目录/保留期/离机复制、监控与告警渠道。
- 首次客户端创建、Client Secret 轮换、Hydra migration 和 `OIDC_ENABLED=true` 各自的审批窗口。

没有以上服务器只读证据时，本阶段唯一安全状态是 Compose 不启动、PM2 `OIDC_ENABLED=false`。
