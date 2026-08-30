# SS-AUTH-001 Phase 1A：身份数据底座

状态：已完成（仅身份数据底座；Provider 继续阻塞）

事实源：

- Jieya commit `8b166d3e`
- `docs/decisions/ADR-0088-starstack-identity-and-optional-cloud-boundary.md`
- `docs/contracts/starstack-oidc-jieya-v1.md`

## 本阶段边界

本阶段只实现 StarStack 现有账号的不可变身份键和账号生命周期数据语义：

- 为每个用户生成 UUID `account_subject`，保持 `users.id` 和全部历史外键不变。
- 增加 `account_status`（`active | suspended | deleted`）和 `account_tombstoned_at`。
- 封禁、解封和管理员删除统一走事务化生命周期服务；删除改为保留历史关联的 tombstone，不再物理删除用户行。
- 账号状态变化与现有 `sessions` 撤销在同一 SQLite 事务中完成。

明确不在本阶段完成：

- 不安装或集成 `oidc-provider`。
- 不创建 OIDC Adapter、Grant、Token、outbox 或全局 OIDC 撤销能力。
- 不开放 Discovery/JWKS/authorize/token/userinfo/logout 端点。
- 不接 Jieya BFF，不迁移主站登录，不改生产 Nginx、TLS、PM2 或 DNS。

## Provider registry 阻塞

2026-08-30 复核 npm 官方 registry：

- `oidc-provider@9.8.0` 至 `9.12.0` 均依赖尚未发布的 `koa@^3.2.1`。
- `oidc-provider@9.11.4` 起另依赖尚未发布的 `jose@^6.2.10`。
- `9.7.1` 虽可安装，但缺少 `9.8.2` / `9.8.5` 的交互输出转义修复，不接受降级。
- 禁止使用 npm override、Git tarball 或放宽版本范围绕过上游依赖声明。

Provider 与 Adapter 集成保持关闭，直到可复现安装的受支持版本完成重新审计。

## 迁移与回滚

- 迁移必须在 `BEGIN IMMEDIATE` 事务内完成，生成、校验、唯一索引和保护触发器任一步失败都整体回滚。
- 首次迁移只为缺少 `account_subject` 字段的旧表生成 UUID；若数据库已经存在该字段但出现空值、非法值或重复值，视为不可信的部分迁移并停止，不静默补值。
- 重复迁移只验证现有值，不重新生成或改写 subject。
- `account_subject` 创建后不可更新，用户行禁止物理删除，deleted 状态不可恢复，subject 永不复用。
- 生产迁移前必须生成并验证 SQLite 一致性备份。若迁移尚未对外签发身份，可停止服务并恢复该备份；不得通过删除字段或重新生成 subject 回滚。

## 验收记录

2026-08-30 本地验收：

- 失败测试先行：实现前两个新测试套件因目标模块不存在而失败；实现后全部通过。
- `npm test -- --run`：26 个测试文件、89 个测试通过。
- `npm run lint`、`npm run build`、`npm run test:smoke`、`npm run audit:deps`、`npm run db:verify` 全部通过。
- 临时旧库夹具覆盖首次迁移、重复迁移、进程重启、生成冲突、非法/重复/空 subject 和事务回滚。
- 当前本地数据库先生成一致性备份并通过恢复验证，再执行两次迁移；17 个旧用户 ID、7 条提交关联保持不变，重复迁移 subject 集合哈希不变，外键错误为 0。
- 临时 API 数据库覆盖 Bearer/Cookie 登录、OJ 读取、管理员建号、封禁、解封、删除、session 撤销和公开响应不暴露 subject。
- 健康接口 100 请求、并发 10：100% 成功，p95 8ms。
- 依赖审计无 Critical；未增加任何依赖，`oidc-provider`、Koa 和 JOSE 均未进入 package/lockfile。

本阶段提交 SHA 在提交完成后记录于 Git 历史。仍关闭的契约项包括全部 OIDC 端点、SQLite OIDC Adapter、RS256/JWKS、PKCE、Refresh Token、Grant、Back-Channel Logout、outbox 和账号级 OIDC 全局撤销。
