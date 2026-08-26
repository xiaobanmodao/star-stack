# StarStack 安全发布说明

## 评测沙箱

生产评测必须由专用的非 root 用户运行。`server/sandbox.sh` 会在 Linux 上使用 user/mount/PID namespace 和最小 chroot，仅把编译器运行时以只读方式暴露给用户代码，并把题目工作目录映射到 `/work`。沙箱探针失败时，生产环境拒绝执行代码。

沙箱不会把宿主机完整 `/etc` 暴露给用户代码，只提供运行时所需的动态链接器缓存和时区文件；编译器运行时目录使用只读 bind mount。生产模式也不会接受请求参数绕过沙箱，Node 服务默认只监听 `127.0.0.1:5174`，公网入口必须经过 Nginx。

发布前检查：

```bash
sudo -u starstack /bin/bash server/sandbox.sh /tmp 100 65536 - /bin/true
NODE_ENV=production node -e "import('./server/judge.js')"
```

如果服务器内核或容器策略不允许 user namespace、挂载或 chroot，应停止发布并调整主机权限，不得通过设置开发环境绕过沙箱。

## API、会话与实时连接

- Bearer Token 长度限制为 128 字节；账号 ID、昵称和密码均有长度上限，认证失败限流使用可信代理解析的客户端 IP。
- 评测 SSE、聊天 SSE 和未读消息 SSE 共享总连接数及单用户连接数上限；连接关闭后释放配额。聊天打字状态只允许合法频道或已加入房间的用户发送，并进行频率限制。
- 邀请链接只接受固定格式的随机 token；未知 API 返回 JSON 404，不泄露 Express 默认错误页。
- 前端错误上报限制请求体、字段长度、频率并做重复合并，服务端日志保留内部错误，响应不返回堆栈和系统路径。
- 推送订阅只允许受支持的 HTTPS 推送服务域名，限制设备数量和密钥格式，并过滤历史不可信 endpoint，避免服务端推送请求被利用为 SSRF。

## 内容、响应头与文件权限

讨论内容和公式链接使用白名单过滤，拒绝 `javascript:`、反斜杠混淆和协议相对地址；外链带有 `noopener noreferrer`。生产响应启用 CSP、HSTS、`nosniff`、同源 frame 限制和权限策略。

SQLite 数据目录权限应为 `0700`，数据库、WAL/SHM 文件和 VAPID 私钥应为 `0600`。发布时不要把 `.env.production`、SMTP 密码、Turnstile Secret、VAPID 私钥或数据库备份提交到 Git。

## 依赖审计风险记录

`npm run audit:deps` 当前没有 Critical，但可能报告以下上游链路风险：

- `react-router` / `react-router-dom`：当前 npm registry 中没有审计工具建议的修复版本，保持现有路由版本并在依赖发布修复版本后升级。
- `monaco-editor` / `dompurify`：Monaco 依赖链的审计项涉及上游版本兼容性，项目保留 `dompurify` override，并继续使用前端渲染白名单。
- `sqlite3` → `node-gyp` / `tar`：属于构建依赖链，当前没有可直接应用且不改变 SQLite 运行时的安全升级；发布记录必须保留该风险，并限制服务器权限、备份权限和网络暴露面。

每次发布都要重新执行依赖审计；出现 Critical 时禁止发布。

本次审计结果：没有 Critical；React Router 的高风险项和 `sqlite3` 构建链风险仍需等待上游兼容修复版本，当前不执行破坏性强制升级。`dompurify` 的安全 override 已保留并通过依赖审计脚本复核。
