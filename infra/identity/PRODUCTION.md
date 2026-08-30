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

Hydra container -> jieya.xingzhan.cc:host-gateway:443
                   | canonical HTTPS + SNI/certificate verification
                   | exact Hydra source /32 only
                   v
              existing Jieya TLS Nginx -> Jieya BFF 127.0.0.1:4180

Hydra -> identity-database (internal) -> PostgreSQL 16.15 (no host port)
Hydra Admin -> host 127.0.0.1:4445 only
Jieya BFF (same host) -> 127.0.0.1:5174/internal/oidc/logout-transactions
```

禁止把 Node 改为 `0.0.0.0`，禁止 `network_mode: host`，禁止公开 Admin、PostgreSQL、Token Hook 或 Logout Broker。Hydra Public/Admin 的 Compose 发布地址必须保留 `127.0.0.1`。专用 hook 网络保持 `internal: true`；只有确认目标 Docker 版本能从该 bridge 到达其 host-gateway 后才能继续。

生产 Jieya BFF 与 StarStack 同机。Logout Broker 的唯一合法地址固定为 `http://127.0.0.1:5174/internal/oidc/logout-transactions`，只能由 Jieya 服务端携带独立私网凭据调用；不经过 `auth.xingzhan.cc`、Cloudflare、Public Hydra proxy 或 Token Hook bridge。公网身份 Nginx 对 `/internal/oidc/*` 始终返回 404，不为 Broker 新建 bridge 或公网入口。

Hydra 客户端注册中的 Back-Channel Logout URI 仍固定为 canonical `https://jieya.xingzhan.cc/auth/backchannel-logout`。Compose 只在 Hydra 容器内把该精确主机名解析到 `host-gateway`，请求仍使用原主机名完成 TLS SNI 与证书主机名校验；不得改成 IP、HTTP、公网绕行或关闭证书校验。该精确 location 只能合并到现有 `jieya.xingzhan.cc` TLS server，并仅允许 Hydra 在 `identity-hook` 网络中的固定源地址 `/32`，其他来源一律拒绝。它不新增 `listen`，也不把 BFF 的 4180 端口暴露给容器或公网。

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
4. 保留 Jieya 已启用站点中的唯一精确 Back-Channel location，用 `identity:production:render-backchannel-nginx` 只生成该 location 已 include 的 access snippet。`IDENTITY_HYDRA_HOOK_IP` 必须是 hook bridge 内为 Hydra 保留的固定可用地址；snippet 只允许这个 `/32`，并固定 POST-only 与私有路由标记，不能包含第二个 location、proxy 或额外 allow。
5. 创建 root 所有、普通用户不可写的 `/var/lib/acme/.well-known/acme-challenge` webroot；`auth.xingzhan.cc.conf` 的 80 server 只从该目录读取精确 HTTP-01 token，其他 HTTP 请求才执行 308。不得让 ACME challenge 进入 StarStack/Hydra，也不得让 Certbot 自动改写已审计模板。
6. 将 `auth.xingzhan.cc.conf` 合并进现有 TLS 配置；不得覆盖 1Panel/Certbot 的证书配置。公网模板明确拒绝 `/internal/oidc/`。
7. 运行下面的只读预检。它只读文件、资源、Compose 渲染及可选 HTTP 健康状态，不执行 pull/up/migrate/reload/写库。
8. 另行审批后才允许在 staging 执行镜像拉取、migration、客户端创建与真实协议测试。SS-AUTH-003 不执行这一步。

两个渲染器只向标准输出写配置，不直接修改 Nginx。先将输出放入仓库外的候选文件；Back-Channel 输出目标固定为 Jieya 站点实际 include 的 `/etc/nginx/snippets/jieya-backchannel-access.conf`，不能另存一个未 include 的完整 location 冒充生效配置。审查无占位符、执行 `nginx -t`，再由独立变更审批决定是否安装/reload：

```bash
IDENTITY_HOST_GATEWAY_IP=172.17.0.1 IDENTITY_HOOK_SUBNET=172.30.40.0/29 \
  npm run identity:production:render-hook-nginx
IDENTITY_HOST_GATEWAY_IP=172.17.0.1 IDENTITY_HOOK_SUBNET=172.30.40.0/29 \
  IDENTITY_HYDRA_HOOK_IP=172.30.40.2 npm run identity:production:render-backchannel-nginx
```

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
export IDENTITY_NGINX_BCL_SITE_CONFIG=/etc/nginx/sites-enabled/jieya.xingzhan.cc
export IDENTITY_NGINX_BCL_ACCESS_CONFIG=/etc/nginx/snippets/jieya-backchannel-access.conf
# 1Panel/OpenResty 使用其他二进制时必须填写现场验证过的命令路径。
export IDENTITY_NGINX_BIN=nginx
export IDENTITY_HOST_GATEWAY_IP=172.17.0.1
export IDENTITY_HOOK_SUBNET=172.30.40.0/29
export IDENTITY_HYDRA_HOOK_IP=172.30.40.2
export POSTGRES_TLS_CERT_FILE=/etc/starstack/identity/postgres/server.crt
export POSTGRES_TLS_KEY_FILE=/etc/starstack/identity/postgres/server.key
export POSTGRES_TLS_CA_FILE=/etc/starstack/identity/postgres/ca.crt
npm run identity:production:preflight
```

静态预检会以 `nginx -T` 在内存中核对：Jieya 站点与 access snippet 都进入当前 active config、精确 location 全局只出现一次、site 确实 include 该 snippet，且动态 ACL/POST 限制/marker 与静态 proxy/header 组合完整。配置 dump 不写日志。运行时已由另行审批启动后，才可加 `IDENTITY_PREFLIGHT_RUNTIME=1` 校验 Hydra Admin ready、Public Discovery 与 JWKS。预检成功仍不代表可把 `OIDC_ENABLED` 改为 true。

### HTTP-01 自动续期边界

身份域证书运行路径固定为 `/etc/letsencrypt/live/auth.xingzhan.cc/fullchain.pem` 与 `privkey.pem`。在 DNS 尚未发布时通过手工 DNS-01 签发的证书必须明确标记为 manual，不能宣称自动续期完成。

切换到 HTTP-01 前，先安装本仓库受审计的 80 server，并用本地 `--resolve` 证明：存在 token 返回精确内容，不存在 token 返回 404，POST/PUT 被拒绝，其他 HTTP 路径才返回同 Host HTTPS 308。之后才可发布 A 记录，使用 ACME staging 的独立临时证书名验证 webroot；staging 绿色后再显式更新 production renewal method，并执行 dry-run。续期 hook 只能在 `nginx -t` 成功后 reload。整个续期转换不授权启用 OIDC、启动 Hydra 或修改 443 身份代理范围。

### Back-Channel TLS 现场硬门禁

Hydra 已由另行审批启动、Jieya BFF 仍只监听 loopback 后，必须在启用 OIDC 前执行只读链路证明。验证器不重启容器、不迁移数据库、不读取客户端 Secret；它进入 Hydra 容器的网络 namespace，确认到 `host-gateway:443` 的路由源地址精确等于 `IDENTITY_HYDRA_HOOK_IP`，再用 canonical SNI 和系统 CA 校验证书，发送一个不含凭据的无效 Back-Channel POST。只有得到 BFF 的预期拒绝状态（400/401/422）和私有 location 标记才通过；Nginx allowlist 的 403、错误 server 的 404、上游失败或证书失败都必须停止。

```bash
export IDENTITY_ENVIRONMENT=production
export IDENTITY_COMPOSE_FILE=/opt/star-stack/infra/identity/compose.production.yaml
export IDENTITY_ENV_FILE=/etc/starstack/identity/production.env
export IDENTITY_HOST_GATEWAY_IP=172.17.0.1
export IDENTITY_HYDRA_HOOK_IP=172.30.40.2
export IDENTITY_TLS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt
npm run identity:production:verify-backchannel
```

服务器必须先实测 Docker Engine 对 `internal: true` 的 `identity-hook` bridge 支持到 host-gateway:443 的这条路由。若 route 不存在、源地址不是固定 `/32`、证书链/主机名校验失败、1Panel 无法安全合并精确 location，或 Nginx 只能放宽到子网/公网，立即停止；不得移除 `internal`、改用 `network_mode: host`、开放 4180、关闭 TLS 验证或改写 canonical URI。

### 公网日志、HSTS 与客户端地址边界

- 身份域 HSTS 只设置当前 host 的 `max-age=31536000`，不包含 `includeSubDomains`。只有全部相关子域持续 HTTPS 的独立审计通过后才能另行评估扩大范围。
- 身份 server 关闭 Nginx access log，因为默认 `$request` 会记录完整查询串，其中包含 login/consent challenge、state、nonce 和 PKCE 元数据。应用与 Hydra 日志仍必须保持敏感值脱敏；排障使用状态码、计数与 request ID，不能临时恢复完整 URI 日志。
- 模板用 `X-Forwarded-For $remote_addr` 覆盖客户端提供的整条链，不使用 `$proxy_add_x_forwarded_for`。StarStack 保持 `TRUST_PROXY_HOPS=1`，只信任直接相邻的本机 Nginx。
- 若 Cloudflare 位于源站前，Nginx `real_ip` 只能信任 Cloudflare 官方当前 CIDR，并从其受保护头恢复 `$remote_addr`；源站防火墙还应限制 443 只接受 Cloudflare 与运维来源。在这些现场事实未验证时，`$remote_addr` 可能只是 Cloudflare edge，限流会保守地合并到 edge IP；这会降低可用性但不会信任浏览器伪造链，身份必须继续关闭。

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
- Cloudflare 源站 ACL、Nginx `real_ip` 可信 CIDR及实测 `$remote_addr`；未确认时不得按用户 IP 放宽限流。
- Docker bridge 的空闲 RFC1918 `/29`、host-gateway IP、Hydra 固定 hook 源 `/32`，并证明 internal bridge 可达 5175 以及 host-gateway:443；后者必须通过 canonical SNI/CA 校验和 Jieya 私有 location 精确 allowlist。
- 1Panel 是否会重写手工 Nginx include，以及 bridge listener 的防火墙/SELinux/AppArmor 状态。
- Jieya BFF 必须继续与 StarStack 同机，并保持固定 loopback Broker URL；任何跨主机迁移都要重新设计私网与认证边界，不能改用公网身份域。
- PostgreSQL TLS 私钥对应的固定容器 UID、备份目录/保留期/离机复制、监控与告警渠道。
- 首次客户端创建、Client Secret 轮换、Hydra migration 和 `OIDC_ENABLED=true` 各自的审批窗口。

没有以上服务器只读证据时，本阶段唯一安全状态是 Compose 不启动、PM2 `OIDC_ENABLED=false`。
