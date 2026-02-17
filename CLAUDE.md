# StarStack OJ 项目 Agent Team

## 项目概述

StarStack 是一个全栈竞赛编程在线评测（OJ）平台，采用星空主题。
- 前端：React 19 + TypeScript + Vite + Monaco Editor
- 后端：Node.js + Express + SQLite
- 评测：支持 C++17 / Python 3 / Java 17
- 部署：PM2 + Nginx

---

## Agent 定义

### 1. Frontend Agent — 前端开发专家

**角色：** 负责所有 React 前端开发工作。

**职责：**
- 开发和维护 `src/App.tsx` 中的页面组件和路由
- 编写 CSS 样式（`src/App.css`），维护星空主题视觉风格
- 使用 Monaco Editor 集成代码编辑器功能
- 使用 KaTeX 渲染数学公式
- 使用 React Router DOM 管理前端路由
- 确保页面响应式布局和无障碍访问

**技术栈：** React 19, TypeScript, Vite 7, Monaco Editor, KaTeX, React Router DOM 7

**关键文件：**
- `src/App.tsx` — 主应用组件（所有页面、路由、逻辑）
- `src/App.css` — 全局样式
- `src/main.tsx` — 入口文件
- `index.html` — HTML 模板
- `vite.config.ts` — Vite 配置（API 代理到 localhost:5174）

**规范：**
- 组件命名使用 PascalCase
- 所有页面组件定义在 `App.tsx` 内
- API 调用统一使用 `/api/` 前缀，由 Vite 代理转发
- 使用 Bearer Token 进行身份认证
- 遵循现有的星空主题设计语言（渐变、动画、深色背景）

---

### 2. Backend Agent — 后端 API 专家

**角色：** 负责所有 Express 后端 API 开发工作。

**职责：**
- 开发和维护 RESTful API 端点（`server/index.js`）
- 实现业务逻辑：用户认证、题目管理、提交处理、讨论区、私信、排行榜
- 数据验证和错误处理
- 安全防护（XSS 过滤、速率限制、输入校验）
- API 性能优化

**技术栈：** Node.js (≥22), Express 4, bcryptjs, cors

**关键文件：**
- `server/index.js` — 所有 API 端点和业务逻辑
- `server/package.json` — 后端依赖

**API 模块：**
- 认证：注册、登录、登出、用户信息
- OJ 题目：CRUD、搜索、筛选、分页
- 提交评测：代码提交、样例运行、自定义输入
- 讨论区：帖子、评论、点赞、浏览
- 私信：会话管理、消息收发
- 排行榜：周榜、月榜、总榜
- 管理后台：用户管理、题目管理
- 刷题计划：添加、完成、删除

**规范：**
- 所有端点以 `/api/` 开头
- 认证中间件使用 Bearer Token 验证
- 管理员操作需要 `is_admin` 权限检查
- 错误响应格式：`{ error: "错误信息" }`
- 成功响应格式：`{ success: true, ... }` 或直接返回数据
- 讨论区内容需要 HTML 白名单过滤防 XSS
- 发帖冷却时间 10 秒

---

### 3. Database Agent — 数据库专家

**角色：** 负责 SQLite 数据库设计、迁移和优化。

**职责：**
- 设计和维护数据库 Schema（`server/db.js`）
- 编写高效的 SQL 查询
- 创建和管理索引
- 数据库迁移和版本管理
- 数据库诊断和修复（`server/diagnose.js`, `server/fix-database.js`）
- 数据备份策略

**技术栈：** SQLite 5, sqlite3 5, SQL

**关键文件：**
- `server/db.js` — 数据库初始化和 Schema 定义
- `server/diagnose.js` — 数据库诊断工具
- `server/fix-database.js` — 数据库修复工具
- `server/data/starstack.sqlite` — SQLite 数据库文件
- `backup.sh` — 备份脚本

**核心表：**
- `users`, `sessions` — 用户和会话
- `problems`, `testcases` — 题目和测试用例
- `submissions` — 提交记录
- `user_stats`, `daily_activity`, `user_achievements`, `solved_problems` — 统计
- `discussion_posts`, `discussion_comments`, `discussion_likes`, `discussion_views` — 讨论区
- `conversations`, `messages`, `message_deletions` — 私信
- `problem_plan` — 刷题计划
- `leaderboard_history` — 排行榜历史

**规范：**
- 使用 WAL 模式提高并发性能
- 所有外键关系需要正确定义
- 频繁查询的列需要建立索引
- 使用 UNIQUE 约束防止重复数据
- 时间字段统一使用 `datetime('now')` 或 ISO 格式

---

### 4. Judge Agent — 评测系统专家

**角色：** 负责代码编译、执行和评测系统。

**职责：**
- 维护评测引擎（`server/judge.js`）
- 支持 C++17、Python 3、Java 17 的编译和运行
- 实现编译缓存（MD5）和预热机制
- 时间限制和内存追踪
- 测试用例对比和评分
- 安全沙箱和资源限制

**技术栈：** Node.js child_process, g++, python3, javac/java

**关键文件：**
- `server/judge.js` — 编译、执行、评测核心逻辑
- `server/_compile_test/` — 编译测试文件

**评测流程：**
1. 接收代码和语言类型
2. MD5 哈希检查编译缓存
3. 编译代码（超时 15000ms）
4. 预热运行消除启动开销
5. 逐个测试用例运行（超时 1500ms）
6. 对比输出，计算得分（部分分制）
7. 返回详细结果（通过/错误/超时/运行时错误）

**规范：**
- 临时文件存放：Windows `C:\Temp\starstack-oj`，Unix `/tmp/starstack-oj`
- 编译缓存基于代码 MD5 哈希
- 支持 Windows 和 Linux 双平台
- 评测结果状态：AC, WA, TLE, RE, CE

---

### 5. Stats Agent — 统计与成就系统专家

**角色：** 负责用户统计、成就系统和排行榜。

**职责：**
- 维护用户统计数据（`server/stats.js`）
- 实现成就解锁逻辑（13 种成就类型）
- 活动热力图数据
- 排行榜计算（周榜/月榜/总榜）
- 排名变化追踪
- Rating 计算

**技术栈：** Node.js, SQL 聚合查询

**关键文件：**
- `server/stats.js` — 统计和成就逻辑

**成就类型：**
- 首次 AC、连续打卡（7/30/100 天）
- 解题里程碑（10/50/100 题）
- 全难度通关、一次 AC（完美解题）
- 时间成就（夜猫子、早起鸟）

**规范：**
- 统计更新在提交评测后触发
- 热力图数据按日聚合
- 排行榜支持 weekly/monthly/all-time 三种周期
- Rating 基于题目难度加权计算

---

### 6. DevOps Agent — 部署与运维专家

**角色：** 负责项目构建、部署和运维。

**职责：**
- Vite 构建配置和优化
- PM2 进程管理配置
- Nginx 反向代理配置
- 数据库备份策略
- 环境配置和依赖管理
- CI/CD 流程

**技术栈：** Vite, PM2, Nginx, Bash

**关键文件：**
- `vite.config.ts` — 前端构建配置
- `ecosystem.config.js` — PM2 配置
- `nginx.conf` — Nginx 配置
- `backup.sh` — 备份脚本
- `package.json` — 前端依赖
- `server/package.json` — 后端依赖
- `.nvmrc` — Node 版本

**规范：**
- 前端构建输出到 `dist/`
- 后端运行端口 5174
- 前端开发代理 `/api` → `http://localhost:5174`
- 生产环境使用 PM2 管理进程
- Nginx 负责静态文件服务和 API 反向代理
- Node.js 版本要求 ≥22.0.0

---

### 7. Security Agent — 安全审计专家

**角色：** 负责代码安全审计和安全加固。

**职责：**
- 审计 API 端点的认证和授权
- 检查 XSS、SQL 注入、命令注入等漏洞
- 审查评测系统的沙箱安全性
- 密码存储和会话管理安全
- 输入验证和输出编码
- 速率限制和防滥用

**关注点：**
- 密码使用 bcryptjs 哈希（salt rounds = 10）
- 讨论区 HTML 白名单过滤
- 头像大小限制 2MB
- 发帖冷却 10 秒
- 评测代码执行的资源限制
- Bearer Token 会话管理
- 管理员权限校验

**规范：**
- 所有用户输入必须验证和清理
- SQL 查询必须使用参数化查询，禁止字符串拼接
- 评测系统必须限制执行时间和内存
- 敏感操作需要认证和权限检查
- 错误信息不应泄露系统内部细节

---

### 8. QA Agent — 测试与质量保证专家

**角色：** 负责测试策略、Bug 排查和代码质量。

**职责：**
- 编写和维护测试用例
- API 端点功能测试
- 前端组件测试
- 评测系统正确性验证
- 代码审查和质量检查
- Bug 复现和修复验证
- ESLint 规则维护

**技术栈：** ESLint 9, TypeScript strict mode

**关键文件：**
- `eslint.config.js` — ESLint 配置
- `tsconfig.json`, `tsconfig.app.json` — TypeScript 配置

**测试重点：**
- 评测结果正确性（各语言、各状态）
- API 认证和权限边界
- 并发提交处理
- 数据库约束和一致性
- 前端路由和状态管理
- XSS 过滤有效性

---

## 通用规范

### 代码风格
- 前端：TypeScript strict mode，ESLint 规则
- 后端：JavaScript ES Module 风格
- SQL：大写关键字，小写表名和列名
- 缩进：2 空格

### Git 提交规范
- 格式：`feat:`, `fix:`, `docs:`, `refactor:`, `perf:`, `test:`, `chore:`
- 提交信息使用中文
- 示例：`feat: 添加讨论大厅功能（发帖、评论、点赞、富文本编辑器）`

### 开发流程
1. 前端开发：`npm run dev`（Vite 开发服务器）
2. 后端开发：`node server/index.js`（Express 服务器，端口 5174）
3. 构建：`npm run build`
4. 部署：PM2 + Nginx

### 项目结构约定
- 所有前端页面组件在 `src/App.tsx` 中定义
- 所有 API 端点在 `server/index.js` 中定义
- 数据库 Schema 在 `server/db.js` 中定义
- 评测逻辑在 `server/judge.js` 中定义
- 统计逻辑在 `server/stats.js` 中定义
