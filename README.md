# StarStack

星栈（StarStack）是一个星空风格的算法测评平台，包含账号系统、题库/OJ、评测与记录展示，以及管理员用户管理功能。

## 功能概览
- 账号系统：注册/登录/修改资料
- OJ 评测：题库筛选、题目详情、在线 IDE、提交评测与记录
- 讨论大厅：发帖、楼中楼评论、点赞、富文本编辑器、关联题目
- 后台管理：仅管理员可见（用户管理）
- 评测优化：预热机制消除时间误差、独立路由防止重复评测
- 视觉效果：火箭发射动画、烟花效果（带重力）、大字结果展示
- 安全验证：注册始终使用 Cloudflare Turnstile，登录连续失败后触发验证

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

## 生产部署

生产环境使用 Node.js 22、PM2、Nginx 和 SQLite，完整的首次部署、日常更新、数据库迁移、备份恢复与 HTTPS 流程见 [DEPLOYMENT.md](./DEPLOYMENT.md)。

## 管理员初始化

首次初始化数据库时，通过 `ADMIN_ID`、`ADMIN_NAME` 和 `ADMIN_PASSWORD` 环境变量创建管理员。生产环境不要在文档或代码中写死密码；请按照 [DEPLOYMENT.md](./DEPLOYMENT.md) 中的流程生成并保存初始密码。

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

### 2026-04-24 - 前端体验修正与 OJ 主页简化

#### 1. 在线 IDE 体验修正
**问题：** 题目详情页打开在线 IDE 后，顶部工具栏中的提交按钮在部分宽度下过于靠右，视觉上贴近或越出容器。

**修复：**
- 限制 IDE 顶部工具栏内部布局宽度
- 将语言选择与提交按钮固定在同一行的安全网格中
- 为 IDE 面板、工具栏左右区和提交按钮补充 `box-sizing` 与溢出约束

**修改文件：**
- `src/App.css`

#### 2. 评测系统主页回归传统入口
**问题：** 主页中的统计列、走势图、训练入口卡片和计划面板造成页面信息过多，题目跳转位置不符合传统使用习惯。

**调整：**
- 移除主页统计卡片、走势图、跳转卡片和计划面板
- 保留主视觉、进入题库、随机一题
- 将题目跳转恢复到主视觉内容左下方，作为核心入口

**修改文件：**
- `src/pages/OjHomePage.tsx`
- `src/App.css`

#### 3. 项目记录规范
**约定：** 后续每次任务结束后同步更新 `README.md` 的更新日志，记录关键行为变化和修改文件。

#### 4. 根主页极简化
**问题：** 根主页 `/` 仍保留题库规模、今日提交、活跃用户等数据条，以及题库训练、OJ 控制台、排行榜、讨论区等跳转卡片，导致首页继续显得杂乱。

**调整：**
- 删除根主页统计请求和数据展示
- 删除根主页四个功能跳转卡片
- 保留品牌主视觉和两个基础入口按钮

**修改文件：**
- `src/pages/HomePage.tsx`
- `src/App.css`

#### 5. 根主页改为洛谷式简洁布局
**问题：** 根主页继续沿用居中主视觉和卡片式布局，内容视觉重心偏移，不符合简洁 OJ 首页习惯。

**调整：**
- 首页改为左对齐文档式结构
- 移除所有首页卡片容器、厚背景块和大圆角面板
- 使用普通文字链接式入口，参考洛谷一类 OJ 的简洁导航方式

**修改文件：**
- `src/pages/HomePage.tsx`
- `src/App.css`

---

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

---

## 更新日志

### 2026-03-28 - 安全加固与性能优化

#### 1. XSS 过滤器重写（P0 紧急修复）
**问题：** 原 `sanitizeHtml` 使用正则黑名单，`<img onerror>`, `<svg onload>`, 大小写混合 `javascript:` 等均可绕过。

**修复：** 重写为白名单解析器。只允许指定标签（`p, br, strong, em, code, pre, a, ul, ol, li, b, i, div, span, h1, h2, h3, blockquote`）通过，其余标签转义为 `&lt;&gt;`。属性仅允许 `<a>` 的 `href`（限 http/https/mailto 协议）、`target`、`rel`，并强制添加 `rel="noopener noreferrer"`。

**修改文件：** `server/index.js`

#### 2. 评测沙箱（P0 紧急修复）
**问题：** 用户提交的代码通过 `child_process.spawn` 直接在服务器上执行，无任何隔离。可读取文件系统、发起网络请求、fork bomb。

**修复：** 新增 `server/sandbox.sh`，在 Ubuntu 上通过 Linux 内核特性隔离：
- `unshare --net --mount`：隔离网络和挂载命名空间，禁止网络访问
- `ulimit -v`：内存限制 256MB
- `ulimit -u 32`：最大进程数 32
- `ulimit -f 51200`：最大文件大小 50MB
- `ulimit -n 64`：最大文件描述符 64
- `timeout --signal=KILL`：双重超时保险
- 编译步骤不走沙箱（需要编译器访问），仅执行步骤沙箱化
- stdout/stderr 加大小限制（10MB/1MB），防止内存爆炸
- Windows 开发环境行为不变

**部署要求：** `sudo setcap cap_sys_admin+ep $(which unshare)` 或以 root 运行

**修改文件：** `server/judge.js`, `server/sandbox.sh`（新增）

#### 3. CORS 限制（P2 修复）
**问题：** `app.use(cors())` 允许任何域名跨域请求。

**修复：** 通过环境变量 `ALLOWED_ORIGINS` 配置允许的域名（逗号分隔）。未配置时兼容开发环境。
```bash
ALLOWED_ORIGINS=https://yourdomain.com node server/index.js
```

**修改文件：** `server/index.js`

#### 4. 内存缓存泄漏修复（P2 修复）
**问题：** `translateCache`, `compileCache`, `messageRateLimits`, `postRateLimits` 均为无上限 `Map`，长期运行内存持续增长。

**修复：** 实现 `BoundedCache` 类（LRU + TTL），替换所有无上限 Map：
- `translateCache`：最多 2000 条，30 分钟过期
- `compileCache`：最多 200 条（LRU 淘汰）
- `messageRateLimits`：最多 5000 条，3 秒过期
- `postRateLimits`：最多 5000 条，10 秒过期

手动清理循环已移除，TTL 自动处理过期。

**修改文件：** `server/index.js`, `server/judge.js`

#### 5. 排行榜更新优化（P2 修复）
**问题：** `updateRankings` 每次提交都遍历所有用户逐个 UPDATE（O(n) 次写入），严重拖慢提交响应。

**修复：**
- 从 N 次逐行 UPDATE 改为单条 SQL 子查询批量更新
- 加 30 秒节流，避免高频提交时重复计算

**修改文件：** `server/stats.js`

#### 6. 其他安全改进
- 编译缓存 hash 从 MD5 升级为 SHA-256，避免碰撞风险
- Linux 可执行文件不再使用 `.exe` 后缀

---

## 待优化项（前端页面与架构）

### 架构问题

#### A1. 单文件巨石组件（高优先级）
`src/App.tsx` 共 6391 行，18 个页面组件全部定义为 `App()` 内的闭包。任何顶层状态变化（如未读消息轮询）都会重新创建所有 18 个组件的函数引用。应将页面组件提取到独立文件，使用 React Context 或状态管理库共享全局状态。

#### A2. 无全局错误处理
`fetchJson` 工具函数存在，但 401（token 过期）在每个调用点手动处理。应添加全局拦截器，token 失效时自动跳转登录页。

#### A3. 重复代码模式
- 分页逻辑在 4+ 个页面中重复，应提取 `usePagination` hook
- `CreateProblemPage` 和 `EditProblemPage` 逻辑高度相似，应合并为 `ProblemFormPage`
- `formatDate` 在多处内联定义

#### A4. 富文本编辑器使用已废弃 API
`RichTextEditor` 使用 `document.execCommand`（已废弃），应替换为 `Selection/Range` API 或使用成熟库。

### CSS 性能

#### C1. `backdrop-filter: blur()` 性能问题
全局 12 处使用，其中 `.topbar`（固定定位 + blur）在每次滚动时触发重绘。建议改为半透明纯色背景，或添加 `will-change: transform`。

#### C2. `transition: all` 滥用
多处使用 `transition: all 0.2s ease`，会过渡所有可动画属性（包括 width/height 等昂贵属性）。应限定为具体属性如 `transition: color 0.2s, background-color 0.2s`。

#### C3. 热力图 371 个单元格各带 hover 动画
`.heatmap-grid` 的 371 个格子每个都有 `transition: all` + `:hover { transform: scale(1.2) + box-shadow }`，在 profile 页面造成不必要的性能开销。

#### C4. CSS 文件组织
6777 行单文件，media query 分散在 11 处。建议按功能拆分为独立 CSS 文件（Vite 原生支持零开销导入）。

### 无障碍（Accessibility）

#### ACC1. 缺少焦点样式
IDE 工具栏按钮、讨论区操作按钮等无 `:focus-visible` 样式，键盘用户无法看到焦点位置。

#### ACC2. 缺少 ARIA 属性
- 星空 `<canvas>` 缺少 `aria-hidden="true"`
- `UserMenu` 触发器缺少 `role="button"`, `aria-haspopup`, `aria-expanded`
- 模态框缺少焦点陷阱（focus trap）
- `RichTextEditor` 的 `contentEditable` 缺少 `aria-label`

#### ACC3. 颜色对比度不足
- `.oj-badge.noi` 和 `.difficulty-label.noi`：`color: #555555` 在深色背景上对比度远低于 WCAG AA 标准 4.5:1
- `prefers-reduced-motion` 仅覆盖 `.home-enter` 动画，火箭/烟花/hover 变换等均未覆盖
