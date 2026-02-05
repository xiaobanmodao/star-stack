# 从常规上传迁移到 Git 管理指南

## 📋 当前情况

- ✅ 本地代码已推送到 GitHub：https://github.com/xiaobanmodao/star-stack
- ⚠️ 服务器上的代码是通过 FTP/SFTP 等方式上传的，没有 Git
- 🎯 目标：将服务器切换到使用 Git 管理代码

---

## 🚀 迁移步骤

### 方案1：全新部署（推荐，最简单）

适合：服务器上的代码和本地基本一致，用户数据不多或已备份

#### 步骤：

**1. 备份服务器上的重要数据**

```bash
# SSH 登录到服务器
ssh 用户名@服务器IP

# 备份数据库
cd /path/to/current/star-stack
cp -r server/data server/data.backup.$(date +%Y%m%d_%H%M%S)

# 备份整个项目（可选）
cd ..
tar -czf star-stack.backup.$(date +%Y%m%d_%H%M%S).tar.gz star-stack/
```

**2. 停止当前服务**

```bash
# 如果使用 pm2
pm2 stop starstack
# 或
pm2 stop all

# 如果使用其他方式，停止对应的服务
```

**3. 重命名旧项目目录**

```bash
cd /path/to/
mv star-stack star-stack.old
```

**4. 从 GitHub 克隆项目**

```bash
# 克隆仓库
git clone https://github.com/xiaobanmodao/star-stack.git
cd star-stack

# 查看克隆结果
ls -la
```

**5. 恢复数据库文件**

```bash
# 复制备份的数据库到新项目
cp ../star-stack.old/server/data/*.sqlite server/data/
cp ../star-stack.old/server/data/*.json server/data/

# 或者从备份目录恢复
cp ../star-stack.old/server/data.backup.YYYYMMDD_HHMMSS/* server/data/

# 检查文件
ls -lh server/data/
```

**6. 安装依赖**

```bash
# 安装前端依赖
npm install

# 安装后端依赖
cd server
npm install
cd ..
```

**7. 配置 Git 用户信息（首次使用）**

```bash
git config --global user.name "xiaobanmodao"
git config --global user.email "3156757116@qq.com"
```

**8. 启动服务**

```bash
# 使用 pm2 启动
pm2 start ecosystem.config.js

# 或者如果之前有配置
pm2 start starstack

# 查看状态
pm2 status
pm2 logs starstack
```

**9. 验证功能**

```bash
# 检查服务是否正常
curl http://localhost:端口号

# 访问网站测试
# - 登录功能
# - 查看用户数据是否完整
# - 测试代码提交
```

**10. 清理旧文件（确认无误后）**

```bash
# 确认新系统运行正常后，删除旧文件
rm -rf /path/to/star-stack.old
```

---

### 方案2：原地转换（保留所有文件）

适合：服务器上有很多自定义配置或不想重新部署

#### 步骤：

**1. 备份当前项目**

```bash
# SSH 登录服务器
ssh 用户名@服务器IP

# 进入项目目录
cd /path/to/star-stack

# 备份数据库
cp -r server/data server/data.backup.$(date +%Y%m%d_%H%M%S)

# 备份整个项目
cd ..
tar -czf star-stack.backup.$(date +%Y%m%d_%H%M%S).tar.gz star-stack/
cd star-stack
```

**2. 初始化 Git 仓库**

```bash
# 初始化 Git
git init

# 配置用户信息
git config user.name "xiaobanmodao"
git config user.email "3156757116@qq.com"
```

**3. 关联远程仓库**

```bash
# 添加远程仓库
git remote add origin https://github.com/xiaobanmodao/star-stack.git

# 查看远程仓库
git remote -v
```

**4. 拉取远程代码**

```bash
# 获取远程分支信息
git fetch origin

# 查看本地和远程的差异
git diff main origin/main

# 重置到远程版本（会保留未跟踪的文件，如数据库）
git reset --hard origin/main

# 设置跟踪分支
git branch --set-upstream-to=origin/main main
```

**5. 检查数据库文件**

```bash
# 确认数据库文件存在且未被跟踪
ls -lh server/data/
git status

# 应该看到数据库文件显示为 "Untracked files"
# 这是正常的，因为它们在 .gitignore 中
```

**6. 重新安装依赖**

```bash
# 安装依赖
npm install
cd server && npm install && cd ..
```

**7. 重启服务**

```bash
pm2 restart starstack
# 或
pm2 restart all

# 查看日志
pm2 logs starstack
```

---

## 🔐 SSH 密钥配置（推荐，避免每次输入密码）

### 在服务器上生成 SSH 密钥

```bash
# 1. 生成 SSH 密钥
ssh-keygen -t ed25519 -C "3156757116@qq.com"

# 按提示操作：
# - 直接回车使用默认路径
# - 可以设置密码或直接回车跳过

# 2. 查看公钥
cat ~/.ssh/id_ed25519.pub

# 3. 复制公钥内容
```

### 添加到 GitHub

1. 访问 https://github.com/settings/keys
2. 点击 "New SSH key"
3. 标题填写：`StarStack Server`
4. 粘贴公钥内容
5. 点击 "Add SSH key"

### 修改远程仓库地址为 SSH

```bash
# 查看当前远程地址
git remote -v

# 修改为 SSH 地址
git remote set-url origin git@github.com:xiaobanmodao/star-stack.git

# 验证
git remote -v

# 测试连接
ssh -T git@github.com
# 应该看到：Hi xiaobanmodao! You've successfully authenticated...
```

---

## 📝 迁移后的日常工作流程

### 本地开发 → 推送到 GitHub

```bash
# 在本地电脑上
cd C:\Users\胡书源\Desktop\star-stack

# 修改代码...

# 提交并推送
git add .
git commit -m "修改说明"
git push
```

### 服务器更新代码

```bash
# SSH 登录服务器
ssh 用户名@服务器IP

# 进入项目目录
cd /path/to/star-stack

# 拉取最新代码
git pull

# 如果有依赖更新
npm install
cd server && npm install && cd ..

# 重启服务
pm2 restart starstack

# 查看日志确认正常
pm2 logs starstack --lines 20
```

---

## ⚠️ 常见问题

### 问题1：git pull 提示 "Please commit your changes or stash them"

**原因：** 服务器上有本地修改

**解决：**
```bash
# 方案A：暂存本地修改
git stash
git pull
git stash pop

# 方案B：放弃本地修改（谨慎使用）
git reset --hard
git pull

# 方案C：查看具体是什么文件被修改
git status
git diff
# 如果是配置文件，可以单独处理
```

### 问题2：git pull 提示需要输入用户名密码

**原因：** 使用 HTTPS 方式克隆，每次都需要认证

**解决：**
```bash
# 方案A：使用 SSH（推荐）
git remote set-url origin git@github.com:xiaobanmodao/star-stack.git

# 方案B：保存 HTTPS 凭据
git config --global credential.helper store
# 下次输入一次后会记住
```

### 问题3：服务器上没有安装 Git

**解决：**
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install git

# CentOS/RHEL
sudo yum install git

# 验证安装
git --version
```

### 问题4：权限问题

```bash
# 如果遇到权限错误
sudo chown -R 你的用户名:你的用户名 /path/to/star-stack

# 或者使用当前用户
sudo chown -R $USER:$USER /path/to/star-stack
```

---

## 🎯 迁移检查清单

完成迁移后，检查以下项目：

- [ ] 服务器上已安装 Git
- [ ] 项目目录已初始化为 Git 仓库
- [ ] 已关联到 GitHub 远程仓库
- [ ] 数据库文件存在且完整
- [ ] 用户数据没有丢失
- [ ] 服务正常运行
- [ ] 可以成功执行 `git pull`
- [ ] 可以成功执行 `git status`
- [ ] 网站功能正常（登录、提交等）
- [ ] PM2 进程正常
- [ ] 日志没有错误

---

## 📊 对比：迁移前后

### 迁移前（FTP/SFTP 上传）

```
本地修改代码
    ↓
使用 FTP 工具上传文件
    ↓
手动重启服务器服务
    ↓
测试功能
```

**缺点：**
- 需要手动选择上传哪些文件
- 容易遗漏文件
- 无法追踪历史版本
- 多人协作困难

### 迁移后（Git 管理）

```
本地修改代码
    ↓
git add . && git commit -m "说明" && git push
    ↓
SSH 登录服务器
    ↓
git pull && pm2 restart starstack
    ↓
完成
```

**优点：**
- 自动同步所有修改
- 版本控制，可以回滚
- 多人协作方便
- 更新快速准确

---

## 🚀 快速命令参考

### 首次迁移（方案1）

```bash
# 服务器上执行
cd /path/to/
mv star-stack star-stack.old
git clone https://github.com/xiaobanmodao/star-stack.git
cd star-stack
cp ../star-stack.old/server/data/*.sqlite server/data/
npm install && cd server && npm install && cd ..
pm2 restart starstack
```

### 日常更新

```bash
# 服务器上执行
cd /path/to/star-stack
git pull
pm2 restart starstack
```

### 安全更新（带备份）

```bash
# 服务器上执行
cd /path/to/star-stack
cp server/data/starstack.sqlite server/data/starstack.sqlite.backup.$(date +%Y%m%d_%H%M%S)
git pull
npm install && cd server && npm install && cd ..
pm2 restart starstack
pm2 logs starstack --lines 20
```

---

## 💡 建议

1. **首次迁移选择方案1**（全新部署），更简单可靠
2. **配置 SSH 密钥**，避免每次输入密码
3. **迁移前做好备份**，特别是数据库文件
4. **在低峰期进行迁移**，减少对用户的影响
5. **迁移后充分测试**，确保所有功能正常

---

## 📞 需要帮助？

如果在迁移过程中遇到问题，可以：

1. 查看错误信息
2. 检查日志：`pm2 logs starstack`
3. 查看 Git 状态：`git status`
4. 恢复备份：`cp server/data.backup.YYYYMMDD_HHMMSS/* server/data/`

**记住：迁移前备份，遇到问题可以随时恢复！**
