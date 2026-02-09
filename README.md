# StarStack

星栈（StarStack）是一个星空风格的算法测评平台，包含账号系统、题库/OJ、评测与记录展示，以及管理员用户管理功能。

## 功能概览
- 账号系统：注册/登录/修改资料
- OJ 评测：题库筛选、题目详情、在线 IDE、提交评测与记录
- 讨论大厅：发帖、楼中楼评论、点赞、富文本编辑器、关联题目
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
- `/discussions` 讨论列表
- `/discussions/create` 发起讨论
- `/discussions/:id` 帖子详情
- `/discussions/:id/edit` 编辑帖子

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

讨论
- `GET /api/discussions`
- `GET /api/discussions/:id`
- `POST /api/discussions`
- `PUT /api/discussions/:id`
- `DELETE /api/discussions/:id`
- `POST /api/discussions/:id/comments`
- `DELETE /api/discussions/comments/:id`
- `POST /api/discussions/like`

## 目录结构（关键）
- `src/App.tsx` 核心前端逻辑（页面、路由、IDE、评测页）
- `src/App.css` 全站样式（星空、布局、OJ、动画、后台）
- `server/index.js` API 主入口
- `server/judge.js` 判题与运行逻辑（C++/Java/Python，含预热机制）
- `server/db.js` 数据库初始化

## 更新日志

### 2026-02-09 - 讨论大厅功能

#### 1. 讨论大厅（Discussion Hall）
**功能：** 全站讨论系统，支持发帖、评论、点赞

**核心特性：**
- 帖子列表：搜索、按最新/最热排序、分页
- 帖子可选关联某道题目
- 楼中楼嵌套回复（帖子 → 评论 → 回复）
- 帖子和评论的点赞/取消点赞
- 基于 contentEditable 的轻量富文本编辑器（粗体、斜体、代码、代码块、链接、列表）
- 作者或管理员可编辑/删除帖子和评论

**安全措施：**
- HTML 白名单过滤防 XSS（仅允许 p, br, strong, em, code, pre, a, ul, ol, li 等安全标签）
- 同一用户 10 秒内不能重复发帖
- 内容长度限制：标题 ≤200 字符，帖子 ≤50000 字符，评论 ≤10000 字符

**浏览量统计：**
- 基于唯一用户计数，同一用户多次打开不重复计数
- 使用 `discussion_views` 表记录用户浏览记录

**数据库新增表：**
- `discussion_posts` — 帖子表
- `discussion_comments` — 评论表（支持楼中楼）
- `discussion_likes` — 点赞表
- `discussion_views` — 浏览记录表（唯一用户计数）

**新增 API：**
- `GET /api/discussions` — 帖子列表（分页、排序、搜索）
- `GET /api/discussions/:id` — 帖子详情 + 评论树
- `POST /api/discussions` — 创建帖子
- `PUT /api/discussions/:id` — 编辑帖子
- `DELETE /api/discussions/:id` — 删除帖子
- `POST /api/discussions/:id/comments` — 发表评论/回复
- `DELETE /api/discussions/comments/:id` — 删除评论
- `POST /api/discussions/like` — 点赞/取消点赞

**新增路由：**
- `/discussions` — 讨论列表
- `/discussions/create` — 发起讨论
- `/discussions/:id` — 帖子详情
- `/discussions/:id/edit` — 编辑帖子

**UI 优化：**
- 讨论页面覆盖整个可用空间，深空主题风格
- 用户头像显示在帖子列表、帖子详情、评论区的用户名左侧
- 无头像用户显示首字母渐变色圆形占位符

**修改文件：**
- `server/db.js` — 新增 4 张表及索引
- `server/index.js` — 新增 8 个 API 路由、HTML 过滤、频率限制
- `src/App.tsx` — 新增类型定义、4 个页面组件、富文本编辑器、路由、侧边栏导航
- `src/App.css` — 新增讨论相关全部样式

---

### 2026-02-05 - 分数系统与搜索增强

#### 1. 分数系统实现
**功能：** 为每道题目添加分数机制

**实现细节：**
- 每个测试点分数 = 100 / 测试点数量
- 最终得分 = (通过测试点数 / 总测试点数) × 100
- 分数显示在提交记录、判题页面和题目详情页
- 题目右侧栏显示用户历史最高分数

**视觉优化：**
- 满分（100分）显示为绿色 (#4caf50)
- 非满分显示为红色 (#f44336)

**修改文件：**
- `server/judge.js` - 添加分数计算逻辑
- `server/db.js` - 数据库添加 score 字段
- `server/index.js` - 4个API添加分数返回
- `src/App.tsx` - 前端显示分数
- `src/App.css` - 分数颜色样式

#### 2. 题库搜索增强
**功能：** 模仿洛谷的题库搜索功能

**搜索方式：**
- **题号搜索**：输入 `P1001`、`p1001` 或 `1001` 精确匹配题号
- **关键字搜索**：搜索题目标题、描述和标签中的关键字
- 支持与难度、标签筛选组合使用

**修改文件：**
- `server/index.js` - 增强搜索API逻辑，使用正则识别题号格式

#### 3. 题目详情页布局优化
**优化内容：**
- 调整按钮大小和间距，使布局更舒适
- 优化右侧栏布局，合并题号和出题人信息
- 将难度标签移至右侧栏
- 题目标题移至内容框外部
- 增加题目详情页宽度至 1000px
- 优化各区块间距，使内容更紧凑

**修改文件：**
- `src/App.tsx` - 调整组件结构
- `src/App.css` - 优化样式和间距

---

### 2026-02-02 - 判题优化与视觉效果

#### 1. 判题时间优化
**问题：** 第一个测试点时间异常偏高（包含进程启动开销）

**解决方案：**
- 在 `judgeSubmission` 和 `runSample` 函数中添加预热机制
- 编译完成后先运行一次空输入，丢弃这次的时间
- 消除进程启动、缓存加载等开销
- 使时间统计更准确，反映代码真实执行时间

**修改文件：** `server/judge.js`

#### 2. 评测路由优化
**问题：** 刷新页面会重复评测，浪费资源

**解决方案：**
- 每次提交后自动跳转到独立路由 `/oj/judge/:submissionId`
- 使用 `replace: true` 替换历史记录
- 刷新页面时直接加载已有提交记录，不会重复评测
- 优化 useEffect 依赖，先检查 submissionId 再检查新提交

**修改文件：** `src/App.tsx` (OjJudgePage 组件)

#### 3. 评测结果展示优化
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
