# StarStack 部署文档总览

## 📚 文档导航

本项目提供完整的部署和运维文档，确保您能够**零错误**地部署和维护系统。

### 核心文档

1. **[DEPLOYMENT.md](./DEPLOYMENT.md)** - 快速部署指南
   - Docker 部署（推荐）
   - 传统部署（备选）
   - 安全加固
   - 常用命令

2. **[OPERATIONS.md](./OPERATIONS.md)** - 运维手册
   - 日常运维
   - 备份恢复
   - 性能优化
   - 故障处理

3. **[CODE_QUALITY_REPORT.md](./CODE_QUALITY_REPORT.md)** - 代码质量报告
   - 优化总结
   - 性能提升
   - 安全改进

### 自动化脚本

1. **deploy-check.sh** - 部署前环境检查
   ```bash
   bash deploy-check.sh
   ```

2. **deploy.sh** - 一键部署脚本
   ```bash
   bash deploy.sh
   ```

3. **backup.sh** - 数据库备份脚本
   ```bash
   ./backup.sh
   ```

4. **healthcheck.sh** - 健康检查脚本
   ```bash
   ./healthcheck.sh
   ```

---

## 🚀 快速开始

### 最简单的部署方式（3 步）

```bash
# 1. 运行环境检查
bash deploy-check.sh

# 2. 一键部署
bash deploy.sh

# 3. 访问系统
# 浏览器打开: http://服务器IP:3000
# 默认账号: admin / admin123
```

### 手动部署（5 步）

```bash
# 1. 创建目录
mkdir -p server/data logs backups

# 2. 构建镜像
docker-compose build --no-cache

# 3. 启动服务
docker-compose up -d

# 4. 查看日志
docker-compose logs -f

# 5. 验证部署
curl http://localhost:5174/api/health
```

---

## 📋 部署检查清单

### 部署前
- [ ] 服务器满足最低配置（2核4GB，20GB硬盘）
- [ ] 已安装 Docker 和 Docker Compose
- [ ] 端口 3000 和 5174 未被占用
- [ ] 防火墙已配置
- [ ] 域名已解析（如使用）

### 部署后
- [ ] `docker-compose ps` 显示两个容器都是 Up (healthy)
- [ ] `curl http://localhost:5174/api/health` 返回 `{"ok":true}`
- [ ] 浏览器可以访问前端
- [ ] 可以登录系统（admin/admin123）
- [ ] 可以提交代码并评测
- [ ] 日志正常输出
- [ ] 自动启动已配置
- [ ] 备份脚本已设置
- [ ] **默认密码已修改**（重要！）
- [ ] SSL 证书已配置（推荐）

---

## 🔧 常用命令速查

### 服务管理
```bash
# 启动
docker-compose up -d

# 停止
docker-compose down

# 重启
docker-compose restart

# 查看状态
docker-compose ps

# 查看日志
docker-compose logs -f
```

### 更新部署
```bash
git pull
./backup.sh
docker-compose build
docker-compose up -d --no-deps --build backend
docker-compose up -d --no-deps --build frontend
```

### 备份恢复
```bash
# 备份
./backup.sh

# 恢复
docker-compose down
cp backups/starstack_YYYYMMDD_HHMMSS.sqlite server/data/starstack.sqlite
docker-compose up -d
```

### 故障排查
```bash
# 查看日志
docker-compose logs backend
docker-compose logs frontend

# 检查端口
sudo netstat -tlnp | grep -E '3000|5174'

# 重新构建
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

---

## 🔒 安全建议

### 必须做的
1. ✅ **立即修改默认密码**
2. ✅ 配置 SSL 证书（Let's Encrypt 免费）
3. ✅ 配置防火墙（只开放必要端口）
4. ✅ 设置自动备份（每天）
5. ✅ 定期更新系统和 Docker

### 推荐做的
1. 🔐 使用强密码策略
2. 🔐 限制 SSH 访问（密钥登录，改变端口）
3. 🔐 配置访问日志监控
4. 🔐 设置健康检查告警
5. 🔐 定期检查安全更新

---

## 📊 系统要求

### 最低配置
- **CPU**: 2 核
- **内存**: 4GB
- **硬盘**: 20GB SSD
- **系统**: Ubuntu 20.04+ / CentOS 7+
- **软件**: Docker 20.10+, Docker Compose 2.0+

### 推荐配置
- **CPU**: 4 核
- **内存**: 8GB
- **硬盘**: 50GB SSD
- **系统**: Ubuntu 22.04 LTS
- **网络**: 10Mbps+ 带宽

### 性能基准
- **并发用户**: 100+
- **响应时间**: < 500ms
- **代码评测**: < 2s (简单题目)
- **CPU 使用**: < 50%
- **内存使用**: < 2GB

---

## 🆘 故障处理流程

### 1. 服务无法访问
```bash
# 检查容器状态
docker-compose ps

# 查看日志
docker-compose logs -f

# 重启服务
docker-compose restart
```

### 2. 数据库错误
```bash
# 检查数据库文件
ls -lh server/data/starstack.sqlite

# 恢复备份
cp backups/starstack_LATEST.sqlite server/data/starstack.sqlite
docker-compose restart backend
```

### 3. 编译器错误
```bash
# 检查编译器
docker-compose exec backend g++ --version
docker-compose exec backend python3 --version
docker-compose exec backend java --version

# 重新构建
docker-compose build --no-cache backend
docker-compose up -d backend
```

### 4. 内存不足
```bash
# 查看资源使用
docker stats

# 清理 Docker
docker system prune -a

# 重启服务
docker-compose restart
```

---

## 📞 获取帮助

### 查看文档
- 部署指南: [DEPLOYMENT.md](./DEPLOYMENT.md)
- 运维手册: [OPERATIONS.md](./OPERATIONS.md)
- 代码质量: [CODE_QUALITY_REPORT.md](./CODE_QUALITY_REPORT.md)

### 运行诊断
```bash
# 环境检查
bash deploy-check.sh

# 健康检查
./healthcheck.sh

# 查看日志
docker-compose logs -f
```

### 联系支持
如遇到无法解决的问题，请提供：
1. 错误日志（`docker-compose logs`）
2. 系统信息（`uname -a`）
3. Docker 版本（`docker --version`）
4. 复现步骤

---

## 🎯 部署成功标志

当您看到以下所有指标都正常时，说明部署成功：

✅ `docker-compose ps` 显示两个容器都是 **Up (healthy)**  
✅ `curl http://localhost:5174/api/health` 返回 **{"ok":true}**  
✅ 浏览器可以访问前端页面  
✅ 可以使用 admin/admin123 登录  
✅ 可以提交代码并成功评测  
✅ 日志中没有错误信息  

---

## 📈 后续优化

部署成功后，建议进行以下优化：

1. **配置 Nginx 反向代理** - 提供更好的性能和安全性
2. **配置 SSL 证书** - 启用 HTTPS 加密传输
3. **设置监控告警** - 及时发现和处理问题
4. **优化数据库** - 定期执行 VACUUM 和 ANALYZE
5. **配置 CDN** - 加速静态资源访问（可选）

---

## 🎉 恭喜！

如果您已经完成部署，恭喜您成功搭建了 StarStack 在线评测系统！

**访问地址**: http://服务器IP:3000  
**默认账号**: admin / admin123  
**重要提醒**: 请立即修改默认密码！

祝您使用愉快！🚀
