# StarStack Ubuntu 服务器部署指南

## 系统要求
- Ubuntu 20.04 LTS 或更高版本
- 至少 2GB RAM
- 至少 10GB 可用磁盘空间
- Root 或 sudo 权限

## 一、安装必要的环境

### 1. 更新系统
```bash

sudo apt update
sudo apt upgrade -y
```

### 2. 安装 Node.js（推荐 18.x 或 20.x LTS）
```bash
# 安装 Node.js 20.x LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 验证安装
node --version
npm --version
```

### 3. 安装判题所需的编译器和运行环境

#### 安装 C++ 编译器（g++）
```bash
sudo apt install -y build-essential g++

# 验证安装
g++ --version
```

#### 安装 Python 3
```bash
sudo apt install -y python3 python3-pip

# 验证安装
python3 --version
```

#### 安装 Java 17
```bash
sudo apt install -y openjdk-17-jdk

# 验证安装
java -version
javac -version
```

### 4. 安装 Git（如果需要从仓库拉取代码）
```bash
sudo apt install -y git
```

### 5. 安装 PM2（进程管理器，用于后台运行）
```bash
sudo npm install -g pm2
```

### 6. 安装 Nginx（可选，用于反向代理）
```bash
sudo apt install -y nginx
```

## 二、部署项目

### 1. 上传项目文件到服务器
```bash
# 方式1：使用 scp 上传
scp -r "C:\Users\胡书源\Desktop\star-stack"
  root@38.22.234.176:/home/user/

# 方式2：使用 git clone
cd /home/user
git clone <your-repo-url> star-stack
```

### 2. 进入项目目录
```bash
cd /home/user/star-stack
```

### 3. 安装前端依赖
```bash
npm install
```

### 4. 安装后端依赖
```bash
cd server
npm install
cd ..
```

### 5. 构建前端生产版本
```bash
npm run build
```
构建完成后，生产文件会在 `dist` 目录中。

## 三、配置后端

### 1. 修改后端端口（可选）
编辑 `server/index.js`，找到最后的监听端口部分：
```javascript
const PORT = process.env.PORT || 5174
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
```

可以改为：
```javascript
const PORT = process.env.PORT || 3000
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`)
})
```

### 2. 配置环境变量（可选）
创建 `.env` 文件（如果需要自定义管理员账号）：
```bash
cd /home/user/star-stack
nano .env
```

添加以下内容：
```
ADMIN_ID=admin
ADMIN_NAME=管理员
ADMIN_PASSWORD=your_secure_password
PORT=3000
```

### 3. 创建数据目录
```bash
mkdir -p server/data
chmod 755 server/data
```

## 四、使用 PM2 启动后端服务

### 1. 启动后端
```bash
cd /home/user/star-stack
pm2 start server/index.js --name starstack-backend
```

### 2. 查看运行状态
```bash
pm2 status
pm2 logs starstack-backend
```

### 3. 设置开机自启
```bash
pm2 startup
pm2 save
```

### 4. 常用 PM2 命令
```bash
pm2 restart starstack-backend  # 重启
pm2 stop starstack-backend     # 停止
pm2 delete starstack-backend   # 删除
pm2 logs starstack-backend     # 查看日志
```

## 五、配置 Nginx 反向代理

### 1. 创建 Nginx 配置文件
```bash
sudo nano /etc/nginx/sites-available/starstack
```

### 2. 添加以下配置
```nginx
server {
    listen 80;
    server_name 38.22.234.176;  # 替换为你的域名或服务器IP

    # 前端静态文件
    location / {
        root /home/user/star-stack/dist;
        try_files $uri $uri/ /index.html;
        index index.html;
    }

    # API 反向代理到后端
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # 静态资源缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        root /home/user/star-stack/dist;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

### 3. 启用配置
```bash
sudo ln -s /etc/nginx/sites-available/starstack /etc/nginx/sites-enabled/
sudo nginx -t  # 测试配置
sudo systemctl restart nginx
```

### 4. 配置防火墙
```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## 六、配置 HTTPS（可选但推荐）

### 1. 安装 Certbot
```bash
sudo apt install -y certbot python3-certbot-nginx
```

### 2. 获取 SSL 证书
```bash
sudo certbot --nginx -d www.xingzhan.cc
```

### 3. 自动续期
```bash
sudo certbot renew --dry-run
```

## 七、验证部署

### 1. 检查后端是否运行
```bash
curl http://localhost:3000/api/health
# 应该返回: {"ok":true}
```

### 2. 检查前端是否可访问
在浏览器中访问：
- `http://your-domain.com` 或 `http://your-server-ip`

### 3. 测试判题功能
- 登录系统（默认管理员：admin / admin123）
- 提交一道题目测试 C++/Python/Java 是否正常运行

## 八、目录结构（部署后）
```
/home/user/star-stack/
├── dist/                    # 前端构建产物
├── server/
│   ├── data/               # SQLite 数据库文件
│   │   └── starstack.sqlite
│   ├── index.js            # 后端主文件
│   ├── judge.js            # 判题逻辑
│   ├── db.js               # 数据库初始化
│   └── stats.js            # 统计功能
├── src/                    # 前端源码
├── package.json
└── .env                    # 环境变量（可选）
```

## 九、常见问题排查

### 1. 后端无法启动
```bash
# 查看日志
pm2 logs starstack-backend

# 检查端口占用
sudo netstat -tulpn | grep 3000

# 检查数据库权限
ls -la server/data/
```

### 2. 判题失败
```bash
# 检查编译器是否安装
g++ --version
python3 --version
java -version

# 检查临时目录权限
ls -la /tmp/starstack-oj/
```

### 3. Nginx 502 错误
```bash
# 检查后端是否运行
pm2 status

# 检查 Nginx 配置
sudo nginx -t

# 查看 Nginx 错误日志
sudo tail -f /var/log/nginx/error.log
```

### 4. 前端无法访问 API
- 检查 Nginx 配置中的 `proxy_pass` 地址是否正确
- 检查后端端口是否与 Nginx 配置一致
- 检查防火墙是否开放端口

## 十、性能优化建议

### 1. 启用 Gzip 压缩
在 Nginx 配置中添加：
```nginx
gzip on;
gzip_vary on;
gzip_min_length 1024;
gzip_types text/plain text/css text/xml text/javascript application/javascript application/json;
```

### 2. 配置 PM2 集群模式（多核 CPU）
```bash
pm2 start server/index.js --name starstack-backend -i max
```

### 3. 定期备份数据库
```bash
# 创建备份脚本
nano /home/user/backup.sh
```

添加内容：
```bash
#!/bin/bash
BACKUP_DIR="/home/user/backups"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR
cp /home/user/star-stack/server/data/starstack.sqlite $BACKUP_DIR/starstack_$DATE.sqlite
# 保留最近 7 天的备份
find $BACKUP_DIR -name "starstack_*.sqlite" -mtime +7 -delete
```

设置定时任务：
```bash
chmod +x /home/user/backup.sh
crontab -e
# 添加：每天凌晨 2 点备份
0 2 * * * /home/user/backup.sh
```

## 十一、更新部署

### 1. 更新代码
```bash
cd /home/user/star-stack
git pull  # 如果使用 git
# 或重新上传文件
```

### 2. 重新构建前端
```bash
npm install  # 如果有新依赖
npm run build
```

### 3. 更新后端依赖
```bash
cd server
npm install
cd ..
```

### 4. 重启后端
```bash
pm2 restart starstack-backend
```

### 5. 重启 Nginx（如果修改了配置）
```bash
sudo systemctl restart nginx
```

## 十二、安全建议

1. **修改默认管理员密码**
   - 首次登录后立即修改 admin 账号密码

2. **配置防火墙**
   ```bash
   sudo ufw allow 22/tcp   # SSH
   sudo ufw allow 80/tcp   # HTTP
   sudo ufw allow 443/tcp  # HTTPS
   sudo ufw enable
   ```

3. **定期更新系统**
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```

4. **限制数据库文件权限**
   ```bash
   chmod 600 server/data/starstack.sqlite
   ```

5. **使用 HTTPS**
   - 强烈建议配置 SSL 证书

6. **配置日志轮转**
   ```bash
   pm2 install pm2-logrotate
   pm2 set pm2-logrotate:max_size 10M
   pm2 set pm2-logrotate:retain 7
   ```

## 联系与支持

如有问题，请检查：
1. PM2 日志：`pm2 logs starstack-backend`
2. Nginx 日志：`sudo tail -f /var/log/nginx/error.log`
3. 系统日志：`sudo journalctl -xe`
