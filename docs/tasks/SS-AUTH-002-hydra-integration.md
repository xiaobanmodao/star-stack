# SS-AUTH-002：Ory Hydra 身份运行时集成

状态：本地实现与真实 PostgreSQL 协议门禁已完成；默认关闭，未部署、未推送

基线与分支：

- 基线：`6e2b44418510afb12ce068133a7a441276c1cf6a`
- 分支：`codex/ss-auth-002-hydra-integration`
- 写入范围：仅 StarStack 仓库，未修改 Jieya 仓库。

事实源：

- Jieya commit `8b166d3e`
- `/Users/hht/Desktop/界芽计划/docs/decisions/ADR-0089-ory-hydra-identity-runtime.md`
- `/Users/hht/Desktop/界芽计划/docs/contracts/starstack-hydra-jieya-v2.md`
- [Ory Hydra v26.2.0 release](https://github.com/ory/hydra/releases/tag/v26.2.0)
- [Ory Hydra issue #4070](https://github.com/ory/hydra/issues/4070)

## 冻结版本与边界

- Hydra：`v26.2.0`，Apache-2.0。
- Hydra 镜像：`oryd/hydra:v26.2.0-distroless@sha256:ad53a123ddf869fc23ea74f3d76b47e2966dc52f559e93ab31f81440f4d60c5e`。
- PostgreSQL：`16.15`。
- PostgreSQL 镜像：`postgres:16.15-alpine3.24@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685`。
- StarStack 继续唯一保存账号、密码、不可变 `account_subject`、账号状态和账号中心会话。
- Hydra 独立保存 Client、Login/Consent Session、授权码、Token、JWT/JWKS 等协议对象；不共享 Cookie 或数据库。
- Jieya 只接收标准协议结果并创建自己的 `jieya_session`，其云存档仍属于 Jieya 数据域。
- `OIDC_ENABLED=false` 是默认值；本任务不改生产 Nginx/TLS/PM2/DNS，不部署、不推送。

## 已实现

### StarStack 身份与迁移

- `users.auth_generation` 为非负单调认证世代；旧 `users.id` 与所有 OJ 外键保持不变。
- 新增账号中心会话、Hydra 交互绑定、已知 Login `sid`、持久化 outbox、自定义 Logout Broker 事务表。
- 迁移使用 `BEGIN IMMEDIATE`，可重复执行；识别并补充已知的后续安全字段，但对未知/残缺表结构失败关闭。
- 封禁、解封、密码安全变更与删除统一进入账号生命周期服务；状态/世代、主站与账号中心会话撤销、outbox 在同一 SQLite 事务提交。
- 身份运行时按信任域拆分 SQLite 连接：公开账号页、UserInfo、私网 Token Hook/Logout Broker/outbox 分离；私网安全操作不再等待公开 Hydra 慢调用。每条串行操作队列都有硬上限并在满载时快速返回 `503`。
- 生命周期事件会先登记全部已知 `sid` 的 Login Session 撤销，再按每个已知 client 登记 Consent/Token 链撤销。

### Login、Consent 与协议边界

- Hydra Public/Admin origin 仅允许由 `node:net.isIP` 确认的 loopback/RFC1918 地址、`::1`、`localhost` 或显式单标签容器服务名；带点的公网 DNS 伪装（如 `10.attacker.example`）失败关闭。错误不记录响应正文、challenge、Token 或 Secret。
- 每次 Login/Consent（包括 Hydra `skip=true`）都重新验证账号中心会话、active 状态、subject 与世代。
- Hydra v26 challenge 最长按官方 2048 字符边界接受并只保存 SHA-256；Cookie/CSRF/退出令牌仍维持 512 字符边界。
- Login subject 只来自不可变 `account_subject`；Hydra remembered Login Session 固定 30 天，用于按 `sid` Headless Logout 与 Back-Channel Logout。StarStack 仍对每次 skip 重新鉴权。
- Consent 明确展示 scopes，`offline_access` 必须单独确认；用户可明确拒绝。ID Token 只加入昵称，Access Token 私有数据只加入 `auth_generation` 与 `grant_issued_at`。
- 受控代理只开放固定 Public 路径，不代理 Admin API；请求/响应头和大小均使用白名单/上限。浏览器请求只向 Hydra 转发按环境与固定 Client ID 算出的精确 Hydra Cookie，账号 Cookie 和未知 Cookie 被剥离；Hydra 响应只能写入相同精确白名单，并强制 `/oauth2`、`HttpOnly`、`SameSite=Lax`（生产 `Secure`）且移除 `Domain`。
- Login/Consent/Logout 身份页使用 `Referrer-Policy: same-origin`：同源表单保留 exact Referer，跨源导航不泄漏账号中心路径，与 Origin/Referer + session-bound CSRF 门禁一致。CSP `form-action` 只允许 `'self'` 与按部署模式冻结的 Jieya origin（本地 `http://jieya.localhost:4180`、生产 `https://jieya.xingzhan.cc`），不接受请求或环境变量注入的任意来源。
- Jieya 客户端精确限制 code + refresh、`client_secret_basic`、固定 callback、`openid profile offline_access`；StarStack Login policy 额外拒绝非 S256 PKCE。

### Token、UserInfo 与退出

- Token Hook 使用独立私网 API key；账号非 active、世代不匹配、客户端/Grant/scope 非法、授权族超过 30 天或 Hook 不可用时失败关闭；绝对期限到期同时登记幂等 Consent 清理 outbox。
- Hydra v26.2.0 在 authorization_code Hook 中暂未填充 `granted_scopes`，实现按官方 payload 使用同次请求的 `requested_scopes`，仍执行白名单、唯一性和 `openid` 校验；Refresh Hook 优先使用 `granted_scopes`。
- 自定义 UserInfo 先走私网 introspection，再校验 active、client、scope、access token 类型和世代，只返回 `sub/name/preferred_username/picture`。
- 自定义 Logout Broker 使用一次性 5 分钟事务、BFF 私网凭据、subject+sid+client+state 绑定、账号会话、精确 Origin/Referer 和 session-bound CSRF；私网头固定为 `X-StarStack-Logout-Broker`，HTTP 201 响应仅包含 `{url, expires_at}`。
- POST 确认在 SQLite 原子推进世代、撤销 StarStack 会话、登记全部已知 `sid` 和 outbox；同世代 `revoke_session` 全部完成前，`revoke_consent` 不可领取，确保 Back-Channel Logout 不被提前删除 Consent 破坏。
- 当前账号/世代的撤销会在浏览器回跳前同步尝试；物理失败保持持久化重试。即使 Hydra 尚未物理清理，Token Hook、UserInfo 与 Login/Consent 已按新世代失败关闭。
- Hydra Refresh rotation 明确配置 0 秒 grace 与 0 次复用，不依赖隐含默认值。

### DoS 与容量闭环

- 公开账号 `GET` 固定为每源 60 次/分钟、进程总量 300 次/分钟；UserInfo 固定为每源 300 次/分钟、总量 600 次/分钟，并额外限制 16 个并发 introspection。无凭据的私网请求在解析 JSON 和进入关键队列前即被拒绝。
- 密码登录和退出重认证共享固定的 10 分钟密码尝试预算：单账号 20 次、进程总量 200 次。账号键与权威查询语义一致，仅执行 `trim` 和相同长度校验，保留大小写及 Unicode 码点，再使用进程内随机密钥做域分离 HMAC；因此可共存的 `alice`、`Alice` 与兼容字符账号拥有独立预算。内存最多保存 512 个摘要且不保存明文账号；所有有效表单的成功/失败尝试均计数，达到上限后在 bcrypt 前返回 `429`。预算只在 challenge、session-bound CSRF 与 exact Origin/Referer 全部通过后消费，无效表单无法耗尽密码预算。
- 账号中心会话在 Login 接受后先以 provisional 状态保存，只有 Consent 成功后才转为 established；Hydra 接受失败、拒绝授权、Consent 失败或 Login `sid` 达到上限时，会删除本次 provisional 会话。迁移前已存在的会话会一次性回填为 established，重复迁移不改动新 provisional 会话。
- 登录、Consent 和退出重认证的失败/拒绝/过期响应只撤销其服务端 provisional 会话，不发送同名 Cookie 删除；这样旧标签页的迟到响应不能删除另一标签页刚建立的账号 Cookie。仅用户明确确认且成功完成全局退出时发送账号 Cookie 删除。
- `account_center_sessions` 每个 `account_subject` 最多 16 条、全局最多 4,096 条。每次创建在同一个 `BEGIN IMMEDIATE` 事务中清理过期行、为账号和全局各预留一个插入槽并按最旧访问时间淘汰，然后插入新会话；SQLite 跨连接并发仍只会有一个写事务越过容量边界。
- 公开身份操作队列最多容纳 32 个正在执行或等待的请求，私网关键队列最多 64 个；断开的公开请求获得锁后立即释放，不会形成永久队首阻塞。
- `oidc_interactions` 在同一个 `BEGIN IMMEDIATE` 临界区清理过期记录、执行原子 count/insert，并硬限制为 512 条；双连接边界竞争最多一个成功。
- 每个 `(account_subject, client_id)` 最多保留 16 个未撤销 Login `sid`。超限 Consent 不签发 Grant，先撤销新 Hydra Login Session，再以标准错误拒绝 Consent；并发边界同样通过 SQLite 写锁原子裁决。
- Login `sid` 显式保存 30 天 `expires_at`；过期 active、超过 15 分钟的 `authorization_pending` 和超过 30 天的 revoked 行会清理，`revocation_pending` 永远保留到 outbox 成功，避免静默丢失撤销任务。
- `identity_outbox` 设 10,000 行绝对上限、1,024 条未解决事件上限和单账号世代 64 条上限；历史异常 SID 枚举使用 `LIMIT 65` 预检并失败关闭。浏览器退出请求最多同步处理 8 条，后台每轮最多 25 条，其余持久化有界重试。
- 本地 Hydra 工具只接受精确 DSN `postgres://hydra_test@127.0.0.1:55432/hydra_test?sslmode=disable`。`run-local-runtime` 与完整协议脚本都会在任何文件写入、Hydra spawn、migration 或 Client 注册之前拒绝其他 DSN；坏 DSN 零副作用测试覆盖两侧入口。
- 身份功能启用时 issuer 按环境失败关闭：开发只能是精确的 `http://auth.localhost:5174`，生产只能是精确的 `https://auth.xingzhan.cc`；尾斜杠、其他 host、HTTP 生产地址以及包含 path/query/fragment/credentials 的值均被拒绝。

## 真实运行时发现并闭环的兼容点

1. Hydra v26 对不存在 Client 的 PUT 返回 404：注册改为 GET 后按存在性选择 POST/PUT。
2. Hydra challenge 可超过 512 字符：仅 Hydra challenge 哈希边界提高到 2048，避免空主键静默写入。
3. `identity_provider_session_id` 的 PostgreSQL 字段为 `varchar(40)`：使用账号会话哈希派生的 160-bit/40 字符非敏感 ID。
4. authorization_code Token Hook 的 `granted_scopes` 为空：按 v26.2.0 官方源码以 `requested_scopes` 作为该阶段的有效 scope，Refresh 仍使用 `granted_scopes`。
5. Hydra 按 `sid` Headless Logout 只处理 remembered Login Session：Login 固定 remember 30 天，同时 StarStack 对 skip 继续强校验。
6. Back-Channel Logout 必须先撤销全部 Login Session，再撤销 Consent；outbox 已加入同世代依赖约束。
7. Hydra v26.2.0 Client 模型不支持 `id_token_signed_response_alg`，会静默忽略该字段；Provider Discovery 只公布 RS256，真实 ID Token 已验证 `alg=RS256` 与非空 `kid`。注册脚本不再发送伪配置字段。
8. Hydra `--dev` 会给配置的 Cookie 基础名追加 `_dev`；Login/Consent CSRF 还会追加固定 Client ID 的 Murmur3 后缀，Device CSRF 不追加 Client 后缀。代理按 `jieya-server-local`/`jieya-server` 的已核对确定值生成精确白名单，不使用可扩张的前缀匹配。
9. `Referrer-Policy: no-referrer` 会让真实同源表单缺失强制 Referer 并被 403；身份页已改为 `same-origin`，等价浏览器策略测试与真实协议表单链路均覆盖。
10. CSP `form-action 'self'` 会让 Chromium 阻断 Consent/Logout POST 后经过 Hydra 303 到 Jieya 的跨源回调；已仅加入冻结的 Jieya origin，并以 local/prod 精确策略测试拒绝通配、攻击者 origin 和任意环境覆盖。

第 7 点是 Jieya v2 契约第 2 节的非阻塞文字偏差：安全结果满足 RS256，但后续文档应把“客户端字段”改为“Provider 仅公布 RS256，BFF 固定验证 RS256”。

## 真实协议证据

2026-08-30 使用双方共享的隔离运行时：

- Hydra 二进制：`v26.2.0`
- PostgreSQL：`16.15`，loopback `127.0.0.1:55432`
- 仅使用生成的本地 fixture 账号与被 Git 忽略的随机 Secret。

`npm run identity:hydra:protocol` 已证明：

- Discovery、JWKS、RS256/kid；
- issuer 无尾斜杠、五个关键 Discovery endpoint、`jieya-server-local` 与 callback 均为精确值；
- Authorization Code + confidential client + PKCE S256；
- Login/Consent、明确 offline consent、最小 ID Token/UserInfo；
- authorization code 最多消费一次；
- Refresh Token 0 秒宽限轮换与重放拒绝；
- Token Hook active/世代/30 天绝对授权族门禁；
- 自定义全局退出推进世代，旧 code/access/refresh 全部失败；
- 4 个并发无密码授权请求覆盖 #4070 物理撤销窗口，均不能在退出提交后换得 Token；
- 按 `sid` Back-Channel Logout 实际送达；
- Back-Channel Logout protected `typ=JWT`，Logout Broker 请求头及 `{url, expires_at}` 响应结构精确匹配；
- 真实 Hydra `_dev`/Client 后缀 Cookie 可完成授权链路，账号 Cookie 未进入 Hydra 且不能被 Hydra `Set-Cookie` 覆盖；
- 身份页面 `same-origin` Referrer Policy 可生成通过 exact Origin/Referer 门禁的同源 POST；
- 身份页 CSP 只允许 `'self'` 与冻结的 Jieya origin，完整协议门禁会对实际响应头做精确指令断言；
- Hydra 进程重启后已消费 code/refresh 仍失败，SQLite 世代/outbox 状态仍存在。
- 公开账号页/UserInfo 每源与全局限流、慢 introspection/slow login 与私网 Token Hook 隔离、队列快速 `503`、512 interaction 上限、16 SID 上限、outbox 三层容量及迁移/Retention 竞争均由自动化测试覆盖。

另以真实 Chromium DOM 流程完成 Login → Consent → Jieya 授权回调，以及 Logout Broker → 确认退出 → Jieya 退出回调；两条跨源导航均到达固定 `jieya.localhost:4180`，退出 `state` 精确匹配且控制台无 CSP 错误。

最终本地门禁：

- `npm run lint`：通过；
- `npm test -- --run`：43 个文件、216 项通过；
- `npm run build`：通过；
- `npm run test:smoke`：隔离数据库通过；
- `node server/migrate.js` 重复迁移与 `npm run db:verify`：50 张表、0 个外键问题；
- SQLite 一致性备份恢复：50 张表可恢复；
- 依赖审计：`react-router-dom` 已精确锁定为 `7.18.2`，其传递依赖 `react-router` 同步精确锁定为 `7.18.2`，已消除 GHSA-qwww-vcr4-c8h2；根项目生产依赖为 0 Critical / 0 High。
- 根项目仍有 Monaco `0.55.1` → DOMPurify `3.4.12` 链路的 2 个 Moderate；npm 当前只提供把 Monaco 倒退到 `0.53.0` 的破坏性修复建议，因此作为非身份、既有风险保留，后续等待 Monaco/DOMPurify 的前向兼容修复，不以编辑器能力回退换取审计清零。
- 后端 sqlite3/node-gyp/tar 的既有上游 High 项继续保留在发布风险记录；本任务没有为身份运行时新增 npm 协议或密码学依赖。
- 已按本地生成值和常见私钥/Token 模式扫描 332 个纳入版本控制或待提交的文件，未发现 Secret 泄漏。

## 备份与回滚

- 生产迁移前必须停止写入并创建 SQLite 一致性备份，运行 `npm run db:verify-backup`；Hydra PostgreSQL 另做逻辑/物理备份和恢复演练。
- StarStack 迁移只新增兼容字段/表。若尚未对外签发身份，可关闭 `OIDC_ENABLED`、停止服务并恢复迁移前 SQLite 备份；不得删除/重建 `account_subject`。
- 一旦对外签发 `(issuer, sub)`，不可通过重新生成 subject 回滚。Provider 故障时关闭新授权、保留数据与 outbox，修复后继续重试。
- Hydra PostgreSQL 回滚必须恢复与 StarStack SQLite 同一备份点，并重新验证已消费 code/refresh 不可重放。

## 仍未授权/未完成

- 未接入 Jieya BFF 的真实代码；本地 callback 仅由协议 fixture 模拟。
- 未配置 `auth.xingzhan.cc`、生产 TLS/Nginx/PM2、生产 Secret 管理、PostgreSQL TLS/备份/监控。
- 未部署、未推送、未使用真实账号或生产数据。
- Ory issue #4070 仍未上游修复；生产必须继续保留自定义 Logout Broker 与认证世代门禁，不得切回 Hydra RP-Initiated Logout。
