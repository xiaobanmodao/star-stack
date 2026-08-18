# 服务器更新安全指南

## ✅ 问题已解决

数据库文件已从 Git 中移除，现在可以安全地在服务器上拉取代码而不会覆盖用户数据。旧数据库升级时还必须运行完整迁移脚本，补齐新版本新增的表、字段和索引。

---

## 📋 已排除的文件（不会被 git pull 覆盖）

以下文件已添加到 `.gitignore`，不会被 Git 管理：

```
server/data/*.sqlite          # SQLite 数据库
server/data/*.sqlite-shm      # SQLite 共享内存
server/data/*.sqlite-wal      # SQLite 预写日志
server/data/db.json           # JSON 数据库
```

这些文件在服务器上会被保留，`git pull` 不会影响它们。

---

## 🚀 服务器更新流程

### 标准更新流程

```bash
# 1. 进入项目目录
cd /home/user/star-stack

# 2. 停止后端，确保 SQLite 的 WAL 数据已经落盘
pm2 stop star-stack-api

# 3. 备份数据库（强烈建议保留）
cp server/data/starstack.sqlite server/data/starstack.sqlite.backup.$(date +%Y%m%d_%H%M%S)

# 4. 拉取最新代码
git pull --ff-only origin main

# 5. 安装依赖（如果 package.json 有更新）
npm install
cd server && npm install && cd ..

# 6. 补齐旧数据库的新表、新字段和索引（幂等，不删除用户数据）
node server/migrate.js

# 7. 构建前端
npm run build

# 8. 如果 Nginx 使用独立静态目录，同步最新构建产物
sudo rsync -a --delete dist/ /var/www/starstack-dist/

# 9. 重启后端并重载 Nginx
pm2 restart star-stack-api
sudo nginx -t && sudo nginx -s reload
```

### 首次部署到新服务器

```bash
# 1. 克隆仓库
git clone https://github.com/xiaobanmodao/star-stack.git
cd star-stack

# 2. 安装依赖
npm install
cd server && npm install && cd ..

# 3. 创建数据目录（如果不存在）
mkdir -p server/data

# 4. 初始化数据库
# 数据库会在首次运行时自动创建；已有数据库升级请运行：
node server/migrate.js

# 5. 启动服务
pm2 start ecosystem.config.js
```

---

## 🔒 数据安全最佳实践

### 1. 定期备份数据库

**手动备份：**
```bash
# 创建带时间戳的备份
cp server/data/starstack.sqlite server/data/starstack.sqlite.backup.$(date +%Y%m%d_%H%M%S)
```

**自动备份脚本（推荐）：**

创建 `backup-db.sh`：
```bash
#!/bin/bash
# 数据库备份脚本

BACKUP_DIR="/path/to/backups"
DB_FILE="/path/to/star-stack/server/data/starstack.sqlite"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# 创建备份目录
mkdir -p $BACKUP_DIR

# 备份数据库
cp $DB_FILE $BACKUP_DIR/starstack_$TIMESTAMP.sqlite

# 保留最近 30 天的备份
find $BACKUP_DIR -name "starstack_*.sqlite" -mtime +30 -delete

echo "备份完成: starstack_$TIMESTAMP.sqlite"
```

**设置定时任务（每天凌晨 2 点备份）：**
```bash
# 编辑 crontab
crontab -e

# 添加以下行
0 2 * * * /path/to/backup-db.sh >> /var/log/starstack-backup.log 2>&1
```

### 2. 更新前检查

```bash
# 查看将要拉取的更新
git fetch
git log HEAD..origin/main --oneline

# 查看具体改动
git diff HEAD..origin/main

# 确认没有数据库文件被修改后再拉取
git pull
```

### 3. 使用项目自带的备份脚本

项目中已有 `backup.sh`，可以直接使用：

```bash
# 查看备份脚本
cat backup.sh

# 执行备份
bash backup.sh
```

---

## ⚠️ 注意事项

### 什么情况下数据会丢失？

❌ **危险操作（会丢失数据）：**
```bash
git reset --hard origin/main  # 强制重置，会覆盖所有本地文件
git checkout -- .             # 撤销所有本地修改
git clean -fd                 # 删除未跟踪的文件
```

✅ **安全操作（不会丢失数据）：**
```bash
git pull                      # 拉取更新（数据库文件已排除）
git fetch                     # 获取远程更新
git status                    # 查看状态
```

### 如果不小心覆盖了数据库

```bash
# 1. 立即停止服务
pm2 stop starstack

# 2. 恢复最近的备份
cp server/data/starstack.sqlite.backup.YYYYMMDD_HHMMSS server/data/starstack.sqlite

# 3. 重启服务
pm2 restart starstack
```

---

## 🔄 更新场景示例

### 场景1：修复 Bug 后更新服务器

**本地操作：**
```bash
# 修复 bug
git add .
git commit -m "fix: 修复登录验证问题"
git push
```

**服务器操作：**
```bash
# 备份数据库
cp server/data/starstack.sqlite server/data/starstack.sqlite.backup.$(date +%Y%m%d_%H%M%S)

# 拉取更新
git pull

const PORT = process.env.PORT || 3000
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`)
})


pm2 reload starstack-backend

# 6. 重载 Nginx
sudo nginx -s reload
```

### 场景2：添加新功能后更新

**本地操作：**
```bash
git add .
git commit -m "feat: 添加用户排行榜功能"
git push
```

**服务器操作：**
```bash
# 备份
cp server/data/starstack.sqlite server/data/starstack.sqlite.backup.$(date +%Y%m%d_%H%M%S)

# 拉取更新
git pull

# 安装新依赖（如果有）
npm install
cd server && npm install && cd ..

# 重启服务
pm2 restart starstack
```

### 场景3：数据库结构变更（需要迁移）

如果更新涉及数据库结构变更，需要额外步骤：

```bash
# 1. 备份数据库
cp server/data/starstack.sqlite server/data/starstack.sqlite.backup.$(date +%Y%m%d_%H%M%S)

# 2. 拉取更新
git pull

# 3. 运行数据库迁移脚本（如果有）
node server/migrate.js

# 4. 重启服务
pm2 restart starstack

# 5. 验证功能正常
# 测试登录、提交等核心功能
```

---

## 📊 监控和验证

### 更新后检查清单

```bash
# 1. 检查服务状态
pm2 status

# 2. 查看日志
pm2 logs starstack --lines 50

# 3. 检查数据库文件
ls -lh server/data/

# 4. 测试核心功能
# - 访问网站
# - 测试登录
# - 测试代码提交
# - 检查用户数据是否完整
```

### 常用监控命令

```bash
# 实时查看日志
pm2 logs starstack

# 查看进程信息
pm2 info starstack

# 查看资源占用
pm2 monit

# 重启服务
pm2 restart starstack

# 停止服务
pm2 stop starstack

# 启动服务
pm2 start starstack
```

---

## 🛠️ 故障排查

### 问题1：git pull 提示冲突

```bash
# 查看冲突文件
git status

# 如果是代码文件冲突
git stash              # 暂存本地修改
git pull               # 拉取更新
git stash pop          # 恢复本地修改
# 手动解决冲突

# 如果确定要放弃本地修改
git reset --hard origin/main  # ⚠️ 谨慎使用
```

### 问题2：更新后服务无法启动

```bash
# 1. 查看错误日志
pm2 logs starstack --err

# 2. 检查依赖是否安装
npm install
cd server && npm install && cd ..

# 3. 检查配置文件
cat ecosystem.config.js

# 4. 尝试手动启动查看详细错误
cd server
node index.js
```

### 问题3：数据库损坏

```bash
# 1. 停止服务
pm2 stop starstack

# 2. 检查数据库完整性
sqlite3 server/data/starstack.sqlite "PRAGMA integrity_check;"

# 3. 如果损坏，恢复备份
cp server/data/starstack.sqlite.backup.YYYYMMDD_HHMMSS server/data/starstack.sqlite

# 4. 重启服务
pm2 restart starstack
```

---

## 📝 快速参考

### 日常更新（最常用）

```bash
cd /path/to/star-stack
git pull
pm2 restart starstack
```

### 安全更新（推荐）

```bash
cd /path/to/star-stack
cp server/data/starstack.sqlite server/data/starstack.sqlite.backup.$(date +%Y%m%d_%H%M%S)
git pull
npm install
cd server && npm install && cd ..
pm2 restart starstack
pm2 logs starstack --lines 20
```

### 紧急回滚

```bash
# 回滚代码
git reset --hard HEAD^
pm2 restart starstack

# 恢复数据库（如果需要）
cp server/data/starstack.sqlite.backup.YYYYMMDD_HHMMSS server/data/starstack.sqlite
pm2 restart starstack
```

---

## ✅ 总结

现在你可以安全地在服务器上使用 `git pull` 了：

1. ✅ 数据库文件已从 Git 中排除
2. ✅ `git pull` 不会覆盖用户数据
3. ✅ 本地数据库文件会被保留
4. ✅ 建议每次更新前备份数据库

**记住：更新前备份，更新后验证！**
