# StarStack

星栈（StarStack）是一个星空风格的算法测评平台，包含账号系统、题库/OJ、评测与记录展示，以及管理员用户管理功能。

## 功能概览
- 账号系统：注册/登录/修改资料
- OJ 评测：题库筛选、题目详情、在线 IDE、提交评测与记录
- 后台管理：仅管理员可见（用户管理）
- 评测优化：预热机制消除时间误差、独立路由防止重复评测
- 视觉效果：火箭发射动画、烟花效果（带重力）、大字结果展示

## 运行环境
- Node.js（前端：Vite + React；后端：Node + Express）
- 语言运行环境（判题/运行用）：C++17、Python3、Java17（Windows 下需安装对应编译器/运行时）

## 本地运行
前端：
```bash
npm install
npm run dev
```

后端：
```bash
node server/index.js
```

默认后端端口：5174

前端默认端口（Vite）：5173
API 使用相对路径 `/api/...`，后端启用了 CORS，前后端分开启动即可。

## 默认管理员账号
初始化数据库时会自动创建管理员（如果不存在）：
- 账号：`admin`
- 密码：`admin123`

## 主要路由
- `/` 首页
- `/auth` 登录/注册
- `/games` 游戏占位
- `/account` 账号中心
- `/admin` 后台管理（仅管理员）
- `/oj` 题库列表
- `/oj/:id` 题目详情
- `/oj/judge` 提交评测页
- `/oj/judge/:id` 查看提交评测（独立路由，刷新不重复评测）
- `/oj/records/:id` 某题提交记录
- `/oj/submissions` 我的提交

## 主要 API（摘要）
账号
- `POST /api/register`
- `POST /api/login`
- `POST /api/logout`
- `GET /api/me`
- `PATCH /api/me/name`
- `POST /api/me/password`

OJ
- `GET /api/oj/problems`
- `GET /api/oj/problems/:id`
- `POST /api/oj/submissions`（真实判题）
- `GET /api/oj/submissions`（当前用户提交）
- `GET /api/oj/submissions/:id`（单条提交）
- `GET /api/oj/submissions/all`（某题所有提交，含过滤）
- `GET /api/oj/submissions/latest`（当前用户该题最近提交）
- `POST /api/oj/run-sample`
- `POST /api/oj/run-custom`

后台（用户管理）
- `GET /api/admin/users`
- `POST /api/admin/users`
- `POST /api/admin/users/:id/promote`
- `POST /api/admin/users/:id/demote`
- `POST /api/admin/users/:id/reset-password`
- `POST /api/admin/users/:id/ban`
- `DELETE /api/admin/users/:id`

## 目录结构（关键）
- `src/App.tsx` 核心前端逻辑（页面、路由、IDE、评测页）
- `src/App.css` 全站样式（星空、布局、OJ、动画、后台）
- `server/index.js` API 主入口
- `server/judge.js` 判题与运行逻辑（C++/Java/Python，含预热机制）
- `server/db.js` 数据库初始化

## 最近优化（2026-02-02）

### 1. 判题时间优化
**问题：** 第一个测试点时间异常偏高（包含进程启动开销）

**解决方案：**
- 在 `judgeSubmission` 和 `runSample` 函数中添加预热机制
- 编译完成后先运行一次空输入，丢弃这次的时间
- 消除进程启动、缓存加载等开销
- 使时间统计更准确，反映代码真实执行时间

**修改文件：** `server/judge.js`

### 2. 评测路由优化
**问题：** 刷新页面会重复评测，浪费资源

**解决方案：**
- 每次提交后自动跳转到独立路由 `/oj/judge/:submissionId`
- 使用 `replace: true` 替换历史记录
- 刷新页面时直接加载已有提交记录，不会重复评测
- 优化 useEffect 依赖，先检查 submissionId 再检查新提交

**修改文件：** `src/App.tsx` (OjJudgePage 组件)

### 3. 评测结果展示优化
**优化内容：**
- ✨ 成功时显示绚丽的烟花效果（带重力下落）
- ✨ 烟花粒子先向外爆炸，然后受重力影响向下坠落
- ✨ 成功时显示大大的绿色 **ACCEPTED** 文字（48px，发光效果）
- ✨ 失败时显示大大的红色 **WRONG** 文字（48px，发光效果）
- ✨ 文字带有弹出动画和阴影效果

**修改文件：**
- `src/App.tsx` (结果文字显示)
- `src/App.css` (烟花重力动画、文字样式)

## 常见问题
- 运行样例/自定义测试失败：确认后端已启动（`node server/index.js`）且账号已登录。
- 运行/判题报错：确认 C++/Python/Java 环境已安装并在 PATH 中可用。
- 第一个测试点时间过长：已通过预热机制修复，确保使用最新版本代码。
- 刷新页面重复评测：已通过路由优化修复，提交后会跳转到独立路由。
