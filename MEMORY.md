# StarStack 项目完整对话记忆（MEMORY）

> 本文件由前一对话完整导出，供新对话接续开发使用。
> 更新时间：对话导出时。若后续开发改变了任何状态，请同步更新本文件。

---

## 一、项目概况

- **星栈 StarStack**：星空主题全栈平台（项目主站 + OJ 子站 + 聊天中心）。
- 前端：React 19 + TypeScript strict + Vite 7 + React Router DOM 7（懒加载路由）。
- 后端：Node ≥22 + Express 4 + SQLite（WAL 模式），`server/index.js` 单文件约 5900 行、120+ API。
- 关键依赖：Monaco（代码编辑器）、KaTeX（公式）、highlight.js（代码高亮，github-dark 主题）、lucide-react 1.31（线性图标）、web-push（推送）。
- 部署：nginx 单域名多路径（`/` 主站 + `/jieya/`）、PM2（`ecosystem.config.js`，端口 5174）、`backup.sh`。
- 文档：`ROADMAP.md`（迭代 0-9 全绿）、`SSO.md`、`nginx.conf`、`DEVELOPING.md`（开发规范，重要）。

---

## 二、当前架构（最新状态，重要）

### 整体结构：主站 + OJ 分支
- **主站**（首页 `/`、聊天 `/chat/*`、个人中心 `/account`、他人主页 `/user/:id`）：**无任何侧边栏**，内容全宽（`.main` 宽 `min(1440px, calc(100vw - 40px))` 居中）。
- **OJ 分支**（`/oj/*`）：贴左边缘的**动态张闭侧边栏**（组件 `src/components/OjLayout.tsx` + `.css`）。
- 顶栏：`position: fixed` **绝对固定**（重要：曾因 `.app { backdrop-filter }` 劫持 fixed 包含块导致随滚动，已删除该规则）。
- 滚动：**body 正常滚动**（洛谷式）；`.content { overflow-x: clip }`（不创建滚动容器）；`.app-body/.content/.main` 用 `flex: 1 0 auto` + `.main > * { flex-shrink: 0 }` 防 flex 链压缩裁剪。
- OJ 顶栏标题：`/oj/*` 下显示"**星栈在线评测**"（双色艺术字：`星栈` accent 色 + `在线评测` 正文色，`.topbar-title-art`），其他页面"星栈"。

### OJ 侧边栏设计（用户明确要求）
- 复用原全局侧栏整套样式（`.sidebar/.nav/.nav-link/.nav-icon/.nav-label/.sidebar-footer`，规则仍在 App.css，全局已不渲染）。
- 收起：64px 窄图标栏（图标居中）；**hover 展开：224px**，图标 + 文字（文字在图标**右侧**，淡入），悬浮（fixed）**不挤压内容**（`.oj-sidebar-main { margin-left: 59px }` 固定占位）。
- 每项独立图标（lucide-react）：评测首页=House、题库=BookOpen、提交记录=FileText（代码评测入口已按用户要求移除，路由仍保留）。底部 footer"Online Judge"。
- 移动端不在考虑范围（用户原话"看着办"）。

### 路由结构（App.tsx）
```
/                        HomePage（项目大厅：OJ/界芽/StarCode 三卡片）
/account                 AccountPage（个人中心）
/user/:userId            UserProfilePage（他人主页）
/oj  (OjLayout 包裹)      OjHomePage / list / judge(/judge/:id) / records/:id / submissions / *（详情）
/chat/*                  ChatHubPage（plaza/c/:key/room/:id/rooms/join/:token/p/:id/edit/p/:id/friends/activity/dm/dm/:userId）
/messages, /messages/:userId   MessageListPage / ChatPage（旧私信路由，仍可用）
/leaderboard             已屏蔽 → 重定向 /
/auth                    AuthPage
/admin                   管理后台（仅管理员）
```

---

## 三、开发规范（DEVELOPING.md，强制遵守）

### 零章：开发前讨论制度（最高优先级）
**任何开发动作，必须先讨论、后动手、经确认再实施。**
1. 先复述需求（含明确排除项）
2. 梳理方案（实现思路/涉及文件/影响范围/备选方案）
3. 等用户明确同意后才写代码；用户没表态 = 不动手
4. 动手后按审查制度交付

### 铁律
1. **设计令牌优先**：颜色必须走 `styles/tokens.css` 的 `--ss-*` 变量，禁止硬编码 hex/rgba
2. **双主题必须同时正确**（浅色/深色都要过审计）
3. **文字反馈方向**：暗色主题文字亮、点击不能变暗；亮色主题文字暗、点击不能变亮
4. 禁止叠加多套样式体系（App.css 有 classic/liquid glass/final 历史层，新样式只写页面 CSS 或 final 覆盖块）
5. 动效克制：禁渐变、禁大位移，hover 只背景/边框微变

### 改动分级
- S：文案/数值 → tsc+eslint+build
- A：颜色/间距 → +grep 硬编码色
- B：页面布局/新页面 → +`npm run audit`（双主题 0 违规）
- C：主题/全局结构/路由 → +全页面回归+移动端检查

### 交付清单（每次附上）
tsc / eslint / build 通过；audit 双主题 0 违规；无硬编码颜色；无 z-index 冲突；hover 方向正确。

---

## 四、主题系统（tokens.css 关键值）

- 深色：bg `#0d1117`、panel `#161b22`、input `#0d1117`、code `#0d1117`、hover `rgba(255,255,255,0.06)`、text `#e6edf3`、accent `#58a6ff`、success `#3fb950`、warning `#d29922`、danger `#f85149`。
- 浅色：body `#f6f8fa`、卡片/顶栏/侧栏 `#ffffff`（opaque）、input `#f6f8fa`、hover `rgba(31,35,40,0.09)`（**反馈加深**）、text `#1f2328`、muted `#59636e`、subtle `#667085`、accent `#0969da`、success `#15803d`、warning `#b45309`、danger `#dc2626`。
- **light 块包含 legacy 变量映射**（`--bg/--panel/--text/--muted/--border/--accent/--success/--danger/--accent-2/3/--shadow-*` + `--hover-calm/--hover-calm-border`）——**这是浅色全站亮色字事故的修复，不可删**。
- 难度徽标浅色彩色：入门 `#dc2626`、普及- `#b45309`、普及/提高- `#d97706`、提高 `#15803d`、省选 `#0969da`。
- 代码块两种主题都保持深色底（`--ss-bg-code #0d1117`）+ hljs 亮字。

---

## 五、功能清单（已完成）

- **项目大厅首页**：三张项目卡片（OJ featured / 界芽 external `<a>` / StarCode desktop `<button>`），hover/active 星蓝边框+背景加深+active 下沉 1px，边框绝不消失（修复过 `--hover-calm` 事故）。
- **OJ**：题库列表（搜索/难度/标签/分页）、题目详情（KaTeX+代码高亮、样例、刷题计划面板）、评测（Monaco IDE、提交记录、判题结果）、OJ 首页。
- **题解区（洛谷式）**：独立题解页 `/oj/solutions/:id`；OJ 详情右侧常驻题解卡片，点击进入题解区；右上角“发题解”进入完整新页面 `/oj/solutions/:id/new` 编辑；仅 AC 过该题的用户可发布；题解详情复用讨论详情页并显示“题解”徽标；普通讨论列表自动排除题解。
- **富文本编辑器**：已重做——更全工具栏（标题/引用/删除线/撤销重做/清除格式）、预览模式、更大编辑区。
- **每日一题 + AC 连击**（留存机制，已上线）：
  - `GET /api/problems/daily`：按日期取模轮换推荐（优先未 AC 的题），返回 problem/solvedToday/streak/maxStreak。
  - 连击规则：**任意 AC 一题即打卡**；`server/stats.js` 的 `calculateStreak` 只统计 `accepted_count > 0` 的日子；算法含"今天未打卡允许昨天为起点"逻辑（边界已修）。
  - 题库页顶部"Daily Quest"卡片：难度徽标+标题+标签+去挑战按钮；🔥 连击天数（琥珀）、断签提醒（红）、今日已打卡 ✓。
- **每日签到**：独立于 AC 连击；`GET/POST /api/me/checkin`，个人中心签到面板显示今日状态/当前连续/最长连续/累计天数，每天一次；OJ 首页 hero 与内容网格之间也有通栏签到横幅（未登录隐藏）。
- **数据导出**：`GET /api/me/export` 导出个人帖子/评论/私信/聊天消息/收藏；个人中心“导出我的数据”下载 JSON。
- **新手引导**：首次登录自动弹出星空主题引导弹窗（项目大厅/OJ/评测/聊天），完成或跳过记录到 `users.onboarded_at`。
- **等级制度**：XP 等级体系（星尘→流星→新星→行星→恒星→超新星→黑洞）；XP 来源：每日签到 +10、发帖/题解 +20、评论 +5、聊天消息 +2；展示在顶栏用户菜单、个人中心、他人主页。
- **帖子置顶**：管理员可置顶/取消置顶帖子（`POST/DELETE /api/discussions/:id/pin`），列表置顶优先并显示“置顶”徽标；房间消息置顶未做。
- **聊天中心**：模块频道（发帖制，富文本编辑器 B/I/代码块/KaTeX/大小字）、房间（邀请链接/成员/房主）、私信 DM、好友系统（互相关注即好友）、通知中心、@提及、话题线程、黑名单、全站搜索（Ctrl+K）、收藏、聊天成就/活跃榜、举报+管理后台、SSO、推送通知（web-push）、FloatingChat 全局浮窗私信。
- **私信页 ChatPage**（`/messages/:userId`、`/chat/dm/:userId`）：**时间线+输入框合并为单个聊天框**（洛谷式：消息区占 ~65%、输入区 ~13% 紧凑工具栏+矮输入框，头部/面板头压缩，气泡紧凑高密度）。登录需要 auth。
- **用户体系**：个人中心（统计卡/热力图/难度分布/等级分走势/成就）、他人主页（简介/关注/粉丝/好友/屏蔽/举报——关系卡在 sticky 身份卡内防遮挡）、头像上传（MIME 白名单）、bio 编辑。
- **管理后台**：用户管理、题目管理、举报处理、内容审核。
- **已移除**：排行榜（路由重定向首页，入口全删，后端 API 保留）、成长航线面板（个人中心星图，代码已清理）。
- **安全**：登录限流（5 次失败锁 IP 10 分钟）、发帖/私信/聊天/评论/举报限流、token 30 天、SAFE_URL_RE 防 `//`、sanitizeHtml 白名单、评测沙箱（生产强制）。
- **工程化**：Vitest 18 个单测（`npm test`，覆盖工具函数/AC 连击/等级 XP/富文本 XSS）+ GitHub Actions CI（lint/build/test）；`server/diagnose.js` 已修正为读取真实 `starstack.sqlite`。
- **运维/可观测**：`backup.sh` 支持环境变量与 `--install-cron` 自动安装定时备份；前端全局错误上报到 `client_errors` 表；已移除无 UI 使用的频道实时消息/SSE 后端接口。
- **CSS 颜色迁移进度**：✅ 已完成——全站 CSS 硬编码颜色已清零（881 处全部迁移到 `--ss-*` 令牌或 `color-mix`），含历史遗留 `App.css`。

---

## 六、关键 API 备忘

- 登录：`POST /api/login`，**字段是 `{ id, password }`（不是 username！）**，返回 `{ token, user }`。
- 每日一题：`GET /api/problems/daily`（Authorization: Bearer）。
- 会话列表：`GET /api/messages/conversations`；会话详情：`GET /api/messages/conversations/:userId`。
- 题目列表：`GET /api/oj/problems`；详情：`GET /api/oj/problems/:id`。
- 用户档案：`GET /api/user/profile/:userId`、`/api/user/heatmap/:userId`、`/api/user/achievements/:userId`、`/api/user/rating-history/:userId`。
- 提交评测：`POST /api/oj/submit`（评测限流 10s + 并发 4）。

---

## 七、测试账号与环境

- 测试用户：astro01~astro12，密码 `12345678`；admin 密码 `admin123456`。
- 本地：前端 dev `http://localhost:5173`（Vite），后端 `http://localhost:5174`（Express）。后端日志 `server/server.log`。
- **后端重启**：`pkill -f "node index.js"` 后 `(cd server && node index.js > server.log 2>&1 &)`。
- **npm 权限**：`~/.npm` 有 root 文件，构建必须 `npm_config_cache=/tmp/npm-cache-hht npm run build`。
- 数据库：`server/data/starstack.sqlite`（WAL）。

---

## 八、审计与验证工具（重要）

- **`npm run audit` / `audit:light` / `audit:dark` / `audit:custom`** → `scripts/audit.mjs`：headless Chrome CDP 遍历 9 个核心页面×双主题，逐文字元素算对比度（<4.5 违规），报告存 `.audit/`，退出码 0/1。**B 级以上改动必跑**。
- **CDP 手动验证流程**（本环境 Chrome headless `--screenshot` 会挂起，不能用）：
  1. 启动：`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --no-sandbox --user-data-dir=/tmp/chrome-cdp --remote-debugging-port=9222 --disable-crash-reporter about:blank &`
  2. Node 用 WebSocket 连 `http://127.0.0.1:9222/json` 的 page target，`Runtime.evaluate` 取 getComputedStyle / rect。
  3. **登录注入**：先在公开页（如 /oj/list）`localStorage.setItem('starstack_token', TOKEN)` + `location.reload()`，再 navigate 到需登录页（token 从 `curl -X POST /api/login -d '{"id":"astro01","password":"12345678"}'` 获取）；每条 bash 命令独立 shell，token 需在本命令内重新获取。
  4. 伪类验证：`CSS.enable` + `DOM.getDocument` + `DOM.querySelector` + `CSS.forcePseudoState(nodeId, ['hover'])` + `CSS.getComputedStyleForNode`。
- 本机沙箱无法运行 Chrome 截图/长时间 headless（virtual-time-budget 挂起），一律用 CDP evaluate 取计算样式。

---

## 九、历史事故与教训（防止复发）

1. **浅色全站亮色字**：App.css `:root` 硬编码 legacy 变量（`--text: #f4f8ff` 等）为深色值，light 块未覆盖 → 修复：tokens light 块补 legacy 映射。**教训：改主题系统必须双主题全页面审计**。
2. **首页卡片边框消失**：App.css 超长 hover 组含裸 `button:hover` + `!important`，用 `--hover-calm`（白值，light 无覆盖）盖掉按钮 hover 边框 → 修复：light 补 `--hover-calm` 深色值 + portal-card `!important`。**教训：交互样式必须分别验证 button 与 a；写新规则前查层叠全链**。
3. **私信输入框看不见**：全局锁滚动 + flex 链压缩高度 → 修复：body 滚动 + flex `1 0 auto` + `flex-shrink: 0`。**教训：锁滚动结构是高度事故温床**。
4. **顶栏随滚轮运动**：`.app { backdrop-filter: blur(10px) }` 劫持 fixed 包含块 → 删除。**教训：fixed 元素"随滚动"优先怀疑祖先 transform/filter/backdrop-filter/will-change/contain**。
5. **/chat/dm 列表被裁**：chat-hub 固定高度 + flex 压缩 + overflow hidden → 修复：`chat-hub:has(.message-list-page)` 高度自适应。**教训：嵌套子路由页面可能被父布局容器裁剪**。
6. **streak 只算 1 天**：`current_streak` 只赋一次 + UTC 解析日期错一天 → 修复。
7. **难度徽标变灰**：可读性覆盖组误伤彩色语义色 → 修复：难度单独彩色覆盖。**教训：语义色只加深不抹色**。
8. **侧边栏反复返工 4 轮** → 立"开发前讨论制度"。**教训：先讨论清楚再动手，不要急着写代码**。

---

## 十、下一步方向（与用户确认过的路线）

1. **审查制度**：已落地（audit 工具 + DEVELOPING.md）。
2. **每日一题 + AC 连击**：✅ 已完成。
3. 待讨论/开发：周赛/限时赛、热榜、月度编程报告（Spotify Wrapped 风分享卡）、品牌落地页 + SEO meta、测试体系扩充、错误监控。

---

## 十一、用户偏好（重要）

- 高级纯色设计（**禁渐变**）、动效克制、线性 SVG 图标（lucide-react）。
- 浅色反馈必须"变深"，暗色反馈"变亮"，参考 luogu 等成熟站点。
- 聊天页/列表页参考洛谷布局（消息区大、输入区小）。
- 移动端优先级低（"看着办/不在考虑范围"）。
- 站内导航：**列表/首页进入详情开新标签页**（OJ 热门/最近AC/继续/随机/题库行/每日一题、广场帖子、首页 OJ 项目卡），主流程（Quick Jump、筛选、分页、发帖、编辑、聊天/私信、首页社区入口）仍同标签；外部链接新标签。
- **先讨论后开发**（DEVELOPING.md 零章）。
- 用户对反复返工零容忍（"再出错就换 codex"），交付前务必真实渲染验证。
