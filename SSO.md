# 星栈跨应用登录迁移说明

## 当前唯一支持方案

StarStack 与界芽计划之间只使用 Hydra 提供的 OAuth 2.0 / OpenID Connect 授权码流程：

1. 用户从 `https://jieya.xingzhan.cc` 进入界芽，可继续使用游客模式；
2. 用户主动选择“使用星栈账号”时，由 Jieya BFF 的 `/auth/login` 发起 Authorization Code + PKCE S256；
3. 密码只提交到 `https://auth.xingzhan.cc` 的 StarStack 账号中心；
4. Jieya 服务端兑换并验证协议 Token，然后创建自己的 HttpOnly `jieya_session`；
5. 浏览器不持有 StarStack Access Token 或 ID Token，Jieya 云存档与权限仍属于 Jieya 数据域。

固定生产边界、客户端注册、退出和撤销语义见：

- [`infra/identity/PRODUCTION.md`](./infra/identity/PRODUCTION.md)
- [`docs/tasks/SS-AUTH-002-hydra-integration.md`](./docs/tasks/SS-AUTH-002-hydra-integration.md)
- [`docs/tasks/SS-AUTH-004-jieya-product-release.md`](./docs/tasks/SS-AUTH-004-jieya-product-release.md)

## 已退役方案

以下方式已经停止支持，不得在新客户端中使用：

- 读取或共享 StarStack 的浏览器存储凭据；
- iframe + 跨窗口消息桥接；
- 在 URL、请求体或跨应用接口中传递主站会话凭据；
- 共享 Cookie、共享数据库或继承 StarStack 管理员权限。

兼容停止行为：

- `GET/POST /api/sso/session` 固定返回 `410 Gone` 与 `legacy_sso_retired`，不读取、校验或回显来访凭据；
- `/sso.html` 仅保留无脚本停用说明，不读取浏览器存储、不发送跨窗口消息；
- 生产 Nginx 对两个旧路径使用 exact `410` 且关闭 access log，避免历史客户端放在查询参数中的凭据进入日志；
- 原 `src/utils/sso.ts` 已删除。

旧客户端若收到 `410`，应删除本地共享登录实现，引导用户返回应用自己的 OIDC 登录入口；不得降级为 URL Token 或 iframe 桥接。
