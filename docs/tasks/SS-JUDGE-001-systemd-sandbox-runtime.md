# SS-JUDGE-001：systemd 下评测沙箱兼容性

## 生产阻断

- 生产 `/api/oj/run-custom` 返回 HTTP 200，但结果为 `Judge Error / 评测沙箱不可用`。
- 同一 `starstack` 用户在普通 `runuser` shell 中直接执行 `server/sandbox.sh` 成功。
- `starstack-api.service` 启动探针失败；生产绝不能回退到无沙箱执行。

## 定位结论

- exact full transient unit 失败于 `unshare: mount /proc failed: Operation not permitted`。
- minimal、`NoNewPrivileges`、PrivateDevices、PrivateTmp、文件系统保护组、Restrict 组分别通过。
- `ProtectKernelTunables=true`、`ProtectKernelLogs=true` 分别锁死内层 `/proc` 挂载；`ProtectKernelModules=true` 锁死内层 `/usr` bind mount。
- `ProtectControlGroups=true` 与沙箱兼容，继续保留。
- 最小修复只在 API unit 对上述三项显式设为 `false`，同时清空 host capability、用 `SystemCallFilter=~@module syslog` 拒绝宿主模块和内核日志 syscall，并要求 `kernel.dmesg_restrict=1`；备份 unit 不变。

## 本阶段范围

1. 在一次性 Ubuntu VM 中用 `systemd-run` 建立 transient unit：先证明普通非 root 用户能运行用户/网络/挂载/PID namespace + chroot 沙箱，再应用生产 unit 的完整硬化属性。
2. 失败时逐项剔除硬化属性，只输出属性名与脱敏 stderr，定位最小冲突面。
3. 修改最少的 systemd unit/template，并保留等价或更强的设备、文件系统、权限和资源边界。
4. 增加静态契约与真实 transient-unit 回归，执行完整仓库门禁后走 PR/main。

## 停止线

- 不连接、修改或重启生产服务器；不修改 Jieya 仓库。
- 不删除 namespace/mount/chroot 沙箱，不允许 `NODE_ENV=production` 无沙箱运行。
- 不使用 `--privileged` 容器、`network_mode=host`、root 判题或真实账号/Secret。
- transient-unit 测试只允许在 GitHub Actions 的临时 VM 中显式启用，不允许对已有 `/opt/star-stack` 做覆盖或清理。
- GitHub Ubuntu 若用全局 AppArmor sysctl 禁止普通 user namespace，测试只在一次性 VM 内临时对齐生产已证明可用的 userns 基线，并在 trap 中恢复原值；期间只运行 `/bin/true`。
- 生产只允许在明确确认变量下运行无用户代码的 installed-unit probe；它不能重启服务或写数据库。

## 验收

- 普通非 root 基线与完整硬化 transient unit 均执行 `/bin/true` 成功。
- 生产 unit 保留 `NoNewPrivileges`、只读项目目录、内核/cgroup 防护、实时/SUID/Personality 限制、内存和任务上限。
- 沙箱不可用时 API 仍失败关闭为 `Judge Error`。
- `lint`、全量测试、构建、API smoke、数据库验证、依赖审计、秘密扫描、PR/main CI 全绿。

## 部署与回滚边界

- 部署前保存不覆盖的 `starstack-api.service.pre-ss-judge-001`，安装新 unit 后先执行 `systemd-analyze verify`、内核门禁和 transient probe，再重启 API。
- 重启后必须在 journal 看到 `Sandbox enabled`，随后健康检查和 pipe-only `run-custom` 都通过才恢复负载。
- 回滚只恢复旧 unit 和 API 可用性；旧 unit 下评测仍会安全失败，因此必须继续关闭评测流量与身份，禁止无沙箱兜底。
