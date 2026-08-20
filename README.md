# StarStack

星栈（StarStack）是一个星空风格的算法测评平台，包含账号系统、题库/OJ、评测与记录展示，以及管理员用户管理功能。

## 功能概览
- 账号系统：邮箱验证码注册、登录、修改资料
- OJ 评测：题库筛选、题目详情、在线 IDE、提交评测与记录
- 讨论大厅：发帖、楼中楼评论、点赞、富文本编辑器、关联题目
- 后台管理：仅管理员可见（用户管理）
- 评测优化：预热机制消除时间误差、独立路由防止重复评测
- 视觉效果：火箭发射动画、烟花效果（带重力）、大字结果展示
- 安全验证：登录连续失败后触发 Cloudflare Turnstile
- 邮箱安全：注册邮箱验证码、验证码过期与重发限制

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

核心接口烟测：`npm run test:smoke`；本地监控、管理员审核和评测队列压力测试见 [DEPLOYMENT.md](./DEPLOYMENT.md)，压力脚本默认拒绝公网目标。

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
- `POST /api/oj/submissions/stream`（SSE 实时评测结果）
- `POST /api/oj/submissions/:id/cancel`（取消尚未开始的排队提交）
- `GET /api/oj/submissions`（当前用户提交）
- `GET /api/oj/submissions/:id`（单条提交）
- `GET /api/oj/submissions/all`（某题所有提交，含过滤）
- `GET /api/oj/submissions/latest`（当前用户该题最近提交）
- `POST /api/oj/run-sample`
- `POST /api/oj/run-custom`
- `GET /api/health`（服务与评测队列健康状态）
- `GET /api/problems/:id/revisions`（题目版本历史）
- `POST /api/problems/:id/revisions/:revisionId/restore`（恢复题目版本）
- `POST /api/problems/:id/submit-review`（作者提交审核）
- `GET /api/admin/metrics`（管理员系统监控）
- `GET /api/admin/problems/:id/review`（管理员审核详情、测试点和版本摘要）

提交评测会先持久化为 `Queued`，随后进入有并发上限的评测队列；服务重启会恢复未完成的评测，前端也会通过提交记录继续轮询状态。

### API 错误与恢复约定

- 认证接口统一使用 `{ message: "..." }` 返回业务错误；未登录或会话失效返回 HTTP `401`。
- 前端 `fetchJson` 会自动附带 Bearer Token，并将网络失败、超时和取消规范化；收到 `401` 会清理本地会话并回到登录页，同时保留原访问路径。
- SSE 评测流断开后，页面会切换到提交记录轮询；用户可以取消仍在 `Queued` 阶段的提交，评测服务不可用时会显示可重试的 `Judge Error`。
- 评测沙箱不可用时不会降级为宿主机直接执行。编译和运行均需通过 Linux namespace、资源限制和 `timeout` 预检。

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
- `src/App.tsx` 应用壳、路由、认证状态和全局导航
- `src/pages/` 独立页面组件；`src/components/` 可复用 UI、OJ IDE 和聊天模块
- `src/utils.ts` 统一 API 请求、会话失效和请求超时处理
- `src/hooks/` 页面交互 hook（星空背景、弹窗焦点管理等）
- `src/App.css` 全站样式（星空、布局、OJ、动画、后台）
- `server/index.js` API 主入口
- `server/judge.js` 判题与运行逻辑（C++/Java/Python，含预热机制）
- `server/db.js` 数据库初始化

## 当前维护重点

- 发布前必须完成 `npm run lint`、`npm test -- --run`、`npm run build`、API Smoke Test、数据库迁移/完整性检查和依赖审计。
- 页面验收覆盖 375px、768px、1440px，包含登录、题库、题目详情、IDE、提交队列、聊天和管理员面板的键盘操作。
- `npm run audit` 使用 Chrome CDP 检查浅色/深色主题文字对比度；`npm run stress -- health` 只允许指向本机服务。
- 依赖审计中暂时没有上游修复版本的条目保留在发布记录中，不通过强制升级破坏当前 React Router、Monaco 或编辑器能力；后续依赖有修复版本时再单独升级验证。

## 近期变更

### 2026-08-20 - 体验与稳定性收口

- 统一处理会话失效、请求超时、网络异常和请求取消；失效登录会保留原访问路径。
- 增加全局 React 错误边界，评测流断开后通过提交记录继续轮询。
- 增强用户菜单、弹窗 Esc 关闭、焦点锁定/恢复和移动端键盘可用性。
- 移除已取消的 `/api/me/export` 接口及控制器。

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
- `unshare --net --mount --pid --mount-proc`：隔离网络、挂载和进程命名空间，禁止网络访问并避免用户代码查看宿主机进程
- `ulimit -v`：内存限制 256MB
- `ulimit -u 32`：最大进程数 32
- `ulimit -f 51200`：最大文件大小 50MB
- `ulimit -n 64`：最大文件描述符 64
- `timeout --signal=KILL`：双重超时保险
- 编译和执行步骤都走沙箱，生产启动时会预检 `unshare` / `timeout` 能力；能力不足时拒绝评测，不回退到无隔离执行
- stdout/stderr 加大小限制（10MB/1MB），防止内存爆炸
- Windows 开发环境行为不变

**部署要求：** Linux 主机需要可用的 `unshare`、`timeout` 和网络/挂载/进程 namespace 权限；部署时应先验证 `unshare --net --mount --pid --fork --mount-proc --kill-child -- true`。生产环境沙箱不可用时服务仍可启动，但会拒绝执行用户代码。

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
