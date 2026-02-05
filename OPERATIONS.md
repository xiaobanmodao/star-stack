# StarStack 运维手册

## 日常运维

### 查看服务状态
```bash
# 查看容器状态
docker-compose ps

# 查看资源使用
docker stats

# 查看日志
docker-compose logs -f
docker-compose logs -f backend
docker-compose logs -f frontend
```

### 重启服务
```bash
# 重启所有服务
docker-compose restart

# 重启单个服务
docker-compose restart backend
docker-compose restart frontend

# 完全重启（停止后重新启动）
docker-compose down
docker-compose up -d
```

### 查看日志
```bash
# 实时查看所有日志
docker-compose logs -f

# 查看最近 100 行
docker-compose logs --tail=100

# 查看特定时间的日志
docker-compose logs --since 2024-01-01T00:00:00

# 保存日志到文件
docker-compose logs > logs/docker-$(date +%Y%m%d).log
```

## 备份与恢复

### 手动备份
```bash
# 备份数据库
cp server/data/starstack.sqlite backups/starstack_$(date +%Y%m%d_%H%M%S).sqlite

# 备份整个数据目录
tar -czf backups/data_$(date +%Y%m%d).tar.gz server/data/

# 备份到远程服务器
scp server/data/starstack.sqlite user@backup-server:/backups/
```

### 恢复备份
```bash
# 1. 停止服务
docker-compose down

# 2. 恢复数据库
cp backups/starstack_YYYYMMDD_HHMMSS.sqlite server/data/starstack.sqlite

# 3. 重启服务
docker-compose up -d

# 4. 验证
curl http://localhost:5174/api/health
```

### 自动备份设置
```bash
# 编辑 crontab
crontab -e

# 添加以下行（每天凌晨 2 点备份）
0 2 * * * /opt/star-stack/backup.sh >> /opt/star-stack/logs/backup.log 2>&1

# 查看备份任务
crontab -l

# 查看备份日志
tail -f logs/backup.log
```

## 更新部署

### 更新代码
```bash
cd /opt/star-stack

# 1. 备份当前数据
./backup.sh

# 2. 拉取最新代码
git pull

# 3. 查看变更
git log -5 --oneline

# 4. 重新构建
docker-compose build

# 5. 滚动更新（零停机）
docker-compose up -d --no-deps --build backend
docker-compose up -d --no-deps --build frontend

# 6. 验证
docker-compose ps
curl http://localhost:5174/api/health
```

### 回滚版本
```bash
# 1. 查看提交历史
git log --oneline

# 2. 回滚到指定版本
git checkout <commit-hash>

# 3. 停止服务
docker-compose down

# 4. 重新构建
docker-compose build --no-cache

# 5. 启动服务
docker-compose up -d

# 6. 恢复数据库（如需要）
cp backups/starstack_YYYYMMDD_HHMMSS.sqlite server/data/starstack.sqlite
docker-compose restart backend
```

## 性能优化

### 清理 Docker 资源
```bash
# 清理未使用的镜像
docker image prune -a

# 清理未使用的容器
docker container prune

# 清理未使用的卷
docker volume prune

# 清理所有未使用的资源
docker system prune -a --volumes
```

### 数据库优化
```bash
# 进入后端容器
docker-compose exec backend sh

# 连接数据库
sqlite3 /app/data/starstack.sqlite

# 执行优化
VACUUM;
ANALYZE;
.quit
```

### 日志清理
```bash
# 清理旧日志（保留最近 7 天）
find logs/ -name "*.log" -mtime +7 -delete

# 清理 Docker 日志
truncate -s 0 $(docker inspect --format='{{.LogPath}}' starstack-backend)
truncate -s 0 $(docker inspect --format='{{.LogPath}}' starstack-frontend)
```

## 监控告警

### 健康检查
```bash
# 手动健康检查
./healthcheck.sh

# 查看健康检查日志
tail -f logs/health.log

# 测试后端
curl http://localhost:5174/api/health

# 测试前端
curl -I http://localhost:3000
```

### 资源监控
```bash
# 实时监控容器资源
docker stats

# 查看磁盘使用
df -h

# 查看内存使用
free -h

# 查看 CPU 使用
top
```

### 设置告警（示例）
```bash
# 创建告警脚本
cat > alert.sh << 'ALERT'
#!/bin/bash
# 检查服务状态，失败时发送告警

if ! curl -s http://localhost:5174/api/health | grep -q "ok"; then
    # 发送邮件告警
    echo "Backend service is down!" | mail -s "StarStack Alert" admin@example.com
    
    # 或发送钉钉通知
    # curl -X POST "https://oapi.dingtalk.com/robot/send?access_token=YOUR_TOKEN" \
    #   -H 'Content-Type: application/json' \
    #   -d '{"msgtype":"text","text":{"content":"StarStack 后端服务异常！"}}'
fi
ALERT

chmod +x alert.sh

# 添加到 crontab（每 5 分钟检查一次）
(crontab -l; echo "*/5 * * * * /opt/star-stack/alert.sh") | crontab -
```

## 安全维护

### 更新系统
```bash
# Ubuntu/Debian
sudo apt update
sudo apt upgrade -y

# CentOS/RHEL
sudo yum update -y
```

### 更新 Docker
```bash
# 检查版本
docker --version

# 更新 Docker
curl -fsSL https://get.docker.com | sh
```

### 查看访问日志
```bash
# Nginx 访问日志
sudo tail -f /var/log/nginx/starstack-access.log

# Nginx 错误日志
sudo tail -f /var/log/nginx/starstack-error.log

# 分析访问量
cat /var/log/nginx/starstack-access.log | awk '{print $1}' | sort | uniq -c | sort -rn | head -10
```

### 防火墙管理
```bash
# 查看防火墙状态
sudo ufw status

# 开放端口
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# 关闭端口
sudo ufw delete allow 3000/tcp
sudo ufw delete allow 5174/tcp

# 重载防火墙
sudo ufw reload
```

## 故障处理

### 服务无法启动
```bash
# 1. 查看详细日志
docker-compose logs backend
docker-compose logs frontend

# 2. 检查端口占用
sudo netstat -tlnp | grep -E '3000|5174'

# 3. 检查磁盘空间
df -h

# 4. 检查内存
free -h

# 5. 重新构建
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### 数据库损坏
```bash
# 1. 停止服务
docker-compose down

# 2. 备份损坏的数据库
cp server/data/starstack.sqlite server/data/starstack.sqlite.corrupted

# 3. 尝试修复
sqlite3 server/data/starstack.sqlite "PRAGMA integrity_check;"

# 4. 如果无法修复，恢复备份
cp backups/starstack_LATEST.sqlite server/data/starstack.sqlite

# 5. 重启服务
docker-compose up -d
```

### 内存不足
```bash
# 1. 查看内存使用
free -h
docker stats

# 2. 重启服务释放内存
docker-compose restart

# 3. 清理 Docker 缓存
docker system prune -a

# 4. 如果持续不足，考虑升级服务器配置
```

### 磁盘空间不足
```bash
# 1. 查看磁盘使用
df -h
du -sh /opt/star-stack/*

# 2. 清理旧备份
find backups/ -name "*.sqlite" -mtime +30 -delete

# 3. 清理日志
find logs/ -name "*.log" -mtime +7 -delete

# 4. 清理 Docker
docker system prune -a --volumes
```

## 常见问题

### Q: 如何修改端口？
```bash
# 编辑 docker-compose.yml
nano docker-compose.yml

# 修改 ports 配置
# 例如将 3000 改为 8080
ports:
  - "8080:80"

# 重启服务
docker-compose down
docker-compose up -d
```

### Q: 如何查看数据库内容？
```bash
# 进入后端容器
docker-compose exec backend sh

# 连接数据库
sqlite3 /app/data/starstack.sqlite

# 查看表
.tables

# 查看用户
SELECT * FROM users;

# 退出
.quit
```

### Q: 如何重置管理员密码？
```bash
# 进入后端容器
docker-compose exec backend sh

# 连接数据库
sqlite3 /app/data/starstack.sqlite

# 重置密码（密码为 newpassword123）
UPDATE users SET password_hash = '$2a$10$...' WHERE id = 'admin';

# 或者删除管理员，重启后会自动创建
DELETE FROM users WHERE id = 'admin';
.quit

# 重启后端
docker-compose restart backend
```

### Q: 如何迁移到新服务器？
```bash
# 在旧服务器
cd /opt/star-stack
./backup.sh
tar -czf starstack-backup.tar.gz server/data/ backups/

# 传输到新服务器
scp starstack-backup.tar.gz user@new-server:/opt/

# 在新服务器
cd /opt
tar -xzf starstack-backup.tar.gz
git clone <repo> star-stack
cp -r data/ star-stack/server/
cd star-stack
docker-compose up -d
```

## 性能基准

### 正常指标
- CPU 使用率: < 50%
- 内存使用: < 2GB
- 磁盘 I/O: < 100MB/s
- 响应时间: < 500ms
- 并发用户: 100+

### 监控命令
```bash
# CPU 和内存
docker stats --no-stream

# 磁盘 I/O
iostat -x 1

# 网络流量
iftop

# 响应时间
curl -w "@curl-format.txt" -o /dev/null -s http://localhost:5174/api/health
```

## 联系支持

如遇到无法解决的问题，请提供：
1. 错误日志（docker-compose logs）
2. 系统信息（uname -a）
3. Docker 版本（docker --version）
4. 复现步骤

---

**保持系统更新，定期备份数据！** 🛡️
