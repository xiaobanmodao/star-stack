# SS-AUTH-004：界芽计划产品发布纵向

## 基线与目标

- 基线：`origin/main@d2cc28698bf662e2e16fde6a06d638a29475287f`，对应 main CI `33321115579` 绿色。
- 目标：在 StarStack 产品大厅正式发布界芽计划入口，并在现有资料设置中展示、撤销 Jieya OIDC 连接。
- Jieya 唯一正式入口：`https://jieya.xingzhan.cc`。
- Jieya 登录由其 BFF 的 `/auth/login` 发起；浏览器只持有 `jieya_session`，StarStack 不向 Jieya 共享主站 Token。

## 已确认事实

- StarStack 已固定生产 client `jieya-server`，本地 client `jieya-server-local`，授权码 + PKCE、Hydra、最小 Claims 与持久化撤销 outbox 已实现。
- `oidc_login_sessions` 足以派生当前 Jieya 连接状态；本阶段不需要新增数据库表或修改历史用户/OJ 外键。
- StarStack 管理员标记不属于 OIDC Claims，Jieya 也不继承 StarStack 权限。
- 旧 `/api/sso/session`、`src/utils/sso.ts` 与 `public/sso.html` 仍实现共享 Token；仓内没有调用方，必须在正式发布前失败关闭。
- 仓库全文检索未发现仍调用旧 SSO 的受支持客户端；本阶段按停止线未连接生产服务器，因此生产访问日志中是否仍有历史第三方调用必须在部署前只读确认，发现活跃客户端时暂停上线并通知迁移。

## 实施范围

1. 将项目大厅的 Jieya 卡片切换到正式域名，明确“进入游戏”“可选使用星栈账号”和“游客模式保留”。
2. 在资料编辑页增加已连接应用区：显示固定应用元数据、连接/撤销中/未连接状态和授权时间。
3. 增加认证后的连接查询与撤销接口。撤销必须：
   - 在一个 SQLite 写事务中推进认证世代、撤销账号中心会话、标记已知 Jieya sid，并写入有界 outbox；
   - 立即使旧 OIDC Token 在 Token Hook/UserInfo 边界失败关闭；
   - 不删除当前 StarStack 主站会话，不改变 `is_admin`，不触碰 Jieya 数据。
4. 旧 SSO API 固定返回 `410 Gone` 且永不回传 Token；生产 Nginx exact location 同样返回 410 并关闭 access log；桥接页成为无脚本停用页；删除未使用工具并更新迁移文档。
5. 补充产品入口、连接状态/撤销、回滚、旧 SSO 失败关闭、最小 Claims 和无管理员传播测试。

## 停止线

- 不修改 Jieya 仓库，不连接生产服务器，不部署，不切换 `OIDC_ENABLED`。
- 不恢复 iframe、`postMessage`、URL Token、共享 Cookie 或共享数据库 SSO。
- 不构造浏览器侧 OAuth 请求；星栈只链接 Jieya 根入口，由 Jieya BFF 发起协议流程。
- 若发现仍有受支持客户端调用旧 SSO，或无法在不影响主站会话的前提下失败关闭撤销，停止发布并报告。
- 未通过完整门禁、PR CI 和 main CI，不作为部署基线。

## 验收门禁

- 失败测试先行：产品入口、连接状态、幂等撤销、事务回滚、旧 SSO 退役。
- `npm run lint`
- `npm test -- --run`
- `npm run build`
- `npm run test:smoke`
- `npm run db:verify`
- `npm audit --omit=dev`
- `git diff --check` 与秘密扫描

## 本地收口证据

- `npm run lint`：通过。
- `npm test -- --run`：53 个测试文件、305 项测试全部通过。
- `npm run build`：通过。
- 隔离 SQLite + 隔离 API 的 `npm run test:smoke`：通过，包含已认证连接应用响应与旧 SSO GET/POST 410。
- `npm run db:verify`：50 张表、外键问题 0、账号身份与 OIDC 底座完整。
- 一致性备份、解压恢复和 `PRAGMA integrity_check`：通过。
- 真实浏览器 1440px/375px 回归：项目大厅与资料编辑页无横向溢出，Jieya 固定入口、连接状态和权限边界文案可见。
- `npm run audit:deps`：门禁通过；无 Critical。`npm audit --omit=dev` 仍报告现有 Monaco → DOMPurify 2 个 Moderate，修复建议会破坏性降级 Monaco；后端审计仍报告 sqlite3/node-gyp/tar 构建链 3 个 High、1 个 Moderate、2 个 Low，当前发布的 `tar@7.5.20` 与 `undici@6.27.0` 尚无满足现有依赖范围的更高修复版本。本任务未用强制降级或 override 制造假绿。
- 本机没有 Nginx CLI，无法执行 `nginx -t`；exact 410、`access_log off` 和 `Cache-Control: no-store` 由仓库契约测试冻结，实际生产语法检查仍属于部署门禁。

本轮浏览器、API 与备份数据均使用临时目录，结束后已删除；5173、5174、5180 均已释放。没有连接生产服务器、修改 Jieya 仓库或启用 OIDC。
