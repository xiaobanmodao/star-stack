# StarStack

星栈（StarStack）是一个星空风格的算法测评平台，包含账号系统、题库/OJ、评测与记录展示，以及管理员用户管理功能。

## 功能概览
- 账号系统：邮箱验证码注册、登录、修改资料
- 站内装饰：头像框、头像叠加层和等级/荣誉称号，可在资料编辑页装备
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

下一阶段的内容体系、页面体验、性能、后端和安全开发规范见 [NEXT_PHASE_DEVELOPMENT_PLAN.md](./NEXT_PHASE_DEVELOPMENT_PLAN.md)。

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
- `GET /api/me/decorations`（读取头像框、叠加层、称号选项和解锁条件）
- `PATCH /api/me/decorations`（保存装备；服务端重新校验解锁状态）
- `POST /api/me/password`

OJ
- `GET /api/oj/problems`
- `GET /api/oj/problems` 支持 `page`、`pageSize`、`search`、`difficulty`、`tag` 和 `solved` 筛选参数
- `GET /api/oj/problems/:id`（题目详情）
- `GET /api/oj/problems/:id/related`（按难度和标签返回相近公开题目）
- `GET /api/my-problems`、`GET /api/problems/:id/edit`（题目编辑时返回知识点、技巧、预计用时和内容质量元数据）
- `POST /api/problems`、`PUT /api/problems/:id`（兼容保存题目元数据；质量/题解状态仅管理员可修改）
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
- `GET /api/leaderboard`（练习 Rating 总榜、周榜和月榜）
- `GET /api/problems/:id/revisions`（题目版本历史）
- `POST /api/problems/:id/revisions/:revisionId/restore`（恢复题目版本）
- `POST /api/problems/:id/submit-review`（作者提交审核）
- `GET /api/admin/metrics`（管理员系统监控）
- `GET /api/admin/problems/:id/review`（管理员审核详情、测试点和版本摘要）

提交评测会先持久化为 `Queued`，随后进入有并发上限的评测队列；服务重启会恢复未完成的评测，前端也会通过提交记录继续轮询状态。

练习 Rating 以 1000 为展示基线，按照已通过题目的难度累积计算，当前只用于长期训练进度和排行榜观察；它不等同于正式比赛 Rating，后续赛事模块会独立结算竞赛分。

题目内容元数据使用 `topicTags`、`techniqueTags`、`estimatedMinutes`、`recommendedFor`、`qualityStatus`、`editorialStatus` 和 `revisionSummary`。旧题目通过兼容迁移默认为空元数据、`unchecked` 和 `none`，不会改写历史题目或提交；普通作者修改题目后会重新进入草稿并回到“未检查”。

### API 错误与恢复约定

- 认证接口统一使用 `{ message: "..." }` 返回业务错误；未登录或会话失效返回 HTTP `401`。
- 前端 `fetchJson` 会自动附带 Bearer Token，并将网络失败、超时和取消规范化；收到 `401` 会清理本地会话并回到登录页，同时保留原访问路径。
- SSE 评测流断开后，页面会切换到提交记录轮询；用户可以取消仍在 `Queued` 阶段的提交，评测服务不可用时会显示可重试的 `Judge Error`。
- 评测沙箱不可用时不会降级为宿主机直接执行。编译和运行均需通过 Linux namespace、资源限制和 `timeout` 预检。

### 分页、会话与发布安全约定

- 题库支持兼容旧版的 `page`/`pageSize` 分页，也支持 `cursor` 游标分页；聊天私信和通知接口同样返回不透明的 `nextCursor`，客户端不得自行解析游标内容。
- 登录成功后同时写入 HttpOnly 会话 Cookie；Bearer Token 继续兼容已有客户端。生产 Cookie 使用 `Secure`、`SameSite=Lax`，Cookie 写请求会校验 Origin/Referer。
- 提交评测最多读取 200 个测试点，样例/自定义运行沿用同一评测资源限制，自定义输入最大 3MB；队列按用户限制并发和排队容量，并在健康接口报告等待与运行指标。
- 数据库发布前使用 SQLite 一致性快照备份，`npm run db:verify` 和 `npm run db:verify-backup` 会检查完整性、外键、核心字段和关键索引。

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
- `server/identity/` Hydra Login/Consent、Token Hook、UserInfo 和受控 Public 代理
- `infra/identity/` 固定版本的本地 Hydra/PostgreSQL 运行时与操作说明

## 当前维护重点

- 发布前必须完成 `npm run lint`、`npm test -- --run`、`npm run build`、API Smoke Test、数据库迁移/完整性检查和依赖审计。
- 页面验收覆盖 375px、768px、1440px，包含登录、题库、题目详情、IDE、提交队列、聊天和管理员面板的键盘操作。
- `npm run audit` 使用 Chrome CDP 检查浅色/深色主题文字对比度；`npm run stress -- health` 只允许指向本机服务。
- 依赖审计中暂时没有上游修复版本的条目保留在发布记录中，不通过强制升级破坏当前 React Router、Monaco 或编辑器能力；后续依赖有修复版本时再单独升级验证。

## 近期变更

### 2026-08-31 - 界芽账号生命周期可靠投递底座

- `active`、`suspended`、`deleted` 状态继续与认证世代、StarStack 会话撤销和 Hydra 撤销 outbox 在同一 SQLite 事务写入；同一账号按世代有序处理，`deleted` 保持不可恢复终态。
- 可选生命周期 worker 使用独立 systemd credential，经固定 loopback `POST http://127.0.0.1:4180/internal/starstack/account-lifecycle` 投递最小 v1 事件；请求固定 `Host: jieya.xingzhan.cc`，只有 Jieya 返回精确 `200` 与 `applied|duplicate|stale|terminal` JSON 回执才完成。网络/`5xx` 持久退避重试，`409` 与其他 `4xx` 失败关闭并告警。
- 生命周期投递和 Jieya 云写入默认关闭。封禁保留云档、解封要求重新登录、永久注销触发云档删除；普通登出、断开应用和密码/邮箱变更不删除云档。管理员永久注销前会明确提示先导出界芽云档。

### 2026-08-31 - 界芽计划正式产品入口与账号连接

- 项目大厅的界芽卡片固定指向 `https://jieya.xingzhan.cc`，明确游客模式保留，只有用户主动选择时才使用星栈账号登录。
- 资料编辑页增加“已连接应用”，从 `oidc_login_sessions` 派生 Jieya 的连接/撤销中/未连接状态；撤销在 SQLite 事务中推进认证世代并写持久化 outbox，立即使旧 OIDC 凭据失败关闭，但不注销 StarStack 主站会话、不删除界芽本地存档。
- 旧 `/api/sso/session` 固定返回 `410 Gone`，原共享浏览器凭据工具已删除，`/sso.html` 仅保留无脚本停用说明；管理员权限、邮箱、密码和 OJ 数据不会进入 Jieya Claims。

### 2026-08-30 - Hydra 身份运行时（本地门禁）

- StarStack 作为 Ory Hydra 的 Login/Consent 应用，继续唯一保存账号、密码、不可变 `account_subject` 与账号状态；Hydra 独立保存 OAuth2/OIDC 协议对象。
- 新增认证世代、账号中心会话、持久化撤销 outbox、自定义 Logout Broker、Token Hook 与最小 UserInfo；公开账号页、UserInfo 与私网安全操作使用隔离 SQLite 连接及有界队列，账号封禁、密码安全变更和全局退出在 Hydra 物理撤销窗口内失败关闭。
- 身份入口增加每源/全局限流、有效 CSRF 后才消费的 HMAC 账号密码预算、512 条交互容量、每账号/客户端 16 个 active SID、每账号 16 条/全局 4,096 条账号中心会话，以及 Outbox 绝对/未解决/单世代三层上限和固定小批量 drain；密码预算键与账号精确查询一致，保留大小写和 Unicode 差异，不会让可共存账号共享限流桶。未完成授权的账号会话保持 provisional，并在 Hydra/Consent/SID 容量失败时撤销。失败的旧标签页响应不会删除其他标签页新建立的账号 Cookie，仅成功全局退出会清 Cookie。OIDC SID 显式 30 天过期并保留未完成撤销。Hydra 本地工具只允许精确的 loopback `hydra_test` DSN，坏 DSN 会在任何迁移或进程启动前失败关闭。
- `jieya-server-local` 使用 Authorization Code + PKCE S256、`client_secret_basic` 与精确本地 callback；浏览器不应持有 StarStack Token，Jieya BFF 负责创建自己的应用会话。
- Hydra Public 代理仅转发按版本、环境和固定 Client ID 计算出的精确 Hydra Cookie；账号中心 Cookie 双向隔离，Hydra Cookie 固定为 `/oauth2`、`HttpOnly`、`SameSite=Lax`（生产再强制 `Secure`）。身份表单使用 `Referrer-Policy: same-origin`，与 exact Origin/Referer + CSRF 校验保持一致且不向跨源泄漏路径。
- OIDC 默认关闭；启用时 issuer 在开发环境固定为 `http://auth.localhost:5174`、生产固定为 `https://auth.xingzhan.cc`。Hydra Public/Admin origin 仅接受完整私网 IP、`localhost` 或单标签容器服务名，拒绝伪装成私网前缀的公网 DNS。本地精确 `hydra_test` DSN 只允许机器级唯一、当前 UID 所有且 mode-`0600` 的 canonical 凭据；Secret、fixture SQLite 与运行锁统一位于 checkout 外的 DSN 指纹状态目录，所有安全文件均要求单一 hard-link。fixture SQLite 主库由父子进程共同固定 inode，服务端以 `SQLITE_OPEN_NOFOLLOW` 打开，在每个 WAL/DDL/DML 写入阶段前复核目录和主库，并在 ready 前复核 rollback journal、WAL 与 SHM；这能失败关闭预存不安全路径、事故和遵守运行锁的同 UID worktree 冲突，但不宣称抵御恶意同 UID 的校验/VFS 精确竞态。协议门禁会将凭据与 Hydra 数据库作为一个单元轮换重建，并在实际 `run-local` 重启后通过真实签发 ID Token 的 header `kid` 验证公开 JWKS 和 signing key 连续性。尚未接入生产 DNS/Nginx/PM2，真实 Hydra v26.2.0 + PostgreSQL 16.15 的启动、协议测试、中断恢复、威胁边界与停止线见 `infra/identity/README.md`。

### 2026-08-27 - 练习 Rating 基础能力

- 统一练习 Rating 的展示基线和历史记录换算，保留数据库中原有难度权重，避免改写历史用户数据。
- 恢复排行榜页面入口，支持总榜、周榜和月榜，用户菜单增加排行榜入口。
- 个人主页增加练习 Rating 统计卡片和走势说明；正式比赛 Rating 暂不与练习分混用。

### 2026-08-29 - 题目内容元数据与质量状态

- 题目编辑支持知识点、解题技巧、预计用时、适合人群和本次修改说明。
- 管理员可以在题目编辑页维护内容质量和题解状态，并在题目审核列表按质量状态筛选。
- 旧数据库通过兼容字段迁移补齐默认值，历史版本恢复会同步保留元数据；普通作者修改后自动回到未检查状态。
- 题库详情展示可用的知识点、技巧和预计用时，方便用户判断下一道训练题。

### 2026-08-29 - 移除学习路径功能

- 移除学习路径页面、题库学习路径筛选、题目详情路径上下文和对应公开 API。
- 停止初始化新的学习路径数据；已有 SQLite 中的历史路径表保留为不再使用的兼容数据，不影响用户、题目和提交记录。

### 2026-08-27 - 提交反馈闭环与相近题目

- 评测结果页按 Accepted、答案错误、编译/运行超时和评测服务异常提供对应的继续操作入口。
- 失败提交可以直接返回 IDE、查看题解、查看题目讨论和提交记录；评测服务异常可直接重试。
- 通过提交可以继续浏览题库、查看题解、提交记录和成长记录，减少评测结果页的流程断点。
- 新增 `GET /api/oj/problems/:id/related`，根据题目难度和标签返回最多 4 道相近公开题目；接口只读，不修改数据库结构和历史数据。
- 评测结果页展示相近题目时固定卡片布局，已通过状态不会改变列表尺寸。

### 2026-08-27 - 体验、性能与安全收口

- 评测/沙箱队列增加按用户公平轮转、并发与排队上限、取消统计和等待/运行耗时指标，避免单个用户占满资源。
- SQLite 增加 busy timeout、聊天/通知/题库查询索引和游标分页兼容；健康检查改为稳定使用服务端数据库路径。
- 增加 HttpOnly Cookie 会话和 Cookie 请求来源校验，同时保留 Bearer Token 兼容；严格校验聊天、点赞、收藏、邀请链接、计划和评测输入。
- 限制异常题目测试点数量和自定义输入大小，修复邀请链接并发超额消耗、点赞/收藏竞态和跨房间已读校验。
- 顶部通知、聊天室成员、好友与聊天身份展示统一补充头像框、叠加层和称号；图片失败时仍回退为固定尺寸头像。
- 完成发布门禁：lint、68 项单测、生产构建、依赖审计、数据库/备份恢复校验、API smoke、200 并发健康压力测试，以及浅色/深色三种视口对比度审计。

### 2026-08-25 - 站内装饰与资料中心发布收口

- 增加头像框、头像叠加层和等级/荣誉称号的兼容迁移字段，老用户默认保持原有头像外观。
- 统一个人资料编辑、头像、邮箱、密码、会话和站内装饰保存结果为右上角 Toast 提示。
- 资料编辑请求增加网络异常恢复、重复操作保护和组件卸载后的状态保护。
- 补充装饰接口鉴权、解锁校验、响应结构和静态资源烟测。

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
- `unshare --user --net --mount --pid --mount-proc` + 最小 `chroot`：隔离用户、网络、挂载和进程命名空间，不暴露项目目录、用户目录和宿主机进程
- `ulimit -v`：内存限制 256MB
- `ulimit -u 32`：最大进程数 32
- `ulimit -f 51200`：最大文件大小 50MB
- `ulimit -n 64`：最大文件描述符 64
- `timeout --signal=KILL`：双重超时保险
- 编译和执行步骤都走沙箱，生产启动时会预检完整 user namespace / mount / chroot 能力；能力不足时拒绝评测，不回退到无隔离执行
- stdout/stderr 加大小限制（10MB/1MB），防止内存爆炸
- Windows 开发环境行为不变

**部署要求：** Linux 主机需要可用的 `unshare`、`timeout`、`mount`、`chroot` 和对应 namespace 权限；服务必须由专用非 root 用户运行。部署时应以该用户执行 `server/sandbox.sh` 探针。生产环境沙箱不可用时服务仍可启动，但会拒绝执行用户代码。

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
