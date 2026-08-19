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

生产服务由 Nginx 提供前端静态文件和 HTTPS，由 Nginx 将 `/api/` 转发到 PM2 管理的 Express 服务。判题依赖 C++17、Python 3 和 Java 17。

## 2. 首次部署

### 2.1 安装服务器依赖

```bash
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ca-certificates curl git rsync sqlite3 build-essential python3 openjdk-17-jdk \
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

pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd -u root --hp /root
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
# 预期：{"ok":true}
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
pm2 startOrRestart ecosystem.config.cjs --update-env
pm2 save
nginx -t && systemctl reload nginx

# 8. 验证
pm2 status
curl -fsS https://xingzhan.cc/api/health
```

如果本次只修改了前端，可以跳过数据库迁移和后端重启，但仍需执行 `npm run build` 和 `rsync`。

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
- [ ] 已提交并推送到 `main`
- [ ] 更新前已备份数据库
- [ ] 已执行 `node server/migrate.js`
- [ ] `pm2 status` 显示 `star-stack-api` 为 `online`
- [ ] `nginx -t` 通过
- [ ] `https://xingzhan.cc/api/health` 返回 `{"ok":true}`
- [ ] 已在浏览器验证登录、题库、提交评测和管理后台
