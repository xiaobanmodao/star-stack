# 星栈 SSO 共享登录接入指南

星栈主站与子项目（界芽计划、未来项目等）共享登录态。

## 方案选择

| 场景 | 方案 | 说明 |
|------|------|------|
| 同域名**子路径**部署（推荐） | localStorage 共享 | `/` 与 `/jieya/` 同源，`localStorage` 天然互通 |
| 同域名**子域名** | iframe + postMessage | 主站提供 `/sso.html` 桥接页 |
| 站间跳转 | URL 带参 + 会话校验 | 跳转时携带 `?token=`，目标站调用 `/api/sso/session` 校验 |

## 一、同域名子路径（最简单）

`https://你的域名/` 与 `https://你的域名/jieya/` 共享同一个 `localStorage`。

子项目内：

```js
// 读取星栈登录令牌
const token = localStorage.getItem('starstack_token')

// 调用星栈 API 时携带
fetch('https://你的域名/api/sso/session?token=' + encodeURIComponent(token))
  .then((res) => res.json())
  .then((data) => {
    if (data.user) {
      // 已登录：data.user = { id, name, avatar, isAdmin, isBanned }
    } else {
      // 未登录，跳回主站登录后返回
      window.location.href = `https://你的域名/auth?redirect=${encodeURIComponent(window.location.href)}`
    }
  })
```

## 二、iframe 嵌入（跨子域名）

主站提供静态页 `https://你的域名/sso.html`：读取本地令牌后
`postMessage({ type: 'STARSTACK_SSO', token })` 发给父窗口。

父窗口（子项目）：

```js
const iframe = document.createElement('iframe')
iframe.src = 'https://你的域名/sso.html'
iframe.style.display = 'none'
document.body.appendChild(iframe)

window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'STARSTACK_SSO') {
    const token = event.data.token
    if (token) {
      // 用 token 调 /api/sso/session 换取用户信息
    }
  }
})
```

## 三、会话校验接口

```
GET /api/sso/session
Header: Authorization: Bearer <token>     （或 ?token=<token>）
→ { user: { id, name, avatar, isAdmin, isBanned } | null, token }
```

## 前端工具

星栈仓库内置 `src/utils/sso.ts`：
- `getSharedToken()` — 读取共享令牌
- `fetchSsoTokenViaIframe(url)` — iframe 方式取令牌（Promise，带超时）
- `fetchSsoSession(token)` — 令牌换会话

## 注意

- 令牌存放在 localStorage，仅适用于同源可信环境；生产环境务必开启 HTTPS
- 令牌长期有效（无过期机制），子项目接入时应只在启动时校验一次并缓存会话
- 如后续需要跨域名正式 SSO（OAuth2/OpenID），可在 `/api/sso/session` 基础上扩展授权码流程
