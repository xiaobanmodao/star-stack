# SS-AUTH-003：Hydra 生产预发布底座

## 状态

- 分支：`codex/ss-auth-003-production-staging`
- 基线：`origin/main@f3f5e9aa28570165b04935f528584210cbf5e192`
- R4 范围：生产/预发布配置与只读门禁；不部署、不启用、不写入真实 Secret 或真实用户 fixture。
- 实现状态：本地完成，待服务器预发布只读复核；身份仍关闭。

## 已授权范围

- 独立于 `infra/identity/compose.yaml` 的 production/staging Compose 与 Hydra 配置。
- 固定 Hydra v26.2.0、PostgreSQL 16.15 镜像 digest。
- Hydra Public/Admin 只发布到宿主 loopback；PostgreSQL 只在内部网络。
- Hydra Token Hook 经专用 bridge、host-gateway 和受限 Nginx 精确路径回调；StarStack Node 继续只监听 loopback。
- PM2 默认 `OIDC_ENABLED=false`，生产 issuer/客户端元数据保持冻结值。
- `auth.xingzhan.cc` 公网模板必须拒绝 `/internal/oidc/`；bridge 模板只允许固定 subnet 的精确 Token Hook POST。
- PostgreSQL/SQLite 备份集、隔离恢复说明和不改变服务器状态的预发布检查。

## 明确禁止

- 不复用或覆盖开发 Compose、开发 volume、开发 Secret 或本地 fixture。
- 不使用 `--dev`、`sslmode=disable`、`network_mode: host`。
- 不把 StarStack Node 或 Hydra 宿主端口绑定到 `0.0.0.0`。
- 不公开 Hydra Admin、PostgreSQL、Token Hook 或 Logout Broker。
- 不运行生产迁移、客户端注册、恢复或部署；不修改界芽仓库。

## 停止线

- 主机 bridge/CIDR、Nginx/1Panel 文件归属、Jieya BFF 私网位置或 TLS/备份目标未确认时不得部署。
- 任何真实 Secret 进入 Git、日志、命令输出或不安全文件时立即停止。
- 2C2GiB 混合负载出现 OOM、持续 swap、进程重启或评测明显回退时保持身份关闭。
- 备份不能隔离恢复、active signing `kid` 不连续、旧 Token 可重放或内部端口公网可达时保持身份关闭。

## 验收证据

- 失败测试先行并覆盖配置隔离、固定镜像、端口、网络、Secret 占位、Nginx allowlist、PM2 默认关闭与只读预检。
- `npm run lint`、`npm test -- --run`、`npm run build`、`npm run audit:deps`、`git diff --check`。
- 使用固定 Hydra 二进制对 production/staging YAML 做真实启动解析；只连接 SS-AUTH-002 的 canonical `hydra_test` fixture 并复用其匹配 Secret，不接触生产数据库、不执行 migration/client 写入。
- 本机没有 Docker/Compose CLI，因此本地只完成 YAML 解析和静态 Compose 契约测试；服务器上的 `docker compose config --quiet` 是只读预检硬门禁，未通过前禁止启动。

## 本地完成证据

- 失败测试初始 7/7 失败；实现后 production contract 11/11 通过。
- `npm run lint`：通过。
- `npm test -- --run`：45 files / 253 tests 通过。
- `npm run build`：通过。
- `npm run audit:deps`：Critical=0；前端 Moderate=2，后端 High=3/Moderate=1/Low=2 为既有依赖风险，未由本任务新增。
- `npm run db:verify`：SQLite integrity/foreign keys/身份 schema 通过，只读。
- 临时无真实用户 API：`SMOKE_BASE_URL=http://127.0.0.1:5180 npm run test:smoke` 通过，临时数据库已删除。
- `identity:hydra:protocol`：7/7 通过；授权码+PKCE、Refresh 重放、全局退出、Back-Channel、重启与 active signing kid 连续性均通过。
- `identity:production:verify-config`：production/staging Discovery、JWKS、S256、RS256 与 signing key 连续性通过。
- 结束时 `4444/4445/5174/4180/5180` 均无监听。

## 服务器只读信息缺口

- Docker Engine/Compose 精确版本、CPU/内存/swap/磁盘和现有容器资源占用。
- 1Panel/Nginx 实际 include、证书路径、Cloudflare 模式及 `auth.xingzhan.cc` DNS 状态。
- 空闲 RFC1918 `/29`、`host-gateway` 解析地址、Public 代理进入 Hydra 的实际源 `/32`，以及 internal hook bridge 到 5175 的连通性。
- 固定 PostgreSQL 镜像内 `postgres` UID、TLS 文件现状、备份目录/保留/离机目标。
- Jieya BFF 私网出口和 Logout Broker 的服务端专用网络边界。
