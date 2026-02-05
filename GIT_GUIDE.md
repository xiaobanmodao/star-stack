# Git 操作手册

## 基本配置

### 查看当前配置
```bash
git config --list
```

### 配置用户信息（首次使用）
```bash
git config --global user.name "xiaobanmodao"
git config --global user.email "3156757116@qq.com"
```

---

## 日常操作流程

### 1. 查看状态
```bash
# 查看当前工作区状态
git status

# 查看修改的具体内容
git diff
```

### 2. 提交代码到本地仓库

```bash
# 添加所有修改的文件
git add .

# 或者添加指定文件
git add 文件名

# 提交到本地仓库
git commit -m "提交说明"

# 示例
git commit -m "修复登录bug"
git commit -m "添加新功能：用户头像上传"
```

### 3. 推送到 GitHub（上传）

```bash
# 推送到远程仓库
git push

# 首次推送或指定分支
git push -u origin main
```

### 4. 从 GitHub 拉取更新（下载）

```bash
# 拉取并合并远程更新
git pull

# 或者分步操作
git fetch origin    # 获取远程更新
git merge origin/main  # 合并到本地
```

---

## 完整工作流程示例

### 场景1：修改代码后上传

```bash
# 1. 查看修改了什么
git status

# 2. 添加修改的文件
git add .

# 3. 提交到本地
git commit -m "更新了评测逻辑"

# 4. 推送到 GitHub
git push
```

### 场景2：开始工作前先拉取最新代码

```bash
# 1. 拉取最新代码
git pull

# 2. 开始修改代码...

# 3. 提交并推送
git add .
git commit -m "完成新功能"
git push
```

---

## 分支操作

### 查看分支
```bash
# 查看本地分支
git branch

# 查看所有分支（包括远程）
git branch -a
```

### 创建和切换分支
```bash
# 创建新分支
git branch 分支名

# 切换到分支
git checkout 分支名

# 创建并切换（推荐）
git checkout -b 新分支名

# 示例：创建开发分支
git checkout -b dev
```

### 合并分支
```bash
# 切换到主分支
git checkout main

# 合并其他分支到当前分支
git merge 分支名

# 示例：将 dev 分支合并到 main
git checkout main
git merge dev
```

### 删除分支
```bash
# 删除本地分支
git branch -d 分支名

# 强制删除
git branch -D 分支名

# 删除远程分支
git push origin --delete 分支名
```

---

## 查看历史记录

```bash
# 查看提交历史
git log

# 简洁模式
git log --oneline

# 查看最近 5 条
git log -5

# 图形化显示分支
git log --graph --oneline --all
```

---

## 撤销操作

### 撤销工作区修改（未 add）
```bash
# 撤销单个文件
git checkout -- 文件名

# 撤销所有修改
git checkout -- .
```

### 撤销暂存区（已 add 未 commit）
```bash
# 取消暂存
git reset HEAD 文件名

# 取消所有暂存
git reset HEAD .
```

### 撤销提交（已 commit 未 push）
```bash
# 撤销最后一次提交，保留修改
git reset --soft HEAD^

# 撤销最后一次提交，不保留修改
git reset --hard HEAD^

# 撤销最近 3 次提交
git reset --hard HEAD~3
```

### 撤销已推送的提交
```bash
# 创建一个新提交来撤销之前的提交
git revert HEAD

# 撤销指定提交
git revert 提交ID
```

---

## 远程仓库操作

### 查看远程仓库
```bash
# 查看远程仓库信息
git remote -v

# 查看详细信息
git remote show origin
```

### 修改远程仓库地址
```bash
# 修改远程仓库 URL
git remote set-url origin 新地址

# 示例
git remote set-url origin https://github.com/xiaobanmodao/star-stack.git
```

### 添加/删除远程仓库
```bash
# 添加远程仓库
git remote add origin 仓库地址

# 删除远程仓库
git remote remove origin
```

---

## 标签操作

### 创建标签
```bash
# 创建轻量标签
git tag v1.0.0

# 创建附注标签（推荐）
git tag -a v1.0.0 -m "版本 1.0.0 发布"

# 为历史提交打标签
git tag -a v0.9.0 提交ID -m "版本 0.9.0"
```

### 查看标签
```bash
# 查看所有标签
git tag

# 查看标签详情
git show v1.0.0
```

### 推送标签
```bash
# 推送单个标签
git push origin v1.0.0

# 推送所有标签
git push origin --tags
```

### 删除标签
```bash
# 删除本地标签
git tag -d v1.0.0

# 删除远程标签
git push origin --delete v1.0.0
```

---

## 常见问题解决

### 1. 推送被拒绝（远程有更新）
```bash
# 先拉取远程更新
git pull

# 如果有冲突，解决冲突后
git add .
git commit -m "解决冲突"

# 再推送
git push
```

### 2. 忘记添加 .gitignore
```bash
# 删除已跟踪的文件（但保留本地文件）
git rm --cached 文件名

# 删除整个目录
git rm -r --cached 目录名

# 示例：删除 node_modules
git rm -r --cached node_modules

# 然后提交
git add .gitignore
git commit -m "更新 .gitignore"
git push
```

### 3. 提交了敏感信息
```bash
# 修改最后一次提交
git commit --amend

# 如果已推送，需要强制推送（谨慎使用）
git push --force
```

### 4. 查看某个文件的修改历史
```bash
git log --follow 文件名

# 查看每次修改的具体内容
git log -p 文件名
```

---

## 快捷命令别名（可选）

```bash
# 设置常用命令别名
git config --global alias.st status
git config --global alias.co checkout
git config --global alias.br branch
git config --global alias.ci commit
git config --global alias.unstage 'reset HEAD --'
git config --global alias.last 'log -1 HEAD'

# 使用别名
git st      # 等同于 git status
git co main # 等同于 git checkout main
```

---

## 最常用的命令总结

```bash
# 每天必用
git status          # 查看状态
git add .           # 添加所有修改
git commit -m "说明"  # 提交
git push            # 推送到 GitHub
git pull            # 从 GitHub 拉取

# 经常使用
git log --oneline   # 查看历史
git diff            # 查看修改
git branch          # 查看分支
git checkout -b 分支名  # 创建并切换分支

# 偶尔使用
git reset --soft HEAD^  # 撤销提交
git merge 分支名         # 合并分支
git tag -a v1.0.0 -m "版本说明"  # 打标签
```

---

## 你的仓库信息

- **GitHub 用户名**: xiaobanmodao
- **仓库名**: star-stack
- **仓库地址**: https://github.com/xiaobanmodao/star-stack
- **远程仓库**: origin
- **主分支**: main

---

## 推荐工作流程

### 日常开发
1. `git pull` - 开始工作前先拉取最新代码
2. 修改代码
3. `git status` - 查看修改了什么
4. `git add .` - 添加修改
5. `git commit -m "说明"` - 提交
6. `git push` - 推送到 GitHub

### 功能开发
1. `git checkout -b feature-xxx` - 创建功能分支
2. 开发功能
3. `git add .` 和 `git commit -m "完成功能"`
4. `git checkout main` - 切换回主分支
5. `git merge feature-xxx` - 合并功能分支
6. `git push` - 推送到 GitHub
7. `git branch -d feature-xxx` - 删除功能分支

---

**提示**:
- 提交信息要清晰明了，说明做了什么修改
- 经常提交，每完成一个小功能就提交一次
- 推送前先拉取，避免冲突
- 重要操作前先备份或创建分支
