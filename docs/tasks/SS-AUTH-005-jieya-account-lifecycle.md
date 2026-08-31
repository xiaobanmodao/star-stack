# SS-AUTH-005：界芽账号生命周期投递

## 基线与目标

- 分支：`codex/ss-auth-005-jieya-lifecycle`
- 基线：`origin/main@33eab92aa2b540d3fc370d87024b3c87c93cc808`
- 目标：复用现有事务化账号状态与认证世代 outbox，向同机 Jieya BFF 的私网端点可靠投递账号生命周期事件。
- 本任务不修改 Jieya 仓库，不部署、不推送、不启用生产 OIDC/生命周期投递，也不写入真实用户或真实 Secret。

## 冻结契约

- 唯一回调：`POST http://127.0.0.1:4180/internal/starstack/account-lifecycle`。
- 请求 `Host` 固定为 `jieya.xingzhan.cc`；不得从环境或用户输入改写。
- 唯一认证头：`X-StarStack-Account-Lifecycle`；使用独立 systemd credential，不得复用 Token Hook 或 Logout Broker Secret。
- JSON wire version 固定为 `1`，字段固定为：
  - `version`
  - `eventId`
  - `issuer`
  - `sub`
  - `status`
  - `authGeneration`
  - `occurredAt`
- `eventId` 与 `sub` 均为 canonical lowercase UUIDv4；`issuer` 固定
  `https://auth.xingzhan.cc`；仅投递 `active`、`suspended`、`deleted`，世代是非负
  safe integer，时间必须是带 `.sssZ` 的 canonical `toISOString()`。
- 只有 Jieya 返回精确 HTTP `200` 且 JSON 仅含
  `{ "status": "applied|duplicate|stale|terminal" }` 才完成 outbox；其他 `2xx` 或
  畸形 `200` 继续重试。超时、网络失败与 `5xx` 持久重试，`503 Retry-After: 60`
  至少等待 60 秒；`409` 与其他 `4xx` 不重试并立即进入 dead + 告警。可重试故障
  最多尝试 20 次，耗尽后保留 dead 事件并产生不含 Secret/subject 的告警。
- 同一 subject 按 `authGeneration` 严格有序投递；`deleted` 是终态。Jieya 应按 `eventId` 幂等、拒绝同世代冲突、忽略旧世代，并把 deleted 作为不可逆状态。

## 产品语义

- `suspended`：撤销 Jieya 会话、拒绝云能力，但保留云存档。
- `active`：仅用于恢复 suspended 账号；旧会话不复活，用户必须重新登录。
- `deleted`：撤销会话并触发 Jieya 持久化删除任务；在线云档 payload 应在 24 小时内删除，删除 tombstone 至少保留 31 天，备份 payload 最长 30 天。
- 登出、断开应用、换绑邮箱和修改密码都不删除 Jieya 云存档，也不投递生命周期状态事件。
- 用户注销前必须明确提示先导出 Jieya 云档；当前仓库没有用户自助注销入口，管理员删除确认必须展示同等警告，后端仍统一走 `transitionAccountStatus(..., deleted)`。

## 实施边界

1. 失败测试先行，覆盖精确 wire、精确 200 回执、持久重试、重启恢复、有序投递、终态与非生命周期事件隔离。
2. 新增独立、默认关闭的生命周期配置和 HTTP client；生产回调不可配置为任意 URL。
   传输使用 `node:http.request`，因为 Node `fetch` 会覆盖自定义 Host；响应体限制为
   4 KiB，不跟随重定向，并以真实 loopback 探针验证线路上的 Host。
3. systemd launcher 读取独立 credential，并验证它与现有两个身份 Secret 三者互不相同；值不进入环境示例、日志、Git 或命令输出。
4. 生产环境示例与 PM2 继续保持功能关闭。未启用时生命周期事件保持 pending、
   attempts=0，绝不伪装成已送达；Hydra 会话/Consent 撤销和其他 outbox 仍可处理。
5. 管理员删除 UI 明示导出/云档删除语义；管理员删除必须继续经过事务化生命周期服务。

## 停止线

- 生命周期开关与独立 Secret 未同时安全配置时失败关闭。
- 无法保证同 subject 世代顺序、只有有效 200 回执完成、失败持久化或 Secret 隔离时不得启用。
- Jieya 写云档功能不得先于本契约部署和验证启用。
- 不把 loopback 回调暴露到公网 Nginx，不新增公网 `/internal/` 路由。

## 验收门禁

- 定向 lifecycle/config/outbox/systemd/UI 契约测试。
- `npm run lint`
- `npm test -- --run`
- `npm run build`
- `npm run test:smoke`
- `npm run db:verify`
- `npm run audit:deps`
- `git diff --check` 与秘密扫描。

## 本地完成证据

- 失败测试先行：初始定向门禁缺少 client/config/systemd/UI，且 lifecycle outbox 会
  无有效回执直接完成；同世代 Hydra 撤销失败时也会错误越过。真实 loopback 探针
  随后复现 Node `fetch` 覆盖 Host 并收到 400，改用 `node:http.request` 后接收端实际
  观测 `Host: jieya.xingzhan.cc`。最终 8 个定向文件、128 项测试通过。
- `npm run lint`：通过。
- `npm test -- --run`：56 个测试文件、353 项测试全部通过。
- `npm run build`：通过；没有新增前端运行依赖，管理员永久注销提示已进入构建产物。
- 隔离 SQLite + `OIDC_ENABLED=false` +
  `JIEYA_ACCOUNT_LIFECYCLE_ENABLED=false` 的 API smoke：通过；未创建真实账号或连接
  生产服务。
- `npm run db:verify`：50 张表、外键问题 0；17 个现有账号全部 active，本任务没有
  数据库结构或历史数据写入。
- 固定 Hydra v26.2.0 + PostgreSQL 16.15 的真实 `identity:hydra:protocol` 7/7：
  Discovery/JWKS、授权码+PKCE、Refresh 重放、全局退出、Back-Channel Logout、重启
  重放拒绝与 signing kid 连续性全部通过。
- `npm run audit:deps`：无 Critical；前端现有 2 个 Moderate，后端现有 3 个 High、
  1 个 Moderate、2 个 Low，均未因本任务增加依赖或扩大风险。
- `git diff --check` 与 25 个变更/新增文件的值安全秘密扫描通过；没有真实 Secret、
  Token、私钥、带密码 DSN 或真实用户 fixture。
- 4180/4444/4445/5174/5180 最终均无监听残留。
- 生产和云写开关保持关闭；只读核对了 Jieya 已实现的 receiver、幂等/世代状态机
  与删除队列，未修改 Jieya 仓库，未连接服务器、部署或推送。双方安装同一独立
  systemd credential、生产备份和隔离联调仍是启用前硬门禁。
