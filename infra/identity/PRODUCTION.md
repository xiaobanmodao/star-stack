# StarStack 身份服务生产预发布手册

本手册对应 SS-AUTH-003 的方案 A。它只建立可审查的生产/预发布底座，默认不启用 OIDC，也不授权直接部署。开发运行时仍只使用 `compose.yaml`；production/staging 不能复用开发数据库、volume、Secret、Cookie 后缀或 `--dev` 参数。

## 冻结拓扑

```text
Internet -> Cloudflare/1Panel Nginx :443 -> StarStack Node 127.0.0.1:5174
                                            | public protocol proxy
                                            v
                                    Nginx 127.0.0.1:4444
                                             | host -> internal bridge
                                             v
                                    Hydra hook-IP:4444

Hydra container -> internal hook bridge -> Nginx hook-gateway:5175
                                           | exact POST + CIDR allowlist
                                           v
                                    StarStack Node 127.0.0.1:5174

Hydra container -> jieya.xingzhan.cc:hook-gateway:443
                   | canonical HTTPS + SNI/certificate verification
                   | UFW + Nginx: exact Hydra source /32 only
                   v
              existing Jieya TLS Nginx -> Jieya BFF 127.0.0.1:4180

Hydra -> identity-database (internal) -> PostgreSQL 16.15 (no host port)
Hydra Admin -> Nginx 127.0.0.1:4445 -> Hydra hook-IP:4445
Jieya BFF (same host) -> 127.0.0.1:5174/internal/oidc/logout-transactions
```

禁止把 Node 改为 `0.0.0.0`，禁止 `network_mode: host`，禁止公开 Admin、PostgreSQL、Token Hook 或 Logout Broker。production/staging Compose 不声明 Hydra `ports`：Docker 在容器只连接 internal 网络时会静默取消发布。Public/Admin 改由宿主 Nginx 只监听 IPv4 loopback，再反代到 Hydra 的固定 internal hook IP；数据库与 hook 网络仍均为 `internal: true`，不新增任何带外部默认路由的第三网络。

生产 Jieya BFF 与 StarStack 同机。Logout Broker 的唯一合法地址固定为 `http://127.0.0.1:5174/internal/oidc/logout-transactions`，只能由 Jieya 服务端携带独立私网凭据调用；不经过 `auth.xingzhan.cc`、Cloudflare、Public Hydra proxy 或 Token Hook bridge。公网身份 Nginx 对 `/internal/oidc/*` 始终返回 404，不为 Broker 新建 bridge 或公网入口。

Hydra 客户端注册中的 Back-Channel Logout URI 仍固定为 canonical `https://jieya.xingzhan.cc/auth/backchannel-logout`。Compose 在 Hydra 容器内把 `host.docker.internal` 与该 canonical 主机名都精确解析到 identity-hook 自身显式 gateway，请求仍使用原主机名完成 TLS SNI 与证书主机名校验；不得使用 Docker 特殊 `host-gateway`、IP、HTTP、公网绕行或关闭证书校验。该精确 location 只能合并到现有 `jieya.xingzhan.cc` TLS server，并仅允许 Hydra 的固定 hook `/32`，其他来源一律拒绝。宿主 UFW 同样只允许该 `/32` 经固定 bridge 到 gateway 的 TCP 443/5175，随后对该 bridge 执行 catch-all deny；不得放行整个 `/29`、其他接口或其他端口。

## 文件与版本

- production：`compose.production.yaml`、`hydra.production.yaml`、`postgres.production.pg_hba.conf`
- staging：`compose.staging.yaml`、`hydra.staging.yaml`、`postgres.staging.pg_hba.conf`
- Hydra：`v26.2.0-distroless`，固定 digest `sha256:ad53a123...d60c5e`
- PostgreSQL：`16.15-alpine3.24`，固定 digest `sha256:cf78e766...20685`
- production 与 staging 使用不同项目名、network、volume、数据库用户和全部 Secret；二者不得同时在 2C2GiB 主机常驻。

## Secret 与文件权限

生产需要六个互不相同、至少 32 字节的随机值：

- `HYDRA_POSTGRES_PASSWORD`
- `HYDRA_SYSTEM_SECRET`
- `HYDRA_COOKIE_SECRET`
- `OIDC_TOKEN_HOOK_SECRET`
- `OIDC_LOGOUT_BROKER_SECRET`
- `JIEYA_OIDC_CLIENT_SECRET`

从 `production.env.example` 或 `staging.env.example` 复制名称到仓库外文件。文件必须为普通单链接文件、`0600`（或受控身份运维组的 `0640`），不能经 symlink 到达。Secret 不得出现在 Git、PM2/Nginx 日志、Shell history、工单或聊天中。Hydra system/cookie Secret 与 PostgreSQL 数据库是同一恢复单元，不能只轮换文件后挂回旧库。

### StarStack API 的 systemd credentials 切换

OIDC 启用后的 StarStack API 不再由 PM2 保存环境变量。仓库提供
`infra/identity/systemd/starstack-api.service` 和无 Secret 启动器
`scripts/identity/systemd-server-launcher.mjs`：systemd 从
`/etc/starstack/server/` 加载三个 root 管理的 credential，启动器用
`O_NOFOLLOW`、单链接、权限、realpath 与 inode 复核读取它们，然后以
`process.execve` 原地替换为 `/usr/bin/node /opt/star-stack/server/index.js`。
它只在失败时输出固定错误，不输出配置值。

- `/etc/starstack/server/starstack-environment`：严格 JSON 对象，保存现有 Node 应用配置，包括 Turnstile、SMTP、判题、
  数据库/备份、VAPID/WebPush、JWT 与 OIDC 非 Secret 配置；默认必须包含
  `OIDC_ENABLED=false`。
- `oidc-token-hook-secret`：只含一行 Token Hook Secret。
- `oidc-logout-broker-secret`：只含一行 Logout Broker Secret，且必须与前者不同。

切换前先确认服务器 Node 提供 `process.execve`；缺失时停止，不能退回会把
Secret 保存到 PM2 的做法。首次迁移只从正在运行且 cwd 精确为
`/opt/star-stack`、入口为 `server/index.js` 的 PID 读取 `/proc/<pid>/environ`，
不调用会把整份环境打印到终端的 PM2 子命令。迁移器按白名单保留当前应用
变量，把两个身份 Secret 分离后，以一个目录 rename 原子提交；目标已存在、
Secret 缺失/相同/过短、路径或权限异常时全部失败关闭，不覆盖旧文件。

```bash
install -d -m 0700 -o root -g root /etc/starstack
/usr/bin/node -e "if (typeof process.execve !== 'function') process.exit(1)"
STARSTACK_API_PID="$(pm2 pid star-stack-api)"
test "$STARSTACK_API_PID" -gt 1
sudo /usr/bin/node /opt/star-stack/scripts/identity/migrate-pm2-to-systemd-credentials.mjs \
  --pid "$STARSTACK_API_PID"
sudo install -m 0644 -o root -g root \
  /opt/star-stack/infra/identity/systemd/starstack-api.service \
  /etc/systemd/system/starstack-api.service
sudo systemd-analyze verify /etc/systemd/system/starstack-api.service
```

#### OJ 沙箱与 systemd 挂载保护

评测器会为每次执行创建更低权限的 user/mount/PID/network namespace，并在其中
挂载最小 chroot。`ProtectKernelTunables=true`、`ProtectKernelLogs=true` 和
`ProtectKernelModules=true` 会在 API service 的外层 mount namespace 锁定
`/proc` 与 `/usr` 的继承挂载，导致内层 `unshare --mount-proc`、只读 bind mount
失败。它们只在 `starstack-api.service` 中显式设为 `false`；备份 unit 不运行用户
代码，继续保留三项保护。

这不是无沙箱回退。API 仍以固定非 root 用户运行，并保留 `NoNewPrivileges=true`、
`PrivateDevices=true`、`PrivateTmp=true`、`ProtectSystem=full`、`ProtectHome=true`、
`ProtectControlGroups=true`、`RestrictSUIDSGID=true`、`RestrictRealtime=true`、
`LockPersonality=true`、`MemoryMax` 和 `TasksMax`。此外 `CapabilityBoundingSet=` 与
`AmbientCapabilities=` 必须为空，宿主必须满足 `kernel.dmesg_restrict=1`。评测脚本
只在新 user namespace 内获得挂载最小 chroot 所需的 namespace-local 能力；宿主
capability 不会授予 Node 或用户代码。`SystemCallFilter=~@module syslog` 继续从
宿主层拒绝模块加载/卸载系统调用和内核日志 syscall，不过滤评测必需的 mount/unshare。

部署前先保留唯一回滚副本，再安装候选 unit。禁止覆盖既有回滚文件：

```bash
BACKUP_UNIT=/etc/systemd/system/starstack-api.service.pre-ss-judge-001
sudo test ! -e "$BACKUP_UNIT"
sudo cp --preserve=mode,ownership,timestamps -- \
  /etc/systemd/system/starstack-api.service "$BACKUP_UNIT"
sudo install -m 0644 -o root -g root \
  /opt/star-stack/infra/identity/systemd/starstack-api.service \
  /etc/systemd/system/starstack-api.service
sudo systemd-analyze verify /etc/systemd/system/starstack-api.service
test "$(cat /proc/sys/kernel/dmesg_restrict)" = 1
sudo env STARSTACK_JUDGE_SANDBOX_CONFIRM=VERIFY_ONLY \
  /bin/bash /opt/star-stack/scripts/judge/verify-installed-systemd-sandbox.sh
```

最后一条只启动一次无 Secret、无用户代码的 transient unit，在完整候选硬化属性下
执行 `/bin/true`。它不重启 API、不写数据库；任一步失败都停止，不能删除更多
systemd 保护项。门禁通过后才允许在维护窗口重载：

```bash
sudo systemctl daemon-reload
sudo systemctl restart starstack-api.service
sudo systemctl is-active --quiet starstack-api.service
sudo journalctl -u starstack-api.service --since '-2 minutes' --no-pager \
  | grep -F 'Sandbox enabled: Linux namespaces and resource limits are available'
curl --fail --silent --show-error http://127.0.0.1:5174/api/health
```

随后只用既有 pipe-only `production-judge-fixture.mjs` 做一次 `run-custom`，不得用
真实账号或正式提交接口。若 API、健康检查或评测失败，立即停止负载与身份开放，
按下面命令恢复原 unit：

```bash
sudo test -f /etc/systemd/system/starstack-api.service.pre-ss-judge-001
sudo test ! -L /etc/systemd/system/starstack-api.service.pre-ss-judge-001
sudo install -m 0644 -o root -g root \
  /etc/systemd/system/starstack-api.service.pre-ss-judge-001 \
  /etc/systemd/system/starstack-api.service
sudo systemctl daemon-reload
sudo systemctl restart starstack-api.service
sudo systemctl is-active --quiet starstack-api.service
```

旧 unit 会继续让评测失败关闭，因此回滚后必须保持评测流量和身份关闭，不能临时
绕过 `sandboxAvailable`；待重新修复后再开放。

如果旧 PM2 进程没有两个身份 Secret，迁移器会停止。此时须通过已批准的
root-only Secret 生成流程直接创建两个独立 credential，不能把值放进命令行、
聊天或仓库。`infra/identity/systemd/starstack-environment.example` 只用于核对变量
名称，不能覆盖现场配置。必须逐项比较迁移前后的功能：Turnstile、注册邮件、
管理员初始化、判题编译器/并发、SQLite/备份路径、WebPush/VAPID 和任何 JWT
变量；缺一项就不停止 PM2。若 VAPID 不在进程环境，迁移器只接受精确
`/opt/star-stack/server/.vapid.json` 的 `0600`、单链接、非 symlink 现有密钥对并
迁入 JSON credential；它不会生成新密钥。文件缺失、半套密钥或元数据异常时停止，
避免令现有浏览器推送订阅全部失效。

维护窗口内先保持 `OIDC_ENABLED=false`，停止 PM2 后启动 systemd，验证主站、
OJ 和 `/api/health`。失败时停止 systemd 并恢复原 PM2 进程；成功且完成独立
备份后才执行 `pm2 delete star-stack-api` 与 `pm2 cleardump` 清除旧持久 dump，
并复核 dump 不再含应用定义。若当前 PM2 版本没有 `cleardump`，立即停止并按
该版本官方流程单独处置，不能用会再次持久化 Secret 的替代命令。OIDC 仍保持
关闭，直到后续全部协议门禁通过。

### 生产 SQLite 日常备份 timer

`/api/health` 的 `backup` 状态依赖 `/www/backup/starstack` 中存在最近一次成功
备份。生产环境使用仓库提供的 `starstack-backup.service` 与
`starstack-backup.timer`，每天 `02:00 UTC` 执行一次并启用 `Persistent`。这只负责
StarStack SQLite 的日常恢复点，不替代身份发布前包含 Hydra PostgreSQL 的联合备份。

root timer 禁止直接执行可由应用账号更新的 `/opt/star-stack/backup.sh`。每次发布只从
已经通过 CI 且人工确认的固定 SHA，把审核后的脚本复制为 root 管理的普通单链接文件
`/usr/local/sbin/starstack-backup`；不能使用 symlink，也不能把仓库目录加入 service 的
可写路径。安装前先确认服务器具备固定的 `flock` 与 `sqlite3`：

```bash
cd /opt/star-stack
test ! -L backup.sh
test -f backup.sh
test -x /usr/bin/flock
test -x /usr/bin/sqlite3
sudo install -d -o root -g starstack -m 0750 /www/backup/starstack
sudo install -o root -g root -m 0755 backup.sh /usr/local/sbin/starstack-backup
sudo install -o root -g root -m 0644 \
  infra/identity/systemd/starstack-backup.service \
  /etc/systemd/system/starstack-backup.service
sudo install -o root -g root -m 0644 \
  infra/identity/systemd/starstack-backup.timer \
  /etc/systemd/system/starstack-backup.timer
sudo cmp --silent backup.sh /usr/local/sbin/starstack-backup
sudo env LC_ALL=C stat -c '%U:%G %a %h %F' /usr/local/sbin/starstack-backup
sudo systemd-analyze verify \
  /etc/systemd/system/starstack-backup.service \
  /etc/systemd/system/starstack-backup.timer
```

目标脚本必须显示 `root:root 755 1 regular file`；两个 unit 必须为 root 所有、普通
单链接 `0644` 文件。oneshot 固定 `BACKUP_DIR=/www/backup/starstack`、
`BACKUP_GROUP=starstack`、`DB_PATH=/opt/star-stack/server/data/starstack.sqlite` 和
`KEEP_DAYS=7`，通过 `/usr/bin/flock` 的固定锁防止并行执行。`ProtectSystem=strict`
下只读数据库目录，只允许写备份目录与 `/run/lock`。任何现场路径、用户、权限或
二进制不一致都应停止，不能放宽 sandbox 或改回 root cron 执行仓库脚本。

先手动运行并验证一份备份，再启用 timer；不要同时使用 `backup.sh --install-cron`：

```bash
sudo systemctl daemon-reload
sudo systemctl start starstack-backup.service
sudo systemctl show starstack-backup.service -p Result -p ExecMainStatus
sudo journalctl -u starstack-backup.service --since today --no-pager
sudo systemctl enable --now starstack-backup.timer
sudo systemctl show starstack-backup.timer -p Persistent -p NextElapseUSecRealtime
sudo systemctl list-timers starstack-backup.timer --all
sudo systemctl cat starstack-backup.service | grep -F '/usr/local/sbin/starstack-backup'
! sudo systemctl cat starstack-backup.service | grep -F '/opt/star-stack/backup.sh'
```

把刚生成的文件路径显式填入 `LATEST_BACKUP`，使用应用账号完成隔离解压和 SQLite
完整性检查，然后确认健康接口的 `backup.healthy` 已恢复：

```bash
cd /opt/star-stack
LATEST_BACKUP=/www/backup/starstack/starstack_YYYYMMDD_HHMMSS.db.gz
test -f "$LATEST_BACKUP"
sudo -u starstack env BACKUP_FILE="$LATEST_BACKUP" npm run db:verify-backup
curl -fsS http://127.0.0.1:5174/api/health
```

恢复演练或真实恢复前先停止 timer，验证目标备份并对当前数据库再做一次独立备份；
不得在 API/评测仍写入时覆盖 live SQLite。只允许按 `DEPLOYMENT.md` 在隔离路径完成
解压、`integrity_check` 与外键检查后进入维护窗口。恢复结束并验证主站、OJ、数据库
和 `/api/health` 后，执行 `sudo systemctl enable --now starstack-backup.timer`。若
oneshot、备份验证或健康状态任一失败，保留现有数据库并检查 journal，不得删除旧
恢复点来制造绿色状态。

### 一次性生产协议夹具

生产协议门禁只能以父子匿名 pipe 启动精确路径
`/opt/star-stack/scripts/identity/production-protocol-fixture.mjs`。不得把 stdin/stdout
重定向到普通文件、TTY、日志或 shell 变量。父进程生成非 Secret 随机 tombstone，
每帧最多 16 KiB，并按以下 NDJSON 顺序交换；`requestId` 每次唯一且响应精确回显：

```json
{"protocol":"starstack-production-fixture/v1","requestId":"...","type":"prepare","tombstone":"..."}
{"protocol":"starstack-production-fixture/v1","requestId":"...","ok":true,"type":"prepared","fixture":{"loginId":"jy-gate-...","password":"..."}}
{"protocol":"starstack-production-fixture/v1","requestId":"...","type":"cleanup","tombstone":"..."}
{"protocol":"starstack-production-fixture/v1","requestId":"...","ok":true,"type":"cleaned","accountDisabled":true,"sessionsRevoked":true,"outboxDrained":true}
{"protocol":"starstack-production-fixture/v1","requestId":"...","type":"close"}
{"protocol":"starstack-production-fixture/v1","requestId":"...","ok":true,"type":"closed"}
```

helper 只创建唯一的普通、无邮箱、无管理员权限 `jy-gate-*` 账号；明文密码只存在
于进程内存和匿名 pipe。账号创建前会写入
`/var/lib/starstack/identity-gates/<sha256(tombstone)>.json` 的 root-only、`0600`、
单链接 passwordless receipt。receipt 只保留清理所需的账号 ID、不可变 subject、
阶段和时间，不保存密码、hash、Cookie 或 Token。Ubuntu 的系统目录 `/run/lock`
保持合法的 root-owned sticky `1777`，不得 chmod 或把它误判为私有目录。helper 会在
其中原子创建并复核 root-owned、普通非 symlink、`0700` 的专用目录
`/run/lock/starstack-identity`；全机锁与 operation guard 分别位于该目录中的
`starstack-production-fixture.lock` 及其 `.operation` 文件。预先占用目录名、owner/
权限不符、缺少 sticky 防护或路径经过 symlink 时，必须在创建账号前失败关闭。
重复 tombstone、并行 helper、重复 requestId、多余字段、乱序或超大帧同样失败关闭。

首次使用前创建固定私有状态目录；它不能是 symlink，必须始终由 root 独占：

```bash
sudo install -d -m 0700 -o root -g root /var/lib/starstack
```

首次成功运行后只验证专用目录，不修改系统父目录；helper 结束时两个锁文件必须被
移除，`0700` 目录本身保留供后续门禁复用：

```bash
sudo env LC_ALL=C stat -c '%U:%G %a %F' /run/lock
sudo env LC_ALL=C stat -c '%U:%G %a %F' /run/lock/starstack-identity
sudo find /run/lock/starstack-identity -mindepth 1 -maxdepth 1 -print
```

现场预期父目录为 `root:root 1777 directory`、子目录为 `root:root 700 directory`，
且最后一条命令无输出。不得通过 `chmod /run/lock`、删除 sticky bit 或预建宽权限
子目录来绕过检查。日常 SQLite 备份仍使用 backup unit 中独立的
`/run/lock/starstack-backup.lock`，不能与身份 fixture 主锁或 operation guard 共用。

父门禁必须在 `finally` 发送 cleanup。cleanup 只调用现有
`transitionAccountStatus(..., status: 'deleted')`，保留用户 tombstone，撤销主站/
账号中心/OIDC session 并有界 drain outbox；禁止物理删除 users、reset schema 或
覆盖 Hydra client。只有三个安全布尔值都为 true 才能继续门禁。helper 被强杀后，
运维可用 `STARSTACK_PRODUCTION_FIXTURE_MODE=cleanup-only` 启动同一程序，以 receipt
中的 tombstone 作为第一帧执行幂等清理，再 close；不得重新 prepare 或从 receipt
导出凭据。receipt 保留作审计，不能在门禁脚本里自动删除。

### 15 分钟混合负载中的单次 OJ 评测

正式提交 `/api/oj/submissions` 会永久保留提交、统计和活动记录，绝不能用它做
生产负载 fixture，也不能事后物理删除历史来伪装无痕。当前唯一允许的单评测
路径是 `/api/oj/run-custom`：它只读取已认证账号、进入 sandbox 队列并返回结果，
不创建 submission、解题、Rating、热力图或题目记录。

父门禁在持有上述 `jy-gate-*` 的 pipe-only 凭据时，使用匿名 stdin/stdout 直接
启动 `/usr/bin/node /opt/star-stack/scripts/identity/production-judge-fixture.mjs`；
不能通过 npm（npm 会向协议 stdout 写启动信息）、环境变量、命令行参数或临时文件
传递凭据。它只接受一个 NDJSON frame：

```json
{"protocol":"starstack-production-judge/v1","requestId":"...","type":"judge","loginId":"jy-gate-...","password":"..."}
```

helper 在内存中调用 loopback `/api/login`，固定以 C++ 执行 `1 + 2` 的自定义输入，
验证输出为 `3`，再调用 `/api/logout`。登录 Token 不离开进程内存；只有登出返回
204 后才输出一帧安全结果：

```json
{"protocol":"starstack-production-judge/v1","requestId":"...","ok":true,"type":"judged","status":"Accepted","timeMs":7}
```

Jieya 的 15 分钟 identity-only 负载先独立运行；15 分钟混合负载期间只在约定时点
触发上述 helper 一次，随后仍由生产协议 helper 的 `finally cleanup` tombstone
账号。sandbox 不可用、登录触发 Turnstile、评测/登出失败、出现额外 stdout，或
代码审查发现 `/run-custom` 新增持久化写入时立即停止；不得改用真实账号、真实
题目提交、放宽沙箱或删除历史数据。

PostgreSQL TLS 证书的 SAN 必须包含容器 DNS 名 `postgres`。固定 Alpine 镜像中的 `postgres` UID 必须在服务器只读检查后记录；私钥设为该 UID 所有、`0600`，证书与 CA 可为 root 所有、`0644`。不得为了让容器读取私钥而改成全局可读。

## 预发布顺序（保持关闭）

1. 只读确认 Docker/Compose、Nginx/1Panel 布局、Cloudflare 模式、空闲端口、bridge CIDR、磁盘、内存、swap、当前 SQLite/备份状态。
2. 创建独立 Secret、PostgreSQL TLS 材料和 production/staging env 文件；此时 `OIDC_ENABLED=false`。
3. 为 identity-hook `/28`～`/30` 固定第一可用地址作为 gateway、另一地址作为 Hydra `/32`，并使用 Compose 中冻结的 bridge interface 名。若同名 hook network 已由旧 Compose 创建，先证明它没有任何 attached container；只能在独立授权下删除这个空 hook network，再由新 Compose 重建。不得删除/重建 `identity-database`、PostgreSQL volume 或正在运行的 PostgreSQL。
4. 用 `identity:production:render-hook-nginx`、`identity:production:render-hydra-loopback-nginx` 和 `identity:production:render-hook-firewall` 分别生成 Token Hook、Public/Admin loopback bridge 与 UFW 候选；渲染器只输出，不安装。UFW 必须保持 default-deny incoming，并仅允许 Hydra `/32` 到 gateway 的 TCP 443/5175，随后拒绝该 bridge 的其他 INPUT。
5. 保留 Jieya 已启用站点中的唯一精确 Back-Channel location，用 `identity:production:render-backchannel-nginx` 只生成该 location 已 include 的 access snippet。`IDENTITY_HYDRA_HOOK_IP` 必须是 hook bridge 内为 Hydra 保留的固定可用地址；snippet 只允许这个 `/32`，并固定 POST-only 与私有路由标记，不能包含第二个 location、proxy 或额外 allow。
6. 创建 root 所有、普通用户不可写的 `/var/lib/acme/.well-known/acme-challenge` webroot；`auth.xingzhan.cc.conf` 的 80 server 只从该目录读取精确 HTTP-01 token，其他 HTTP 请求才执行 308。不得让 ACME challenge 进入 StarStack/Hydra，也不得让 Certbot 自动改写已审计模板。
7. 将 `auth.xingzhan.cc.conf` 合并进现有 TLS 配置；不得覆盖 1Panel/Certbot 的证书配置。公网模板明确拒绝 `/internal/oidc/`。
8. 安装并验证 `starstack-api.service` 候选，确认空 capability、`kernel.dmesg_restrict=1`，再运行无用户代码的 transient judge sandbox probe。
9. 运行下面的只读预检。它只读 systemd unit、内核门禁、文件、资源、Compose 渲染及可选 HTTP 健康状态，不执行 pull/up/migrate/reload/写库。
10. 另行审批后才允许在 staging 执行镜像拉取、migration、客户端创建与真实协议测试。SS-AUTH-003 不执行这一步。

所有渲染器只向标准输出写候选内容，不修改 Nginx/UFW。四个输出目标固定如下：

- `identity:production:render-hook-nginx` → `/etc/nginx/conf.d/starstack-token-hook.conf`
- `identity:production:render-backchannel-nginx` → Jieya 站点已 include 的 `/etc/nginx/snippets/jieya-backchannel-access.conf`
- `identity:production:render-hydra-loopback-nginx` → `/etc/nginx/conf.d/starstack-hydra-loopback.conf`，且不能 include 到公网 server
- `identity:production:render-hook-firewall` → 仅供人工核对并经独立审批执行的 UFW 命令流，不对应可重定向安装的配置文件；不得直接编辑 `/etc/ufw/user.rules`

Back-Channel 不能另存一个未 include 的完整 location 冒充生效配置。审查无占位符、确认 UFW 当前编号、执行 `nginx -t`，再由独立变更审批决定是否安装/reload或添加持久规则：

```bash
export IDENTITY_ENVIRONMENT=production
export IDENTITY_HOOK_SUBNET=172.30.40.0/29
export IDENTITY_HOOK_GATEWAY_IP=172.30.40.1
export IDENTITY_HYDRA_HOOK_IP=172.30.40.2
export HYDRA_PUBLIC_PORT=4444 HYDRA_ADMIN_PORT=4445
npm run identity:production:render-hook-nginx
npm run identity:production:render-backchannel-nginx
npm run identity:production:render-hydra-loopback-nginx
npm run identity:production:render-hook-firewall
```

```bash
export NODE_ENV=production OIDC_ENABLED=false
export IDENTITY_ENVIRONMENT=production
export OIDC_ISSUER=https://auth.xingzhan.cc
export OIDC_HYDRA_PUBLIC_URL=http://127.0.0.1:4444
export OIDC_HYDRA_ADMIN_URL=http://127.0.0.1:4445
export OIDC_TOKEN_HOOK_URL=http://host.docker.internal:5175/internal/oidc/token-hook
export IDENTITY_COMPOSE_FILE=/opt/star-stack/infra/identity/compose.production.yaml
export IDENTITY_ENV_FILE=/etc/starstack/identity/production.env
# 这里必须填写受审计的真实普通文件，不能填写 sites-enabled symlink。
export IDENTITY_NGINX_AUTH_CONFIG=/etc/nginx/sites-available/auth.xingzhan.cc
export IDENTITY_NGINX_HOOK_CONFIG=/etc/nginx/conf.d/starstack-token-hook.conf
export IDENTITY_NGINX_HYDRA_LOOPBACK_CONFIG=/etc/nginx/conf.d/starstack-hydra-loopback.conf
export IDENTITY_NGINX_BCL_SITE_CONFIG=/etc/nginx/sites-available/jieya.xingzhan.cc
export IDENTITY_NGINX_BCL_ACCESS_CONFIG=/etc/nginx/snippets/jieya-backchannel-access.conf
# 1Panel/OpenResty 使用其他二进制时必须填写现场验证过的命令路径。
export IDENTITY_NGINX_BIN=nginx
export IDENTITY_SS_BIN=ss IDENTITY_UFW_BIN=ufw
export IDENTITY_HOOK_SUBNET=172.30.40.0/29
export IDENTITY_HOOK_GATEWAY_IP=172.30.40.1
export IDENTITY_HYDRA_HOOK_IP=172.30.40.2
export HYDRA_PUBLIC_PORT=4444 HYDRA_ADMIN_PORT=4445
# 只可在真实请求证明宿主 Nginx 的 bridge source 后设置，必须精确等于 gateway /32。
export IDENTITY_PROXY_CIDR=172.30.40.1/32
export POSTGRES_TLS_CERT_FILE=/etc/starstack/identity/postgres/server.crt
export POSTGRES_TLS_KEY_FILE=/etc/starstack/identity/postgres/server.key
export POSTGRES_TLS_CA_FILE=/etc/starstack/identity/postgres/ca.crt
npm run identity:production:preflight
```

静态预检的配置输入始终是 `sites-available` 等位置中的真实普通单链接文件。它会解析内存中的 `nginx -T` marker，并把 marker 的 `realpath` 与受审计文件的 `realpath` 精确比较：标准 `sites-enabled -> ../sites-available` 一跳直接 symlink 可以证明站点已加载；断链、目录 symlink、多跳 symlink、指向另一普通文件、重复 marker 或未加载文件都会失败。access snippet 必须由 active config 以受审计普通文件路径直接加载，不能改成 symlink。

同一静态预检还会证明 auth、Jieya 站点、access snippet 与 Hydra loopback bridge 均进入当前 active config，精确 Back-Channel location 全局只出现一次，loopback Public/Admin 端口由 `ss` 证明仅监听 `127.0.0.1`，UFW 为 active/default-deny 且只有精确 443/5175 allow + bridge catch-all deny。配置 dump 与防火墙输出不写日志。运行时已由另行审批启动后，才可加 `IDENTITY_PREFLIGHT_RUNTIME=1` 校验通过 loopback Nginx 到达的 Hydra Admin、Public Discovery 与 JWKS。预检成功仍不代表可把 `OIDC_ENABLED` 改为 true。

### HTTP-01 自动续期边界

身份域证书运行路径固定为 `/etc/letsencrypt/live/auth.xingzhan.cc/fullchain.pem` 与 `privkey.pem`。在 DNS 尚未发布时通过手工 DNS-01 签发的证书必须明确标记为 manual，不能宣称自动续期完成。

切换到 HTTP-01 前，先安装本仓库受审计的 80 server，并用本地 `--resolve` 证明：存在 token 返回精确内容，不存在 token 返回 404，POST/PUT 被拒绝，其他 HTTP 路径才返回同 Host HTTPS 308。之后才可发布 A 记录，使用 ACME staging 的独立临时证书名验证 webroot；staging 绿色后再显式更新 production renewal method，并执行 dry-run。续期 hook 只能在 `nginx -t` 成功后 reload。整个续期转换不授权启用 OIDC、启动 Hydra 或修改 443 身份代理范围。

### Back-Channel TLS 现场硬门禁

Hydra 已由另行审批启动、Jieya BFF 仍只监听 loopback 后，必须在启用 OIDC 前执行只读链路证明。验证器不重启容器、不迁移数据库、不读取客户端 Secret；它进入 Hydra 容器的 network namespace，确认 hook gateway 路由源地址精确等于 `IDENTITY_HYDRA_HOOK_IP`。随后分别向 gateway:5175 发送无凭据 Token Hook POST，以及向 gateway:443 使用 canonical SNI/系统 CA 发送 `application/x-www-form-urlencoded` 的无效 Back-Channel Logout Token；两条链都必须得到预期拒绝状态与私有 route marker。403、415、错误 server、上游失败、证书失败或源地址变化都必须停止。

```bash
export IDENTITY_ENVIRONMENT=production
export IDENTITY_COMPOSE_FILE=/opt/star-stack/infra/identity/compose.production.yaml
export IDENTITY_ENV_FILE=/etc/starstack/identity/production.env
export IDENTITY_HOOK_SUBNET=172.30.40.0/29
export IDENTITY_HOOK_GATEWAY_IP=172.30.40.1
export IDENTITY_HYDRA_HOOK_IP=172.30.40.2
export IDENTITY_TLS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt
npm run identity:production:verify-backchannel
```

服务器必须证明：宿主 Nginx 能访问 Hydra 固定 internal IP:4444/4445；Hydra 能经自身 hook gateway 访问 5175/443；UFW 只放行固定 Hydra `/32` 到 gateway 的两个端口；Public/Admin 只在 loopback 监听。任一路由不存在、源地址不是固定 `/32`、证书校验失败、Nginx/UFW 只能放宽到 `/29`/公网，立即停止；不得移除 `internal`、恢复 Docker `ports`、新增带 egress 的 bridge、使用 `network_mode: host`、开放 4180 或关闭 TLS 验证。

### 公网日志、HSTS 与客户端地址边界

- 身份域 HSTS 只设置当前 host 的 `max-age=31536000`，不包含 `includeSubDomains`。只有全部相关子域持续 HTTPS 的独立审计通过后才能另行评估扩大范围。
- 身份 server 关闭 Nginx access log，因为默认 `$request` 会记录完整查询串，其中包含 login/consent challenge、state、nonce 和 PKCE 元数据。应用与 Hydra 日志仍必须保持敏感值脱敏；排障使用状态码、计数与 request ID，不能临时恢复完整 URI 日志。
- 模板用 `X-Forwarded-For $remote_addr` 覆盖客户端提供的整条链，不使用 `$proxy_add_x_forwarded_for`。StarStack 保持 `TRUST_PROXY_HOPS=1`，只信任直接相邻的本机 Nginx。
- 若 Cloudflare 位于源站前，Nginx `real_ip` 只能信任 Cloudflare 官方当前 CIDR，并从其受保护头恢复 `$remote_addr`；源站防火墙还应限制 443 只接受 Cloudflare 与运维来源。在这些现场事实未验证时，`$remote_addr` 可能只是 Cloudflare edge，限流会保守地合并到 edge IP；这会降低可用性但不会信任浏览器伪造链，身份必须继续关闭。

## 2C2GiB 资源预算与停止线

| 项目 | 门禁预算 |
| --- | ---: |
| 操作系统、Docker、Nginx、systemd 基础 | 350～500 MiB |
| StarStack Node（systemd cgroup 上限） | 768 MiB |
| 单个判题任务 | 最多 256 MiB，`JUDGE_CONCURRENCY=1`，计入上述 cgroup |
| PostgreSQL 容器 | 384 MiB，30 connections，64 MiB shared buffers |
| Hydra 容器 | 256 MiB |
| 峰值余量 | 至少 250 MiB，且不能持续 swap |

staging 不与 production 同机常驻。出现 OOM、持续 swap、PM2/容器重启、健康检查超时、判题延迟显著回退或可用内存长期低于 250 MiB，立即保持/恢复 `OIDC_ENABLED=false` 并停止继续启用。至少保留 5 GiB 可用磁盘；PostgreSQL volume、Docker 日志与双数据库备份必须纳入磁盘告警。

## 备份与隔离恢复演练

身份备份必须同时包含 StarStack SQLite 和 Hydra PostgreSQL，生成同一 manifest 与 SHA-256。PostgreSQL 不发布宿主端口，脚本通过固定 Compose 的 `postgres` 服务执行 `pg_dump`，不会临时开放端口。宿主需要 `sqlite3` 与 PostgreSQL 16 客户端的 `pg_restore`。

```bash
export IDENTITY_BACKUP_CONFIRM=CREATE_VERIFIED_BACKUP
export IDENTITY_ENVIRONMENT=production
export IDENTITY_BACKUP_DIR=/srv/backups/starstack-identity
export STARSTACK_DB_PATH=/opt/star-stack/server/data/starstack.sqlite
export IDENTITY_COMPOSE_FILE=/opt/star-stack/infra/identity/compose.production.yaml
export IDENTITY_ENV_FILE=/etc/starstack/identity/production.env
npm run identity:production:backup

export IDENTITY_BACKUP_SET=/srv/backups/starstack-identity/starstack-identity-YYYY-MM-DD_HH-MM-SS
npm run identity:production:verify-backup
```

恢复演练必须在隔离主机或独立 Docker project/network/volume 中进行，目标数据库和 SQLite 路径必须为空且不能指向生产。步骤是：验证 manifest/hash；把 SQLite 复制到隔离路径并执行 `PRAGMA integrity_check`、迁移和核心计数；在新的 PostgreSQL 16.15 空库执行 `pg_restore --exit-on-error --clean --if-exists`；使用与备份绑定的 Hydra system/cookie Secret 启动隔离 Hydra；验证 Discovery/JWKS、active signing `kid`、授权码+PKCE、Refresh 轮换/重放和全局退出。任何一项失败都不得覆盖生产 volume 或 SQLite。生产恢复需要独立变更审批、停写窗口和恢复前二次备份。

## 启用前仍需确认

- `auth.xingzhan.cc` DNS、Cloudflare TLS 模式、源站证书路径与真实 Nginx include 归属。
- Cloudflare 源站 ACL、Nginx `real_ip` 可信 CIDR及实测 `$remote_addr`；未确认时不得按用户 IP 放宽限流。
- Docker bridge 的空闲 RFC1918 `/29`、显式第一可用 gateway、Hydra 固定 hook `/32`，并证明 host→Hydra 4444/4445、Hydra→gateway 5175/443、loopback listeners、UFW exact INPUT 与 canonical SNI/CA 全部成立。
- 1Panel 是否会重写手工 Nginx include，以及 bridge listener 的防火墙/SELinux/AppArmor 状态。
- Jieya BFF 必须继续与 StarStack 同机，并保持固定 loopback Broker URL；任何跨主机迁移都要重新设计私网与认证边界，不能改用公网身份域。
- PostgreSQL TLS 私钥对应的固定容器 UID、备份目录/保留期/离机复制、监控与告警渠道。
- 首次客户端创建、Client Secret 轮换、Hydra migration 和 `OIDC_ENABLED=true` 各自的审批窗口。

没有以上服务器只读证据时，本阶段唯一安全状态是 Compose 不启动、PM2 `OIDC_ENABLED=false`。
