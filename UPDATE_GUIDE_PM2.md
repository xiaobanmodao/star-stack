# StarStack 更新指南（PM2 部署）

## 📋 目录
1. [日常更新流程](#日常更新流程)
2. [零停机更新](#零停机更新)
3. [回滚操作](#回滚操作)
4. [常见更新场景](#常见更新场景)
5. [注意事项](#注意事项)

---

## 🔄 日常更新流程

### 标准更新步骤（推荐）

```bash
# 1. 连接到服务器
ssh user@server

# 2. 进入项目目录
cd /opt/star-stack

# 3. 备份数据库（重要！）
./backup.sh

# 4. 拉取最新代码
git pull

# 5. 安装依赖（如果有更新）
npm install --legacy-peer-deps
cd server && npm install --production && cd ..

# 6. 构建前端
npm run build

# 7. 重启后端
pm2 restart star-stack-api

# 8. 重载 Nginx（如果配置有变化）
sudo nginx -s reload

# 9. 查看日志确认启动成功
pm2 logs star-stack-api --lines 50

# 10. 验证服务
curl http://localhost:3000/api/health
curl -I http://localhost
```

---

## ⚡ 零停机更新（推荐生产环境）

PM2 支持零停机重启，用户无感知更新。

```bash
# 1. 备份数据
cd /opt/star-stack
./backup.sh

# 2. 拉取最新代码
git pull

# 3. 安装依赖
npm install --legacy-peer-deps
cd server && npm install --production && cd ..

# 4. 构建前端
npm run build

# 5. 零停机重启后端（PM2 会自动处理）

const PORT = process.env.PORT || 3000
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`)
})


pm2 reload starstack-backend

# 6. 重载 Nginx
sudo nginx -s reload

# 7. 验证
pm2 status
curl http://localhost:3000/api/health
```

**说明：**
- `pm2 reload` 会逐个重启进程，保证服务不中断
- 前端是静态文件，构建后自动生效
- Nginx reload 不会中断现有连接

---

## ⏮️ 回滚操作

如果更新后出现问题，可以快速回滚。

### 方法一：使用 Git 回滚

```bash
# 1. 查看提交历史
cd /opt/star-stack
git log --oneline -10

# 2. 回滚到指定版本
git checkout <commit-hash>

# 3. 重新安装依赖
npm install --legacy-peer-deps
cd server && npm install --production && cd ..

# 4. 重新构建前端
npm run build

# 5. 重启后端
pm2 restart star-stack-api

# 6. 验证
pm2 status
curl http://localhost:5174/api/health
```

### 方法二：恢复数据库备份

```bash
# 1. 停止服务
pm2 stop star-stack-api

# 2. 查看可用备份
ls -lh backups/

# 3. 恢复备份
cp backups/starstack_YYYYMMDD_HHMMSS.sqlite server/data/starstack.sqlite

# 4. 重启服务
pm2 restart star-stack-api

# 5. 验证
pm2 logs star-stack-api --lines 20
```

---

## 📝 常见更新场景

### 场景 1：只更新前端代码

```bash
cd /opt/star-stack

# 1. 备份（可选）
./backup.sh

# 2. 拉取代码
git pull

# 3. 安装前端依赖（如果有更新）
npm install --legacy-peer-deps

# 4. 重新构建前端
npm run build

# 5. 验证（前端是静态文件，构建后自动生效）
curl -I http://localhost
```

### 场景 2：只更新后端代码

```bash
cd /opt/star-stack

# 1. 备份数据库（重要！）
./backup.sh

# 2. 拉取代码
git pull

# 3. 安装后端依赖（如果有更新）
cd server
npm install --production
cd ..

# 4. 零停机重启后端
pm2 reload star-stack-api

# 5. 验证
pm2 logs star-stack-api --lines 20
curl http://localhost:5174/api/health
```

### 场景 3：更新依赖包

```bash
cd /opt/star-stack

# 1. 备份
./backup.sh

# 2. 拉取代码（包含新的 package.json）
git pull

# 3. 安装前端依赖
npm install --legacy-peer-deps

# 4. 安装后端依赖
cd server
npm install --production
cd ..

# 5. 构建前端
npm run build

# 6. 重启后端
pm2 restart star-stack-api

# 7. 验证
pm2 status
```

### 场景 4：更新 Nginx 配置

```bash
cd /opt/star-stack

# 1. 备份
./backup.sh

# 2. 更新配置文件
sudo nano /etc/nginx/sites-available/starstack

# 3. 测试配置
sudo nginx -t

# 4. 重载 Nginx
sudo nginx -s reload

# 5. 验证
curl -I http://localhost
```

### 场景 5：数据库结构变更

```bash
cd /opt/star-stack

# 1. 备份数据库（非常重要！）
./backup.sh

# 2. 停止后端服务
pm2 stop star-stack-api

# 3. 拉取代码
git pull

# 4. 如果需要重置数据库（会清空数据）
# rm server/data/starstack.sqlite

# 5. 安装依赖
cd server && npm install --production && cd ..

# 6. 启动服务（会自动初始化数据库）
pm2 start star-stack-api

# 7. 查看日志确认数据库初始化
pm2 logs star-stack-api --lines 50
```

---

## 🔍 更新后检查清单

每次更新后，请检查以下项目：

```bash
# 1. 检查 PM2 状态
pm2 status
# 应该看到 star-stack-api 状态为 online

# 2. 检查后端健康
curl http://localhost:5174/api/health
# 应该返回: {"ok":true}

# 3. 检查前端
curl -I http://localhost
# 应该返回: HTTP/1.1 200 OK

# 4. 检查 Nginx 状态
sudo systemctl status nginx

# 5. 查看后端日志
pm2 logs star-stack-api --lines 50

# 6. 查看 Nginx 日志
sudo tail -f /var/log/nginx/starstack-error.log

# 7. 测试功能
# - 访问前端页面
# - 登录系统
# - 提交代码测试评测功能
```

---

## ⚠️ 注意事项

### 更新前必须做

1. ✅ **备份数据库**
   ```bash
   ./backup.sh
   ```

2. ✅ **查看更新内容**
   ```bash
   git log --oneline -5
   git diff HEAD~1
   ```

3. ✅ **在低峰期更新**
   - 建议在凌晨或用户较少时更新

4. ✅ **检查磁盘空间**
   ```bash
   df -h
   ```

### 更新时避免

1. ❌ 不要在高峰期更新
2. ❌ 不要跳过备份步骤
3. ❌ 不要直接修改 node_modules
4. ❌ 不要在更新时修改数据库

### 更新后必须做

1. ✅ 验证服务状态
2. ✅ 测试核心功能
3. ✅ 查看错误日志
4. ✅ 监控系统资源

---

## 🚨 紧急回滚

如果更新后出现严重问题，立即回滚：

```bash
# 快速回滚三步走
cd /opt/star-stack

# 1. 回滚代码
git checkout HEAD~1

# 2. 重新构建
npm install --legacy-peer-deps
cd server && npm install --production && cd ..
npm run build

# 3. 重启服务
pm2 restart star-stack-api

# 4. 如果数据库有问题，恢复备份
pm2 stop star-stack-api
cp backups/starstack_LATEST.sqlite server/data/starstack.sqlite
pm2 restart star-stack-api
```

---

## 📊 更新频率建议

- **安全更新**: 立即更新
- **功能更新**: 每周或每两周
- **依赖更新**: 每月
- **系统更新**: 每月

---

## 🔧 自动化更新（可选）

创建自动更新脚本：

```bash
cat > /opt/star-stack/auto-update.sh << 'SCRIPT'
#!/bin/bash
set -e

echo "开始自动更新..."

# 1. 备份
./backup.sh

# 2. 拉取代码
git pull

# 3. 检查是否有更新
if [ $? -eq 0 ]; then
    echo "发现更新，开始部署..."
    
    # 4. 安装依赖
    npm install --legacy-peer-deps
    cd server && npm install --production && cd ..
    
    # 5. 构建前端
    npm run build
    
    # 6. 零停机重启后端
    pm2 reload star-stack-api
    
    # 7. 重载 Nginx
    sudo nginx -s reload
    
    # 8. 验证
    sleep 5
    if curl -s http://localhost:5174/api/health | grep -q "ok"; then
        echo "更新成功！"
    else
        echo "更新失败，开始回滚..."
        git checkout HEAD~1
        npm install --legacy-peer-deps
        cd server && npm install --production && cd ..
        npm run build
        pm2 restart star-stack-api
    fi
else
    echo "没有更新"
fi
SCRIPT

chmod +x /opt/star-stack/auto-update.sh
```

---

## 📞 遇到问题？

### 常见问题

**Q: 更新后无法访问？**
```bash
# 检查 PM2 状态
pm2 status

# 查看日志
pm2 logs star-stack-api

# 重启服务
pm2 restart star-stack-api
```

**Q: 前端没有更新？**
```bash
# 清除浏览器缓存
# 或者强制刷新（Ctrl + F5）

# 检查构建产物
ls -lh dist/

# 重新构建
npm run build
```

**Q: 数据库错误？**
```bash
# 恢复备份
pm2 stop star-stack-api
cp backups/starstack_LATEST.sqlite server/data/starstack.sqlite
pm2 restart star-stack-api
```

**Q: PM2 进程崩溃？**
```bash
# 查看日志
pm2 logs star-stack-api --err

# 重启进程
pm2 restart star-stack-api

# 如果持续崩溃，检查代码错误
pm2 logs star-stack-api --lines 100
```

**Q: Nginx 错误？**
```bash
# 测试配置
sudo nginx -t

# 查看错误日志
sudo tail -f /var/log/nginx/error.log

# 重启 Nginx
sudo systemctl restart nginx
```

### 获取帮助

1. 查看 PM2 日志: `pm2 logs star-stack-api`
2. 查看 Nginx 日志: `sudo tail -f /var/log/nginx/starstack-error.log`
3. 查看运维手册: `OPERATIONS.md`
4. 运行健康检查: `./healthcheck.sh`

---

## 📋 快速命令参考

```bash
# 标准更新
cd /opt/star-stack && ./backup.sh && git pull && npm install --legacy-peer-deps && cd server && npm install --production && cd .. && npm run build && pm2 restart star-stack-api

# 零停机更新
cd /opt/star-stack && ./backup.sh && git pull && npm install --legacy-peer-deps && cd server && npm install --production && cd .. && npm run build && pm2 reload star-stack-api && sudo nginx -s reload

# 快速回滚
cd /opt/star-stack && git checkout HEAD~1 && npm install --legacy-peer-deps && cd server && npm install --production && cd .. && npm run build && pm2 restart star-stack-api

# 验证服务
pm2 status && curl http://localhost:5174/api/health && curl -I http://localhost

# 查看日志
pm2 logs star-stack-api --lines 50
```

---

## 🎯 PM2 常用命令

```bash
# 查看状态
pm2 status

# 查看日志
pm2 logs star-stack-api
pm2 logs star-stack-api --lines 100
pm2 logs star-stack-api --err

# 重启服务
pm2 restart star-stack-api      # 普通重启
pm2 reload star-stack-api        # 零停机重启

# 停止/启动
pm2 stop star-stack-api
pm2 start star-stack-api

# 监控
pm2 monit

# 清空日志
pm2 flush

# 保存配置
pm2 save

# 查看详细信息
pm2 show star-stack-api
```

---

**记住：更新前一定要备份！** 🛡️
