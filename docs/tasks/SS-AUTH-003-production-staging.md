# SS-AUTH-003：Hydra 生产预发布底座

## 状态

- 分支：`codex/ss-auth-003-nginx-canonical-marker`
- 基线：`origin/main@12b35d06108d7e6af95ce0949b53c1a0e29ba49c`
- R4 范围：生产/预发布配置与只读门禁；不部署、不启用、不写入真实 Secret 或真实用户 fixture。
- 实现状态：原 SS-AUTH-003、Back-Channel 私网路由、HTTP-01 与组合预检已合并；本分支修复 Debian Nginx `sites-enabled` marker 与受审计 `sites-available` 普通文件之间的 canonical 激活证明，不授权启动、迁移、发布 DNS 或启用身份。

## 已授权范围

- 独立于 `infra/identity/compose.yaml` 的 production/staging Compose 与 Hydra 配置。
- 固定 Hydra v26.2.0、PostgreSQL 16.15 镜像 digest。
- Hydra Public/Admin 不使用 Docker 端口发布，只经宿主 Nginx bridge 暴露在固定 IPv4 loopback；PostgreSQL 只在内部网络。
- Hydra Token Hook 经 internal hook bridge 的显式 gateway 和受限 Nginx 精确路径回调；StarStack Node 继续只监听 loopback。
- PM2 默认 `OIDC_ENABLED=false`，生产 issuer/客户端元数据保持冻结值。
- `auth.xingzhan.cc` 公网模板必须拒绝 `/internal/oidc/`；bridge 模板只允许固定 Hydra `/32` 的精确 Token Hook POST。
- Jieya BFF 与 StarStack 同机，Logout Broker 唯一固定为 `http://127.0.0.1:5174/internal/oidc/logout-transactions`；不增加公网或 bridge 入口。
- production/staging Hydra 只在容器内把 `host.docker.internal` 与 canonical `jieya.xingzhan.cc` 映射到 internal hook 自身显式 gateway；Back-Channel Logout 始终使用 HTTPS/SNI/CA 校验，并只允许 Hydra 固定 hook `/32` 进入 Jieya 的精确 location。
- Compose 不再声明在 all-internal topology 中无效的 Hydra `ports`。宿主 Nginx 只在 `127.0.0.1` 提供 Public/Admin bridge，并反代到 Hydra 固定 hook IP；无第三个非 internal 网络，也无额外 egress。
- hook gateway UFW 保持 default-deny incoming，只允许 Hydra `/32` 从固定 bridge 到 gateway TCP 443/5175，再显式拒绝该 bridge 的其余 INPUT；禁止整个 `/29`、其他接口或其他端口。
- Jieya 保持实际 Back-Channel location 的所有权；StarStack renderer 只生成被该 location 精确 include 的 access snippet，preflight 必须证明 site/snippet 同时进入 active Nginx、全局无重复 location，且动态 ACL 与静态 proxy/header 组合完整。
- 预检变量必须指向 `sites-available` 中受审计的普通单链接 auth/Jieya 文件；`nginx -T` 可以通过 `sites-enabled` 的一跳直接 symlink 加载它们，但 marker `realpath` 必须精确一致。断链、多跳、目录 symlink、不同目标、重复 marker 和未加载文件一律失败；access snippet 不允许 symlink。
- `auth.xingzhan.cc` 的 HTTP-01 只读取 `/var/lib/acme` 下的精确 challenge 文件；其他 HTTP 请求才重定向 HTTPS，challenge 不进入 StarStack/Hydra。
- 身份域 HSTS 不扩散到未审计子域；关闭含查询串的 access log，并覆盖客户端传入的 X-Forwarded-For 链。
- PostgreSQL/SQLite 备份集、隔离恢复说明和不改变服务器状态的预发布检查。

## 明确禁止

- 不复用或覆盖开发 Compose、开发 volume、开发 Secret 或本地 fixture。
- 不使用 `--dev`、`sslmode=disable`、`network_mode: host`。
- 不把 StarStack Node 或 Hydra 宿主端口绑定到 `0.0.0.0`。
- 不公开 Hydra Admin、PostgreSQL、Token Hook 或 Logout Broker。
- 不把 Back-Channel URI 改成 IP/HTTP，不关闭 TLS 验证，不向公网或整个 bridge 子网开放 Jieya Back-Channel location。
- 不允许 Certbot/acme.sh 自动改写仓库管理的 Nginx 模板，也不把手工 DNS-01 证书误记为已自动续期。
- 不保存未被 active Nginx include 的完整 Back-Channel location 来伪造预检成功，也不向 Jieya server 重复 include 同名 location。
- 不运行生产迁移、客户端注册、恢复或部署；不修改界芽仓库。

## 停止线

- 主机 bridge/CIDR、Nginx/1Panel 文件归属、Jieya BFF 私网位置或 TLS/备份目标未确认时不得部署。
- host→Hydra 4444/4445、Hydra→hook gateway 443/5175、loopback listener、UFW exact rules 任一不成立，实际源不等于冻结 `/32`，canonical 证书校验失败或 BCL 精确 allowlist 无法安装时立即停止，不得放宽网络。
- Jieya site 未精确 include access snippet、active Nginx 中 exact Back-Channel location 不唯一、snippet 含额外/loopback allow，或缺少 POST-only/private marker 时立即停止。
- 任何真实 Secret 进入 Git、日志、命令输出或不安全文件时立即停止。
- 2C2GiB 混合负载出现 OOM、持续 swap、进程重启或评测明显回退时保持身份关闭。
- 备份不能隔离恢复、active signing `kid` 不连续、旧 Token 可重放或内部端口公网可达时保持身份关闭。

## 验收证据

- 失败测试先行并覆盖配置隔离、固定镜像、端口、网络、Secret 占位、Nginx allowlist、PM2 默认关闭与只读预检。
- `npm run lint`、`npm test -- --run`、`npm run build`、`npm run audit:deps`、`git diff --check`。
- 使用固定 Hydra 二进制对 production/staging YAML 做真实启动解析；只连接 SS-AUTH-002 的 canonical `hydra_test` fixture 并复用其匹配 Secret，不接触生产数据库、不执行 migration/client 写入。
- 本机没有 Docker/Compose CLI，因此本地只完成 YAML 解析和静态 Compose 契约测试；服务器上的 `docker compose config --quiet` 是只读预检硬门禁，未通过前禁止启动。

## 本地完成证据

- 原阶段失败测试初始 7/7 失败；Back-Channel 跟进先新增 4 个失败断言。HTTP-01 跟进先新增真实失败契约（缺少独立 `listen 80` server）。组合式 BCL preflight 跟进先因缺少 site/snippet validator 失败，实现后 production contract 28/28 通过。canonical marker 跟进先复现标准 `sites-enabled` 无法通过及重复 canonical marker 假绿；all-internal topology 跟进再复现 Docker `ports` 与特殊 `host-gateway` 两个结构性失败。实现后 production contract 32/32 通过，并覆盖普通文件 canonical 激活、loopback Public/Admin bridge、固定 hook gateway、精确 UFW 与双私网探针。
- `npm run lint`：通过。
- `npm test -- --run`：45 files / 273 tests 通过。
- `npm run build`：通过。
- `npm run audit:deps`：Critical=0；前端 Moderate=2，后端 High=3/Moderate=1/Low=2 为既有依赖风险，未由本任务新增。
- `npm run db:verify`：SQLite integrity/foreign keys/身份 schema 通过，只读。
- 临时无真实用户 API：`SMOKE_BASE_URL=http://127.0.0.1:5180 npm run test:smoke` 通过，临时数据库未进入仓库或生产路径。
- 统一 `RELEASE_BASE_URL=http://127.0.0.1:5180 npm run test:release` 通过；本地健康接口 100 请求、并发 10，成功率 100%，p95 7ms，测试进程退出后 5180 无监听。
- `identity:hydra:protocol`：7/7 通过；授权码+PKCE、Refresh 重放、全局退出、Back-Channel、重启与 active signing kid 连续性均通过。
- `identity:production:verify-config`：production/staging Discovery、JWKS、S256、RS256 与 signing key 连续性通过。
- 本机无 Docker/Compose/Nginx，未把静态契约冒充现场链路成功；`identity:production:verify-backchannel` 必须在服务器以真实 Hydra network namespace、hook gateway:5175/443 和 Jieya TLS/BFF 执行，通过前保持身份关闭。
- 本机没有 Nginx 可执行文件，未把模板契约测试冒充 `nginx -t`；服务器安装前必须先用临时 challenge 与 `--resolve` 验证 HTTP-01，再执行配置测试，未经明确变更不得 reload。
- 结束时 `4444/4445/5174/4180/5180` 均无监听。

## 服务器剩余门禁

- 只读资源/网络盘点已通过，服务器 StarStack 曾 ff-only 到 `302227c69f12f6605abb17db36c4a48679c19335`；本分支合并后必须再次普通 ff-only，不能复制未审计工作树。
- 独立 staging env/TLS 已在仓库外准备并通过权限/证书检查，Secret 值未进入任务记录；`IDENTITY_PROXY_CIDR` 故意保持空值，必须等宿主 Nginx 经 hook gateway 访问 Hydra 后观测真实来源 `/32`，且只能等于 gateway `/32`，不能预填或放宽。
- 旧 Compose 可能已创建隐式 gateway/bridge 名的 `starstack-identity-hook-staging`。更新后必须先只读证明它无 attached container，随后在独立授权下只重建这个空 hook network；不得触碰健康的 `identity-database`、PostgreSQL 容器或 volume。
- auth/Jieya 预检变量必须填写 `sites-available` 中真实普通文件；active marker 可来自标准 `sites-enabled` 一跳 symlink，并以 canonical `realpath` 精确匹配证明实际加载。先安装 renderer 生成的 exact staging `/32` snippet 并以 `nginx -t/-T` 证明唯一 location 和真实 include，再运行静态 preflight。
- 宿主 Nginx loopback→Hydra 固定 hook IP:4444/4445、Hydra `/32`→hook gateway:5175/443、UFW exact INPUT、canonical TLS/SNI 及 Jieya BCL 精确 allow/deny 的现场证据。
- 三库备份/隔离恢复、备份目录保留与离机复制仍需在任何 staging migration/client 写入前完成。
- Cloudflare 源站 ACL、Nginx real_ip 可信 CIDR和身份请求的实测 `$remote_addr`。
