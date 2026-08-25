# StarStack 安全发布说明

## 评测沙箱

生产评测必须由专用的非 root 用户运行。`server/sandbox.sh` 会在 Linux 上使用 user/mount/PID namespace 和最小 chroot，仅把编译器运行时以只读方式暴露给用户代码，并把题目工作目录映射到 `/work`。沙箱探针失败时，生产环境拒绝执行代码。

发布前检查：

```bash
sudo -u starstack /bin/bash server/sandbox.sh /tmp 100 65536 - /bin/true
NODE_ENV=production node -e "import('./server/judge.js')"
```

如果服务器内核或容器策略不允许 user namespace、挂载或 chroot，应停止发布并调整主机权限，不得通过设置开发环境绕过沙箱。

## 依赖审计风险记录

`npm run audit:deps` 当前没有 Critical，但可能报告以下上游链路风险：

- `react-router` / `react-router-dom`：当前 npm registry 中没有审计工具建议的修复版本，保持现有路由版本并在依赖发布修复版本后升级。
- `monaco-editor` / `dompurify`：Monaco 依赖链的审计项涉及上游版本兼容性，项目保留 `dompurify` override，并继续使用前端渲染白名单。
- `sqlite3` → `node-gyp` / `tar`：属于构建依赖链，当前没有可直接应用且不改变 SQLite 运行时的安全升级；发布记录必须保留该风险，并限制服务器权限、备份权限和网络暴露面。

每次发布都要重新执行依赖审计；出现 Critical 时禁止发布。
