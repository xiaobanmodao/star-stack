# 登录后无法加载题目 - 故障排查指南

## 问题描述

- **症状**: 未登录时可以正常查看题目和提交记录，登录后点击题目或提交记录一直显示"加载中..."
- **原因**: 服务器数据库缺少 `score` 字段，导致查询失败

## 快速修复步骤

### 步骤 1: 上传诊断工具到服务器

将 `diagnose.js` 文件上传到服务器的 `server/` 目录下。

### 步骤 2: 在服务器上运行诊断

```bash
# 进入项目目录
cd /path/to/star-stack/server

# 运行诊断
node diagnose.js
```

诊断工具会检查：
- ✓ submissions 表是否有 score 字段
- ✓ 数据库索引是否完整
- ✓ sessions 和 problems 表数据
- ✓ 关键查询是否能正常执行

### 步骤 3: 运行修复程序

如果诊断发现问题，运行修复：

```bash
node diagnose.js --fix
```

修复程序会：
- ✓ 添加缺失的 score 字段
- ✓ 创建必要的数据库索引
- ✓ 验证修复结果

### 步骤 4: 重启后端服务

```bash
pm2 restart star-stack-api

# 查看日志确认启动成功
pm2 logs star-stack-api --lines 50
```

### 步骤 5: 测试

1. 清除浏览器缓存
2. 重新登录
3. 尝试打开题目详情页

## 如果问题仍然存在

### 检查后端日志

```bash
# 实时查看日志
pm2 logs star-stack-api

# 查看错误日志
cat logs/api-error.log
```

### 检查 Nginx 配置

确保 Nginx 正确代理 API 请求：

```nginx
location /api {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_cache_bypass $http_upgrade;
}
```

重启 Nginx：
```bash
sudo nginx -t
sudo systemctl restart nginx
```

### 检查端口和进程

```bash
# 检查后端服务是否运行
pm2 list

# 检查端口是否监听
netstat -tlnp | grep 3000

# 或使用 ss 命令
ss -tlnp | grep 3000
```

### 浏览器调试

1. 打开浏览器开发者工具 (F12)
2. 切换到 Network (网络) 标签
3. 登录后尝试打开题目
4. 查看 `/api/oj/problems/:id` 请求：
   - 状态码是什么？(200, 404, 500?)
   - 响应内容是什么？
   - 请求头中是否有 Authorization?

### 手动测试 API

```bash
# 测试未登录的请求
curl http://localhost:3000/api/oj/problems/1

# 测试登录的请求（替换 YOUR_TOKEN）
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3000/api/oj/problems/1
```

## 常见问题

### Q1: 诊断工具报错 "Cannot find module 'sqlite'"

**解决方案**:
```bash
cd server
npm install
```

### Q2: 修复后仍然无法加载

**可能原因**:
1. 后端服务没有重启
2. 浏览器缓存了旧的错误响应
3. Nginx 配置问题
4. 数据库文件权限问题

**解决方案**:
```bash
# 完全重启服务
pm2 delete star-stack-api
pm2 start ecosystem.config.js

# 检查数据库文件权限
ls -la server/data/oj.sqlite
chmod 644 server/data/oj.sqlite
```

### Q3: 本地可以运行但服务器不行

**检查清单**:
- [ ] 代码是否已推送到 Git 仓库
- [ ] 服务器是否已拉取最新代码
- [ ] 前端是否重新构建 (`npm run build`)
- [ ] 后端依赖是否已安装
- [ ] 数据库是否已更新
- [ ] Nginx 配置是否正确

## 预防措施

### 1. 添加数据库迁移检查

在 `server/db.js` 中已经有自动迁移代码，确保每次启动都会检查：

```javascript
// 检查并添加 score 字段
if (submissionColumns.length > 0 && !submissionNames.includes('score')) {
  await db.exec(`ALTER TABLE submissions ADD COLUMN score INTEGER DEFAULT 0;`)
}
```

### 2. 添加错误处理

在 API 路由中添加 try-catch：

```javascript
app.get('/api/oj/problems/:id', async (req, res) => {
  try {
    // ... 现有代码
  } catch (err) {
    console.error('Error loading problem:', err)
    return res.status(500).json({ message: '服务器错误' })
  }
})
```

### 3. 添加健康检查端点

```javascript
app.get('/api/health', async (req, res) => {
  try {
    const db = await getDb()
    await db.get('SELECT 1')
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message })
  }
})
```

## 联系支持

如果以上步骤都无法解决问题，请提供：
1. 诊断工具的完整输出
2. 后端日志 (`pm2 logs star-stack-api`)
3. 浏览器控制台的错误信息
4. 网络请求的详细信息（状态码、响应内容）
