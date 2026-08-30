# StarStack 生产部署与更新

本文档是当前项目唯一的生产部署流程，适用于 Ubuntu 服务器、PM2、Nginx、SQLite 和域名 `xingzhan.cc`。

## 1. 生产结构

| 项目 | 当前值 |
| --- | --- |
| 项目目录 | `/opt/star-stack` |
| 后端端口 | `5174` |
| 前端静态目录 | `/var/www/starstack-dist` |
| PM2 进程 | `star-stack-api` |
| Nginx 配置 | `/etc/nginx/sites-available/starstack` |
| 访问域名 | `https://xingzhan.cc`、`https://www.xingzhan.cc` |
| 数据库 | `server/data/starstack.sqlite` |

生产服务由 Nginx 提供前端静态文件和 HTTPS，由 Nginx 将 `/api/` 转发到 PM2 管理的 Express 服务。生产模式下 Express 默认只监听 `127.0.0.1:5174`，不能绕过 Nginx 直接公网访问。判题依赖 C++17、Python 3 和 Java 17。

### 身份服务预发布状态

Hydra/OIDC 当前仍默认关闭，`ecosystem.config.cjs` 明确设置 `OIDC_ENABLED=false`。SS-AUTH-003 只提供独立 production/staging 配置和只读门禁，不授权在日常更新流程中启动 Hydra、执行其迁移或注册客户端。身份拓扑、Secret、2C2GiB 资源预算、Nginx bridge、联合备份与隔离恢复说明见 [`infra/identity/PRODUCTION.md`](./infra/identity/PRODUCTION.md)。禁止复用 `infra/identity/compose.yaml` 的开发配置，禁止 `network_mode: host`，禁止将 Node、Hydra Admin、PostgreSQL 或内部 Hook 暴露公网。

身份域模板不使用 `includeSubDomains` HSTS，并关闭包含完整查询串的 Nginx access log。模板覆盖客户端传入的 `X-Forwarded-For`，只传 `$remote_addr`；Cloudflare 源站 ACL 与 Nginx `real_ip` 可信网段未现场确认前，身份功能必须保持关闭。

### Cloudflare Turnstile

异常登录使用 Cloudflare Turnstile。`Site Key` 是前端公开配置，`Secret Key` 只能保存到后端运行环境，不能提交到 Git。

首次部署或更新前端时，在项目根目录创建未提交的 `.env.production`：

```bash
VITE_TURNSTILE_SITE_KEY=你的公开SiteKey
```

后端 PM2 环境需要配置：

```bash
export TURNSTILE_SECRET_KEY='你的SecretKey'
pm2 startOrRestart ecosystem.config.cjs --update-env
pm2 save
```

生产环境默认信任 Nginx 到 Node 的一层代理，并使用代理还原后的客户端 IP 做登录、注册和验证码限流。若前面还有其他反向代理，按实际链路设置 `TRUST_PROXY_HOPS`；不要让 Node 端口绕过 Nginx 直接暴露公网。

`TURNSTILE_HOSTNAMES` 已在 `ecosystem.config.cjs` 中限制为 `xingzhan.cc,www.xingzhan.cc`。不要把 Secret Key 写入仓库、前端代码或聊天记录。

### 注册邮箱验证码

注册需要邮箱验证码。以 Gmail SMTP 为例，先在发信 Google 账号中开启两步验证，再创建应用专用密码；应用专用密码只用于 SMTP，不要使用 Google 登录密码。服务器 PM2 环境需要配置：

```bash
export SMTP_HOST='smtp.gmail.com'
export SMTP_PORT='587'
export SMTP_SECURE='false'
export SMTP_USER='你的发信邮箱'
export SMTP_PASS='Google生成的应用专用密码'
export MAIL_FROM='StarStack <你的发信邮箱>'
pm2 startOrRestart ecosystem.config.cjs --update-env
pm2 save
```

应用专用密码和 `SMTP_PASS` 只保存在服务器 PM2 环境中，不要提交 `.env` 或写入仓库。后续日常更新使用 `pm2 restart star-stack-api`，避免在未重新注入密钥时用 `--update-env` 覆盖邮件环境变量。

## 2. 首次部署

### 2.1 安装服务器依赖

```bash
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ca-certificates curl git rsync sqlite3 build-essential python3 openjdk-17-jdk \
  util-linux coreutils \
  nginx certbot python3-certbot-nginx

curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
npm install -g pm2
```

确认运行环境：

```bash
node --version       # Node 22+
npm --version
g++ --version
python3 --version
java -version
command -v unshare
command -v timeout
command -v mount
command -v chroot
# 下面的检查必须以 starstack 账户执行；root 运行会被沙箱拒绝。
sudo -u starstack /bin/bash server/sandbox.sh /tmp 100 65536 - /bin/true
```

### 2.2 获取代码并安装依赖

```bash
git clone https://github.com/xiaobanmodao/star-stack.git /opt/star-stack
cd /opt/star-stack

npm ci --no-audit --no-fund
cd server && npm ci --no-audit --no-fund && cd ..
mkdir -p logs server/data
```

### 2.3 初始化数据库

新服务器必须使用迁移脚本初始化完整数据库。旧服务器更新也使用同一个脚本；它是幂等的，不会删除用户数据。

```bash
cd /opt/star-stack
export ADMIN_ID=admin
export ADMIN_NAME=admin
export ADMIN_PASSWORD="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 20)"
printf '请保存初始管理员密码：%s\n' "$ADMIN_PASSWORD"
node server/migrate.js
unset ADMIN_PASSWORD
```

初始密码只在初始化时输出一次。首次登录后应立即修改密码。不要删除 `server/data/starstack.sqlite` 来“解决”迁移问题。

### 2.4 构建并启动后端

```bash
cd /opt/star-stack
npm run build
mkdir -p /var/www/starstack-dist
rsync -a --delete dist/ /var/www/starstack-dist/

# 评测服务不得以 root 运行。先创建一次专用账户，并确保项目和数据库归该账户所有。
# useradd -r -m -s /usr/sbin/nologin starstack
# chown -R starstack:starstack /opt/star-stack
PM2_USER=starstack PM2_GROUP=starstack pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd -u starstack --hp /home/starstack
# 按 pm2 输出的提示执行启动命令，然后再次保存进程列表：
pm2 save

# 限制 PM2 日志体积，避免长期运行占满磁盘
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 20M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
```

验证后端：

```bash
curl -fsS http://127.0.0.1:5174/api/health
# 预期：ok=true，database.integrity 为 ok，disk.healthy 为 true；backup 字段应显示最近备份状态
pm2 status
```

### 2.5 配置 Nginx

项目中的 [`nginx.conf`](./nginx.conf) 是首次部署用的 HTTP 配置模板，已包含安全响应头、SSE 关闭代理缓冲和隐藏文件保护。只有在目标站点还没有有效配置时才执行下面的安装命令：

```bash
mkdir -p /var/www/starstack-dist
install -m 0644 nginx.conf /etc/nginx/sites-available/starstack
ln -sf /etc/nginx/sites-available/starstack /etc/nginx/sites-enabled/starstack
nginx -t
systemctl enable --now nginx
```

如果服务器已有 1Panel、Certbot 或 HTTPS 站点配置，不要直接覆盖 `/etc/nginx/sites-available/starstack`，否则可能丢失 443 监听和证书路径。先备份现有配置，再将本文件中的应用代理、安全响应头和静态目录配置合并到现有站点，保留证书相关指令：

```bash
cp -a /etc/nginx/sites-available/starstack \
  "/etc/nginx/sites-available/starstack.bak.$(date +%Y%m%d_%H%M%S)"
nginx -t && systemctl reload nginx
```

如果 Nginx 已经在运行，使用：

```bash
nginx -t && systemctl reload nginx
```

### 2.6 配置 HTTPS

确认域名的 A 记录已经指向服务器 IP 后执行：

```bash
certbot --nginx --non-interactive --agree-tos \
  --redirect \
  -m your-email@example.com \
  -d xingzhan.cc \
  -d www.xingzhan.cc
```

验证自动续期：

```bash
certbot renew --dry-run
```

## 3. 日常更新

以下流程会保留 SQLite 数据，并在更新数据库结构前先备份。不要使用 `git reset --hard`、`git clean -fd` 或直接删除数据库文件。

```bash
cd /opt/star-stack

# 1. 停止后端，避免更新期间写入数据库
pm2 stop star-stack-api

# 2. 备份数据库
./backup.sh

# 3. 拉取远程 main，要求无本地冲突
git fetch origin
git pull --ff-only origin main

# 4. 安装依赖
npm ci --no-audit --no-fund
cd server && npm ci --no-audit --no-fund && cd ..

# 5. 补齐旧数据库的新表、字段和索引
node server/migrate.js

# 6. 构建前端并同步到 Nginx 静态目录
npm run build
rsync -a --delete dist/ /var/www/starstack-dist/

# 7. 启动后端并检查 Nginx 配置
pm2 restart star-stack-api
pm2 save
nginx -t && systemctl reload nginx

# 8. 验证
pm2 status
curl -fsS https://xingzhan.cc/api/health
```

如果本次只修改了前端，可以跳过数据库迁移和后端重启，但仍需执行 `npm run build` 和 `rsync`。

发布前在本地执行质量门禁。先启动一个本地 API（建议使用 5180，避免影响开发服务），再执行 smoke 和健康压力检查：

```bash
PORT=5180 NODE_ENV=test node server/index.js
RELEASE_BASE_URL=http://127.0.0.1:5180 npm run test:release
```

需要包含浏览器浅色/深色审计时，再追加 `RELEASE_RUN_AUDIT=1`。发布检查失败时停止部署，不要用跳过参数掩盖失败。

## 4. 数据库备份与恢复

### 手动备份

```bash
cd /opt/star-stack
./backup.sh
```

默认备份目录为 `/www/backup/starstack`，默认保留 7 天。可以通过环境变量调整：

```bash
BACKUP_DIR=/srv/backups/starstack KEEP_DAYS=30 ./backup.sh
```

### 验证备份可恢复

备份完成后建议在临时目录解压并执行 SQLite 完整性检查，不会覆盖当前生产数据库：

```bash
cd /opt/star-stack
BACKUP_FILE=/www/backup/starstack/starstack_YYYYMMDD_HHMMSS.db.gz npm run db:verify-backup
```

命令会检查 `integrity_check`、核心数据表以及用户、题目、提交记录数量；验证失败时不要删除当前数据库，先保留备份并检查磁盘与 SQLite 锁状态。

### 安装每日备份

```bash
cd /opt/star-stack
./backup.sh --install-cron
```

### 恢复备份

恢复前先停止后端，并将时间戳替换为实际备份文件名：

```bash
cd /opt/star-stack
pm2 stop star-stack-api
gzip -cd /www/backup/starstack/starstack_YYYYMMDD_HHMMSS.db.gz > server/data/starstack.sqlite
node server/migrate.js
pm2 restart star-stack-api
```

## 5. 常用运维命令

```bash
# 服务状态和日志
pm2 status
pm2 logs star-stack-api --lines 50 --nostream

# 后端健康检查
curl -fsS http://127.0.0.1:5174/api/health
curl -fsS https://xingzhan.cc/api/health

# Nginx 检查与重载
nginx -t
systemctl reload nginx

# 数据库结构诊断
node server/diagnose.js
```

健康接口中的 `judge` 字段会返回当前评测 worker、等待队列和运行沙箱数量。`backup.healthy` 表示最近 26 小时内至少存在一份备份，但不会因此阻断 API 的基本健康状态；发现为 `false` 时应立即检查 cron 和备份目录。提交记录先以 `Queued` 写入数据库，再进入评测；服务重启时会自动恢复仍未结束的已发布题目提交，避免用户刷新页面后丢失状态。

健康接口同时返回 SQLite 完整性、数据库所在磁盘空间和最近备份状态。管理员后台“站点看板”会显示前端错误数量、磁盘可用空间和数据库完整性；会话、过期验证码、前端错误和过期审计记录由后端定期清理，消息仍按 90 天策略清理。

管理员后台的“站点看板”还会显示进程内存、评测/运行队列、数据库规模和最近备份状态。备份超过 26 小时未更新时会标记为“需检查”。`JUDGE_MEMORY_LIMIT_KB` 可在 65536～524288 之间调整评测内存上限，默认 262144（256MB）；编译和运行均经过沙箱，沙箱同时限制虚拟内存、CPU 时间、进程数、文件大小和网络访问。生产主机若不具备 namespace 能力，服务会拒绝执行用户代码。

压力测试只允许对本机服务执行：

```bash
PORT=5180 NODE_ENV=test node server/index.js
STRESS_REQUESTS=200 STRESS_CONCURRENCY=20 npm run stress -- health
STRESS_TOKEN='管理员Token' npm run stress -- admin
STRESS_ALLOW_JUDGE=YES STRESS_TOKEN='用户Token' STRESS_PROBLEM_ID=1 npm run stress -- judge
```

`judge` 模式会真实占用测试运行队列，默认拒绝执行；不要把压力脚本指向公网生产域名。

题目编辑会自动保存版本快照和审核状态历史。题目作者及管理员可以在编辑页查看版本并恢复；恢复后的内容仍会按权限进入草稿或对应审核状态。

## 6. 故障处理

### 页面打不开

```bash
pm2 status
curl -i http://127.0.0.1:5174/api/health
nginx -t
systemctl status nginx --no-pager
```

### 后端离线

```bash
pm2 logs star-stack-api --lines 100 --nostream
pm2 restart star-stack-api
```

### 更新后数据库报错

```bash
pm2 stop star-stack-api
./backup.sh
node server/migrate.js
pm2 restart star-stack-api
```

如果仍然失败，先从备份恢复，再分析迁移错误；不要直接删除数据库。

### 评测失败

```bash
g++ --version
python3 --version
java -version
pm2 logs star-stack-api --lines 100 --nostream
```

## 7. 发布前检查清单

- [ ] 本地 `npm run build`、`npm run lint`、`npm test -- --run` 全部通过
- [ ] 已执行 `npm run audit:deps`；无 Critical，剩余上游未修复条目已记录并确认不影响本次发布
- [ ] 已执行 `node server/diagnose.js` 和 SQLite `PRAGMA integrity_check`，数据库完整
- [ ] 已提交并推送到 `main`
- [ ] 更新前已备份数据库
- [ ] 已执行 `node server/migrate.js`
- [ ] `pm2 status` 显示 `star-stack-api` 为 `online`
- [ ] `nginx -t` 通过
- [ ] `https://xingzhan.cc/api/health` 返回 `{"ok":true}`
- [ ] 已在浏览器验证登录、题库、提交评测和管理后台
- [ ] Chrome CDP 已完成浅色/深色主题以及 375px、768px、1440px 视口对比度审计
- [ ] 已用键盘回归顶部菜单、通知、弹窗、登录注册、IDE 和管理员入口
