# StarStack 下一阶段详细开发文档

> 文档状态：开发执行版（已按本机代码同步）
>
> 版本：v1.1
>
> 编写日期：2026-08-29
>
> 适用项目：StarStack（星栈）
>
> 本文档是 StarStack 当前版本及下一阶段开发的执行依据。它覆盖网站内容、页面美化、负载降低、后端优化和安全防护五个方向，并规定实现顺序、接口边界、数据约束、测试方法和生产发布门禁。

> 最新执行状态（2026-08-29）：Phase 1～3 的核心闭环已完成；Phase 4 已完成队列公平调度与资源配额、SQLite busy timeout/关键索引、兼容游标分页、HttpOnly Cookie 增量会话与 CSRF 来源校验、备份一致性与数据库结构核验、评测输入资源上限、聊天/社交并发边界和身份装饰同步；Phase 5 已完成本机 lint、78 个单元测试、生产构建、API Smoke Test、数据库完整性检查和 `git diff --check`。已落地评测反馈闭环、只读相近题目接口、练习 Rating 展示和排行榜入口；本批继续新增题目内容元数据与质量状态，采用 7 个兼容字段和 1 个索引，不删除或重写历史题目、提交和用户数据。学习路径页面、筛选、详情上下文和公开 API 已移除，旧数据库中的路径表保留为不再使用的兼容数据。练习分暂不等同于正式比赛分，正式赛事与赛后 Rating 结算仍单独规划。保留依赖审计中暂时没有上游修复版本的 High 条目，后续按依赖发布单独升级。

## 本机状态同步（2026-08-29）

### 已确认可用

- 题库服务端分页、搜索、难度、标签和已解决筛选；
- 题目详情中的相近题目推荐；
- 样例运行、正式提交、排队、取消、SSE 断线后的轮询恢复和评测结果反馈；
- 登录失效处理、请求超时/取消、HttpOnly Cookie 增量会话和 Cookie 请求来源校验；
- 头像框、头像叠加层、称号和身份展示同步；
- 统一加载/错误/空状态、Toast、全局错误边界、键盘弹窗行为和低性能/减少动效模式；
- 练习 Rating：数据库继续保存原有难度权重，接口和页面以 1000 为展示基线；
- 排行榜入口、总榜/周榜/月榜以及个人主页练习 Rating 卡片和走势；
- 题目知识点、解题技巧、预计用时、适合人群、质量状态、题解状态和修改说明的兼容存储、编辑及管理筛选；
- 题目详情展示知识点、技巧和预计用时；
- SQLite 迁移、备份、完整性检查、评测队列资源限制、健康检查和生产发布脚本。

### 当前仍未完成

- 正式赛事系统：赛事创建、报名、赛中榜单、赛后结算和独立竞赛 Rating；
- 题目内容治理的完整闭环：元数据字段和基础质量筛选已完成，仍缺题目举报、覆盖补齐和高质量题解协作；
- 完整真实用户性能指标：LCP、INP、CLS、接口 p95、队列等待时间和 Node 内存趋势；
- 聊天超长历史的虚拟化或更严格的可见区域渲染；
- 全接口 BOLA/IDOR、安全沙箱逃逸矩阵和资源滥用的持续自动化回归；
- 生产环境本次本机改动尚未执行新的推送和部署，必须通过发布门禁后再发布。

### 本机验证记录

```text
npm run lint                 通过
npm test -- --run            78 个测试通过
npm run build                通过
SMOKE_BASE_URL=http://127.0.0.1:5174 npm run test:smoke 通过
git diff --check             通过
```

---

## 1. 文档目标

StarStack 当前已经不是单纯的题库页面，而是一个包含以下能力的全栈 OJ 平台：

- 账号注册、登录、邮箱验证、资料编辑和会话管理；
- 题库、题目详情、在线 IDE、样例运行、自定义测试和正式提交；
- C++17、Python 3、Java 17 编译运行和评测队列；
- 提交记录、评测状态流、排队、取消和服务重启恢复；
- 讨论、评论、题解、聊天、聊天室、私信、通知和社交关系；
- 用户等级、成就、热力图、排行榜、刷题计划；
- 头像框、头像叠加层、等级称号和荣誉称号；
- 管理员用户管理、题目管理、举报处理、审计日志和系统看板；
- SQLite、PM2、Nginx、HTTPS、数据库备份、健康检查和评测沙箱。

下一阶段的目标不是继续横向堆积功能，而是把这些能力连接成稳定的核心闭环：

```text
发现题目
  ↓
理解知识点和推荐信息
  ↓
编写代码并运行样例
  ↓
提交评测
  ↓
获得清晰结果和下一步操作
  ↓
查看讨论、知识点或题解
  ↓
积累学习进度、成就和装饰
  ↓
继续完成下一道题
```

---

## 2. 当前基线和现状判断

### 2.1 当前技术结构

| 层次 | 当前技术和文件 | 当前状态 |
|---|---|---|
| 前端入口 | `src/App.tsx`、`src/main.tsx` | 已完成主要页面拆分，保留应用壳、路由和全局认证状态 |
| 前端页面 | `src/pages/` | OJ、个人主页、聊天、私信、管理员、讨论等页面已经独立 |
| 前端组件 | `src/components/` | 已有 UI、Toast、LoadingState、ErrorState、IconButton、IDE、聊天和装饰组件 |
| 前端请求 | `src/utils.ts` | 已有 Bearer Token、超时、AbortController、网络错误和 401 处理 |
| 前端加载 | `src/utils/routePreload.ts` | 已有页面懒加载和部分路由预加载 |
| 后端入口 | `server/index.js` | Express 5，统一挂载认证、OJ、讨论、聊天、管理员等路由 |
| 后端控制器 | `server/controllers/` | 已按认证、用户、题目、提交、聊天、消息、管理员等模块拆分 |
| 评测系统 | `server/judge.js`、`server/sandbox.sh` | 已有编译缓存、预热、限时、资源限制和 Linux 沙箱 |
| 评测调度 | `server/utils/executionQueue.js`、`server/controllers/submissionsController.js` | 已有运行队列、提交队列、容量上限、取消和重启恢复 |
| 数据库 | `server/db.js`、`server/migrate.js` | SQLite WAL、迁移、索引、完整性检查和历史数据兼容已经存在 |
| 生产运行 | PM2 + Nginx + SQLite | 已按 `xingzhan.cc` 的生产结构部署 |
| 安全基础 | `SECURITY.md` | 已有 CSP、HSTS、输入限制、限流、SSE 上限、推送域名白名单和沙箱检查 |

### 2.2 现阶段已经具备、无需重复开发的能力

以下能力已经存在，下一阶段只需要完善，不要重新设计一套平行实现：

- 题库服务端分页；
- 聊天历史 `before` 游标加载；
- 私信和通知分页；
- 评测队列最大并发和最大排队数量；
- 提交持久化后再进入评测；
- 评测 SSE 断开后的轮询恢复；
- 个人主页装饰字段和 `DecoratedAvatar`；
- 右上角 Toast 反馈；
- 全局错误边界；
- 弹窗焦点锁定、Esc 关闭和焦点恢复；
- 浅色、深色和减少动效模式；
- 数据库迁移和备份流程；
- 生产健康检查、PM2、Nginx 和静态资源检查。

### 2.3 当前真正值得投入的缺口

1. 相近题目入口已经存在，但题目知识点覆盖和内容质量仍需要持续建设。
2. 评测结果已经提供下一步操作，后续应继续提升失败分类、题解/讨论关联和推荐衔接。
3. 页面已经有统一组件，但仍需要逐页做视觉密度、状态反馈、移动端和无障碍回归。
4. 前端已经做了懒加载、分页和请求取消，但尚未建立完整的性能预算、真实用户指标和长列表治理体系。
5. 评测队列和资源限制已经落地，后续需要继续完善队列观测、独立 worker 演进和故障演练。
6. HttpOnly Cookie 已作为增量会话接入，Bearer Token 仍为兼容方案；后续需要评估逐步降低对 `localStorage` 的依赖。
7. 需要将对象级权限、沙箱逃逸、资源滥用和生产恢复演练纳入常规发布门禁。
8. 练习 Rating 已完成展示闭环，正式竞赛 Rating 必须建立独立赛事数据和结算规则，不能直接复用练习分。

---

## 3. 设计原则和优先级

### 3.1 总体原则

1. 不改变星空视觉的品牌方向，但减少无意义的发光、缩放和高开销动画。
2. 不改变已有路由语义、题目历史、提交历史、用户数据和荣誉数据。
3. 新增数据必须通过幂等迁移完成，禁止删除或重置现有数据库。
4. 先提高做题和学习闭环，再考虑赛事、充值和大型运营功能。
5. 评测系统的稳定性、安全性优先于短期页面炫技。
6. 所有性能优化必须有指标，不以“感觉变快”作为唯一依据。
7. 所有安全优化必须有测试，不以“加一个中间件”作为完成标准。
8. 保持现有 React Router、Monaco、Express、SQLite 和 PM2 技术体系。

### 3.2 优先级定义

#### P0：下一次正式发布前必须完成

- 会影响数据安全、账号安全、评测正确性、生产稳定性和严重用户体验的问题。
- 没有完成时，不建议继续增加依赖这些基础能力的新功能。

#### P1：本阶段核心交付

- 能明显提升做题体验、内容发现、页面一致性和服务器资源利用率的功能。

#### P2：后续增强

- 需要较多内容运营、数据积累或多实例基础设施支持的功能。

---

# 第一部分：网站内容建设

## 4. 内容目标

把题库从“可以搜索的题目列表”升级为“可以持续学习的题目系统”。

核心目标：

- 用户能快速找到适合自己的题目；
- 用户知道为什么推荐这道题；
- 用户遇到错误后能看到清晰的结果反馈和下一步操作；
- 用户能按照知识体系逐步学习；
- 用户可以从题目进入讨论、提示和题解；
- 出题者和管理员可以保证题目质量；
- 成就和装饰反映真实学习行为，而不是只反映登录或刷屏次数。

Codeforces 采用难度和标签帮助用户筛选题目，同时将题库、比赛、Rating 和训练场景连接起来；AtCoder 的比赛页面则把题目、澄清、提交结果、成绩、题解和讨论放在同一个上下文中。这些做法适合借鉴其信息组织方式，但不应复制其题面、题库内容或品牌设计。[Codeforces Problemset](https://codeforces.com/problemset?lang=en&locale=en)、[AtCoder Contest 页面](https://atcoder.jp/contests/abc449)

## 5. 题目元数据体系

### 5.1 推荐字段

现有题目字段继续保留，新字段全部采用可选或兼容默认值：

| 字段 | 类型 | 说明 |
|---|---|---|
| `topic_tags` | JSON 或关联表 | 数组、字符串、图论、动态规划等知识点 |
| `technique_tags` | JSON 或关联表 | 前缀和、二分、贪心、单调栈等技巧 |
| `prerequisite_ids` | 关联表 | 推荐先掌握的题目或知识点 |
| `estimated_minutes` | INTEGER | 预计独立完成时间 |
| `learning_stage` | TEXT | 入门、基础、进阶、提高 |
| `recommended_for` | TEXT | 新手、基础巩固、竞赛热身等 |
| `quality_status` | TEXT | 未检查、已自测、审核中、已确认 |
| `hint_count` | INTEGER | 当前题目提示数量 |
| `editorial_status` | TEXT | 无题解、草稿、已发布 |
| `revision_summary` | TEXT | 最近一次题面或测试点修改说明 |

### 5.1.1 已确认的五层难度标准

StarStack 后续面向用户的题目难度统一为五层，不再新增七层或各页面自行解释的难度体系：

| 难度 ID | 显示名称 | 语义颜色 | 使用场景 |
|---|---|---|---|
| `simple` | 简单 | 绿色 | 基础语法、简单模拟、直接计算 |
| `medium` | 中等 | 黄色 | 基础算法、常见数据结构、简单综合 |
| `challenging` | 较难 | 橙色 | 多知识点结合、需要选择算法 |
| `difficult` | 困难 | 淡红色 | 复杂算法、较高实现和思维要求 |
| `extreme` | 极难 | 深红色 | 高级算法、综合竞赛训练和高难度挑战 |

颜色必须使用主题 Token，而不是散落在页面中的硬编码颜色：

```text
--ss-difficulty-simple
--ss-difficulty-medium
--ss-difficulty-challenging
--ss-difficulty-difficult
--ss-difficulty-extreme
```

浅色和深色主题可以使用不同的明度、边框和背景透明度，但必须保持以下语义不变：

```text
简单 → 绿色
中等 → 黄色
较难 → 橙色
困难 → 淡红色
极难 → 深红色
```

显示名称、API 值和 CSS 类名必须分离。推荐使用 `difficultyKey` 作为稳定值，使用 `difficultyLabel` 作为中文显示文本，使用 `difficultyColorToken` 作为主题颜色引用。禁止直接把中文显示文本拼接为 CSS 类名。

### 5.1.2 旧难度值兼容映射

当前数据库和历史接口中仍可能存在旧的洛谷式难度值。迁移时不得直接删除或覆盖历史题目、提交和统计数据，先通过兼容映射转换为五层标准：

| 历史值 | 五层标准 |
|---|---|
| `入门` | `simple` |
| `普及-` | `simple` |
| `普及` | `medium` |
| `普及+` | `challenging` |
| `提高-` | `challenging` |
| `提高` | `difficult` |
| `提高+` | `difficult` |
| `省选` | `extreme` |
| `noi` / `NOI` | `extreme` |
| `国集` | `extreme` |

兼容阶段要求：

- 原始 `difficulty` 字段暂时保留，供历史提交和旧接口使用；
- 新增可选的标准化难度字段或映射层，不在首次迁移中重写历史统计；
- 新建题目只能选择五层标准；
- 旧筛选参数继续可用，并在服务端映射到标准难度；
- 题目列表、题目详情、提交记录、排行榜和管理员页面统一显示五层名称；
- 历史统计按照标准难度归类后，必须与迁移前总题数和总提交数一致；
- 任何未知历史值安全回退到 `medium`，同时写入管理员可见的迁移警告，不得导致接口崩溃。

### 5.2 字段规则

- 难度采用已确认的五层标准：简单、中等、较难、困难、极难。
- 历史 `difficulty` 值在兼容期继续保留，通过服务端映射到 `difficultyKey`。
- 新接口返回稳定的 `difficultyKey`、`difficultyLabel` 和 `difficultyColorToken`。
- `tags` 旧字段继续兼容，新的筛选可以逐步迁移到结构化标签。
- 标签必须来自管理员维护的词表，用户不能随意创造同义词污染分类。
- 一个题目可以有多个知识点，但主知识点最多一个。
- 预计用时只用于推荐，不用于限制用户提交。
- 前置知识只用于提示和推荐，不强制阻止访问题目。
- 题目删除应优先改为下线，不能物理删除已有提交关联的题目。

## 6. 评测反馈内容

### 7.1 统一结果结构

前端统一按以下层级展示：

```text
总体状态
  ├── 总分和通过测试点
  ├── 纯算法耗时
  ├── 内存使用
  ├── 测试点详情
  └── 下一步操作
```

### 7.2 不恢复旧的 Debug Guide 卡片

此前已经删除“Debug Guide”功能。本阶段不重新恢复原卡片，而是在评测结果中提供轻量、可关闭、与具体结果相关的操作：

- 查看失败测试点；
- 重新运行失败样例；
- 打开本次提交代码；
- 查看相关知识点；
- 进入题目讨论。

系统不得直接暴露隐藏测试数据和标准答案。

### 7.3 不同状态的反馈要求

| 状态 | 必须显示 | 可提供操作 |
|---|---|---|
| Queued | 当前排队位置、预计等待提示 | 取消提交 |
| Judging | 当前测试点进度、已运行时间 | 允许时取消 |
| Accepted | 得分、耗时、内存、通过点数 | 查看题解、进入下一道题 |
| Wrong Answer | 失败测试点、输出摘要、通过数量 | 重新运行、打开代码 |
| TLE | 超时测试点、测试点限时 | 查看复杂度提示 |
| RE | 运行时错误类型 | 查看代码、重新运行 |
| CE | 编译器错误摘要 | 返回 IDE |
| Cancelled | 取消原因 | 再次提交 |
| Judge Error | 服务异常，不泄露内部堆栈 | 稍后重试 |

## 8. 题目质量和审核流程

### 9.1 题目状态机

```text
Draft
  ↓
Self Checked
  ↓
Review Pending
  ↓
Published
  ↓
Correction Pending
  ↓
Published
  ↓
Archived
```

### 9.2 发布前检查

- 标题、题面、输入、输出完整；
- 至少一个样例；
- 至少一个正式测试点；
- 测试点输入、输出不为空；
- 单测试点限时在 100ms～3000ms；
- 样例可以通过当前评测引擎运行；
- 难度和主标签已填写；
- 题面中的公式和代码块格式可渲染；
- 不存在危险 HTML；
- 题目编号、slug 和已有题目不冲突。

### 9.3 用户反馈

题目详情页增加“报告题目问题”入口，类型包括：

- 题面错误；
- 样例错误；
- 测试点疑似错误；
- 时间限制不合理；
- 标签不准确；
- 题目无法提交。

管理员处理后必须记录：处理人、处理时间、处理结果和备注。

## 9. 讨论区内容体系

建议把讨论分类为：

- 题目问答；
- 题目提示；
- 题解讨论；
- 题面勘误；
- 学习交流；
- 功能反馈；
- 官方公告。

GitHub Discussions 使用问答、公告、想法、投票和展示等类别，并支持标记答案、置顶、锁定和举报。StarStack 可以借鉴其内容治理模型，而不是单纯增加更多聊天入口。[GitHub Discussions 类别](https://docs.github.com/en/discussions/managing-discussions-for-your-community/managing-categories-for-discussions)、[GitHub 社区管理](https://docs.github.com/en/communities/moderating-comments-and-conversations)

题目讨论应支持：

- 自动关联题目；
- 标记最佳回答；
- 作者或管理员置顶；
- 标记“包含完整答案”；
- 代码块和公式；
- 举报、锁定和删除；
- 展示回答者头像框、称号和荣誉。

## 10. 内容指标

每周至少观察：

- 新用户首次打开题目的比例；
- 题目详情到首次运行样例的转化率；
- 样例运行到正式提交的转化率；
- 首次提交到通过的平均尝试次数；
- 题目推荐点击率和完成率；
- 题目举报率；
- 题目举报处理时长；
- 讨论问题的最佳回答率；
- 用户一周后再次做题比例。

不要把单纯登录次数、聊天消息数和点击次数作为唯一增长目标。

---

# 第二部分：页面美化和体验统一

## 11. 页面视觉目标

保持“星空、深色、轻微发光、技术感”的品牌方向，但将视觉重点从装饰性效果转移到：

- 信息层级；
- 操作反馈；
- 组件一致性；
- 内容可读性；
- 桌面端密度；
- 移动端可操作性。

## 12. 设计 Token 体系

### 13.1 颜色 Token

所有新增 CSS 优先使用现有 `src/styles/tokens.css` 和主题变量：

```text
--ss-bg-page
--ss-bg-surface
--ss-bg-surface-elevated
--ss-text-primary
--ss-text-secondary
--ss-text-muted
--ss-border-subtle
--ss-color-primary
--ss-color-success
--ss-color-warning
--ss-color-danger
--ss-shadow-card
--ss-glow-primary
```

禁止在页面内重复写一套新的蓝色、紫色和透明度。

### 13.2 尺寸 Token

- 页面最大宽度；
- 顶部栏高度；
- 面板间距；
- 输入框高度；
- 小、中、大按钮高度；
- 小、中、大卡片圆角；
- 弹窗最大宽度；
- 内容区内边距；
- 固定头像容器尺寸；
- z-index 层级。

### 13.3 动效 Token

```text
--ss-motion-fast: 180ms
--ss-motion-normal: 240ms
--ss-motion-dialog: 280ms
```

禁止新增 `transition: all`。只允许对颜色、边框、透明度、必要的位移和不影响布局的 transform 做动画。

## 13. 统一 UI 组件

### 14.1 图标按钮

继续使用 `lucide-react` 和现有 `IconButton`。

所有纯图标按钮必须具备：

- `aria-label`；
- 可见或辅助技术可识别的名称；
- hover 提示；
- `:focus-visible` 焦点样式；
- 统一尺寸；
- disabled 状态；
- loading 状态；
- 不因 hover 改变布局尺寸。

内容表情、成就图标和用户主动输入的 emoji 不需要替换为 Lucide 图标。

### 14.2 统一状态组件

统一使用或扩展：

- `LoadingState`：页面级加载；
- `Skeleton`：结构化骨架；
- `EmptyState`：空数据；
- `ErrorState`：错误与重试；
- `Toast`：保存成功、失败和轻量反馈；
- `ConfirmDialog`：危险操作确认；
- `InlineStatus`：列表行级状态。

### 14.3 失败时保留旧内容

刷新请求失败时：

- 不清空已经显示的内容；
- 在内容顶部或局部显示更新失败；
- 提供重试按钮；
- 不把用户正在编辑的内容覆盖掉；
- 请求取消不显示红色错误。

## 14. 顶部栏和弹出菜单

重点处理：

- 搜索图标始终位于按钮中心；
- 私信、通知、主题和用户菜单按钮尺寸一致；
- hover 只影响当前按钮；
- 头像框和叠加层不撑大头像容器；
- 用户菜单不会导致顶部栏抖动；
- 菜单和通知面板不超出视口；
- 375px 宽度下可以访问所有核心入口；
- 管理员用户可以看到管理员面板入口；
- 失效登录后跳转登录页并保留原访问路径。

## 15. OJ 页面

### 16.1 题库页

桌面端：

- 保持高密度题目列表；
- 搜索、难度、标签、解决状态和分页对齐；
- 题目行 hover 只变背景；
- 标签不因内容过长撑破布局；
- 加载时使用题目行骨架；
- 筛选失败时保留上一次结果。

移动端：

- 筛选器进入抽屉或折叠面板；
- 搜索框宽度自适应；
- 难度、标签和通过状态可以换行；
- 分页按钮不挤压题目标题；
- 不出现横向滚动页面。

### 16.2 题目详情和 IDE

桌面端：

- 题面和 IDE 有明确层级；
- IDE 工具栏的语言、运行、提交按钮不互相挤压；
- 输入输出区高度稳定；
- 测试点结果区不因状态切换突然改变整个页面高度；
- 结果区支持明确的收起和展开；
- 提交、样例运行和自定义测试状态互不混淆。

移动端：

- 题面、IDE、输入输出纵向排列；
- 操作按钮在键盘弹出时仍然可见；
- 输出支持横向滚动；
- 编辑器不会把页面撑出不可恢复的宽度；
- 输入框和结果区可以独立滚动。

### 16.3 评测结果

状态结构固定为：

```text
结果状态
→ 得分和通过点数
→ 纯算法耗时和内存
→ 测试点详情
→ 可执行的下一步操作
```

按钮位置和容器尺寸不能随 Accepted、Wrong Answer、TLE 等状态跳动。

## 16. 个人主页和资料中心

个人主页突出三类信息：

### 身份

- 装饰头像；
- 当前称号；
- 等级；
- 简介；
- 关注和社交信息。

### 成长

- 已通过题目；
- Rating；
- 连续打卡；
- 成就和荣誉；
- 题目完成进度；

### 行动

- 继续学习；
- 查看提交记录；
- 编辑资料；
- 管理装饰。

已取消的“最近提交”不重新放回主页，完整提交历史继续由提交记录页面承载。

资料编辑页面中的昵称、头像、邮箱、密码、会话和装饰保存均使用统一右上角 Toast，并保证网络失败、重复点击和页面卸载后按钮不会永久锁定。

## 17. 聊天、私信和管理员页面

### 聊天和私信

- 相邻消息适当合并头像和昵称；
- 自己和他人消息有稳定区分；
- 未读消息有分隔线；
- 长消息、代码块和链接不会撑破气泡；
- 断线、发送失败和重连状态可见；
- 大量消息采用游标加载，超过阈值后考虑虚拟列表。

### 管理员页面

- 表格列在 1024px 宽度下有明确优先级；
- 次要字段折叠或进入详情；
- 操作按钮统一图标和危险色；
- 删除、封禁、重置密码必须二次确认；
- 加载、无数据和错误状态统一；
- 日志、举报和客户端错误不一次性加载无限数据。

## 18. 无障碍和键盘规范

模态弹窗必须：

- 打开后焦点进入弹窗；
- Tab 焦点在弹窗内部循环；
- Esc 关闭；
- 关闭后焦点恢复到触发按钮；
- 弹窗外内容不可操作；
- 使用 `role="dialog"`、`aria-modal="true"` 和可访问名称。

WAI-ARIA 官方将焦点进入、焦点循环、Esc 关闭和焦点恢复列为模态弹窗的核心行为。[WAI-ARIA Dialog Modal](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)

菜单必须支持：

- Enter 或 Space 打开；
- Escape 关闭；
- 方向键移动；
- 焦点始终可见；
- 菜单项有可访问名称；
- 关闭后返回触发菜单按钮。

[WAI-ARIA Menu / Menubar](https://www.w3.org/WAI/ARIA/apg/patterns/menubar/)

## 19. 响应式验收尺寸

### 375px

- 登录、注册、筛题、看题、运行样例、提交代码完整可用；
- 顶部栏不溢出；
- 弹窗不超出视口；
- 键盘弹出时输入区仍可操作。

### 768px

- 平板横向布局稳定；
- OJ 详情不出现极窄双栏；
- 聊天侧栏和内容区有明确折叠策略。

### 1024px

- 管理员表格和 OJ IDE 保持可用密度；
- 顶部栏不挤压主要操作；
- 次要信息可以折叠。

### 1440px

- 页面内容不无限拉伸；
- 主内容区最大宽度稳定；
- OJ 和管理员页面充分利用桌面空间；
- 卡片、表格和结果区间距一致。

---

# 第三部分：负载降低和前端性能

## 20. 性能预算

所有优化以真实指标验证：

| 指标 | 目标 |
|---|---:|
| LCP | 75 分位不超过 2.5 秒 |
| INP | 75 分位不超过 200ms |
| CLS | 75 分位不超过 0.1 |
| 初始 JS 体积 | 不超过当前基线的 110% |
| 普通 API p95 | 不超过 300ms |
| 题库 API p95 | 不超过 500ms |
| 首次题目详情加载 | 不提前加载 Monaco |
| 长聊天列表 | 不因消息数量线性增加 DOM |
| 评测 SSE | 断线后可恢复 |
| Service Worker | 不因旧 chunk 导致白屏 |

LCP、INP、CLS 应同时使用本地实验室测试和真实用户数据观察，实验室结果不能完全替代真实用户数据。[Web Vitals](https://web.dev/articles/vitals?hl=en)、[LCP](https://web.dev/articles/lcp?hl=en)

## 21. 路由懒加载和预加载

### 可以预加载

- 首页到题库；
- 题库到题目详情；
- 聊天中心到私信；
- 用户菜单到个人主页。

### 不提前加载

- Monaco Editor；
- 管理员完整页面；
- 不会被访问的聊天子页面；
- 大型题解编辑器。

### 触发时机

- 桌面端鼠标悬停导航项；
- 用户按下链接时；
- 浏览器空闲时；
- 非 `saveData` 模式。

移动端、低内存、低 CPU 和 `saveData` 用户应减少预加载。

## 22. 请求生命周期治理

每个搜索、筛选、轮询和页面请求都应具备：

- AbortController；
- 页面卸载时取消；
- 同一接口请求去重；
- 请求版本保护；
- 超时；
- 取消不显示错误；
- 过期响应不能覆盖新结果。

典型保护场景：

```text
搜索 A
↓
立即搜索 B
↓
B 先返回并展示
↓
A 后返回时必须被忽略
```

## 23. 轮询和 SSE

- 页面不可见时暂停轮询；
- 恢复可见时立即请求一次；
- 连续失败时指数退避；
- 成功后恢复默认间隔；
- 同一资源不允许并发轮询；
- SSE 断线后使用随机抖动重连；
- 重连失败后切换到轮询；
- 页面卸载时释放 SSE 和定时器；
- 保持总连接数和单用户连接数限制。

## 24. 长列表策略

| 资源 | 第一选择 | 第二选择 |
|---|---|---|
| 题库 | 服务端页码分页 | 主题筛选和搜索索引 |
| 提交记录 | 服务端分页 | `id < lastId` 游标 |
| 通知 | 限定条数和分页 | 时间游标 |
| 私信会话 | 服务端分页 | 搜索后分页 |
| 私信消息 | 分页 | 按会话时间游标 |
| 聊天消息 | `before` 游标 | 虚拟列表 |
| 管理员用户 | 服务端筛选分页 | 导出型后台任务 |
| 审计日志 | 时间游标 | 条件筛选 |
| 热力图 | 时间范围 | 按年份懒加载 |

虚拟列表只用于消息、长表格等确实存在大量 DOM 的场景，不要为了形式把几十条题目也虚拟化。[web.dev 长列表虚拟化](https://web.dev/articles/virtualize-long-lists-react-window)

## 25. 图片和装饰资源

- 所有头像容器固定宽高；
- 图片设置 `loading="lazy"`；
- 图片设置 `decoding="async"`；
- 只有存在叠加层时加载叠加 PNG；
- 失败时退回普通头像和 CSS 边框；
- 上传时限制尺寸、重新编码和删除 EXIF；
- 页面不加载不需要的高清原图；
- 图片加载不会改变列表高度。

## 26. HTTP 和 Service Worker 缓存

### HTML

使用 `Cache-Control: no-cache`，允许浏览器验证最新 HTML。

### 带 hash 的 JS/CSS

使用长期缓存：

```text
Cache-Control: public, max-age=31536000, immutable
```

### 用户 API

以下内容不得被 Service Worker 缓存：

- `/api/me`；
- `/api/notifications`；
- `/api/messages`；
- `/api/chat`；
- `/api/oj/submissions`；
- SSE 和提交接口。

静态资源可以使用版本化缓存，但 HTML 不应长期缓存。带 hash 资源使用 `immutable` 能减少重复验证请求。[MDN HTTP Caching](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching)

### 旧 chunk 恢复

动态 import 失败时：

1. 判断是否为 chunk 加载错误；
2. 尝试等待 Service Worker 更新；
3. 清理旧缓存；
4. 自动刷新最多一次；
5. 仍失败则显示可重试错误页。

## 27. 页面动画

- 动效总时长控制在 180～300ms；
- 避免动画导致布局重排；
- 优先使用 `opacity` 和 `transform`；
- 关闭不必要的阴影和粒子；
- 低性能模式减少星空粒子和大面积模糊；
- 完整支持 `prefers-reduced-motion: reduce`；
- 不让 hover 改变按钮和卡片尺寸。

## 28. 前端性能测试

需要新增或完善：

- 路由 chunk 体积快照；
- 首屏关键资源列表；
- 搜索请求取消测试；
- 题库分页测试；
- 长消息渲染测试；
- Service Worker 版本更新测试；
- 动态 import 失败恢复测试；
- 375px、768px、1024px、1440px 截图回归。

---

# 第四部分：后端优化和容量治理

## 29. 评测队列设计

### 30.1 任务状态

```text
Queued
  ↓
Judging
  ↓
Accepted / Wrong Answer / TLE / RE / CE / Failed
```

取消：

```text
Queued → Cancelled
Judging → 终止沙箱进程组 → Cancelled
Finished → 不允许取消
```

### 30.2 调度规则

- 正式提交优先于样例运行和自定义测试；
- 每用户限制同时运行数量；
- 单用户不能占满所有 worker；
- 队列满时立即返回 `QUEUE_FULL`；
- 保留 FIFO 作为默认顺序；
- 后续增加用户公平调度时，不能让已排队任务永久饥饿；
- 每个任务必须保存排队、开始、结束时间；
- 服务重启后恢复未结束任务；
- 长时间处于 `Judging` 的任务进入异常恢复流程；
- 评测服务不可用时不降级为宿主机直接执行。

### 30.3 队列指标

管理员看板显示：

- 当前运行数；
- 当前排队数；
- 平均排队时间；
- p95 排队时间；
- 平均执行时间；
- 最近 10 分钟失败率；
- 沙箱失败数；
- 按语言统计的执行时间；
- 每用户当前排队数量；
- 恢复任务数和僵尸任务数。

## 30. API 进程和评测进程演进

短期不引入微服务、Redis 或 Kafka。当前 2 核 2G 主机优先保持简单可靠。

### 阶段一：队列模块化

将队列调度拆分为：

```text
server/queue/
  judgeQueue.js
  runQueue.js
  queueState.js
  queueRecovery.js
```

### 阶段二：独立 PM2 worker

```text
starstack-api
starstack-judge
```

API 负责创建和查询任务，Judge Worker 负责消费和执行任务。

只有出现以下情况才进入阶段三：

- 多台服务器；
- 多个评测 worker；
- SQLite 写入明显成为瓶颈；
- 需要跨进程可靠消费；
- 需要复杂优先级和延迟任务。

## 31. SQLite 读写优化

### 32.1 连接和事务

保持：

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
```

建议验证并补充：

```sql
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;
```

WAL 可以让读写并发性更好，但 SQLite 仍然只有一个 writer，长事务会影响 checkpoint 和写入。因此评测结果写入、通知写入和后台清理都必须使用短事务。[SQLite WAL](https://www.sqlite.org/wal.html)

### 32.2 查询计划

所有高频查询使用 `EXPLAIN QUERY PLAN` 验证：

- 题库筛选和排序；
- 用户提交记录；
- 题目提交记录；
- 聊天历史；
- 私信历史；
- 通知未读数；
- 讨论列表；
- 管理员日志；
- 举报列表；
- 排行榜。

### 32.3 索引方向

根据实际查询确认后，优先考虑：

```sql
submissions(user_id, created_at DESC)
submissions(problem_id, created_at DESC)
submissions(status, queue_position, id)
messages(conversation_id, created_at DESC, id)
chat_messages(room_id, id DESC)
chat_messages(channel_key, id DESC)
notifications(user_id, is_read, created_at DESC)
admin_audit_logs(created_at DESC)
reports(status, created_at DESC)
```

不能只因为“看起来应该有索引”就直接增加索引，必须结合查询计划和写入成本验证。SQLite 官方文档指出，合适的索引通常比依赖查询优化器更重要。[SQLite Query Planner](https://www.sqlite.org/queryplanner.html)

### 32.4 减少深层 OFFSET

- 题库继续保留页码分页；
- 提交记录逐步改为 `id < lastId`；
- 聊天继续使用 `beforeId`；
- 通知使用 `(created_at, id)` 游标；
- 管理员日志使用时间游标；
- `COUNT(*)` 只在确实需要显示总数时执行。

## 32. API 规范

### 33.1 成功响应

新接口推荐：

```json
{
  "success": true,
  "data": {},
  "requestId": "req_xxx"
}
```

### 33.2 错误响应

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "请求参数不合法",
    "requestId": "req_xxx"
  }
}
```

迁移期间可以保留顶层 `message` 或 `error` 兼容旧前端。

### 33.3 错误码

```text
AUTH_REQUIRED
AUTH_EXPIRED
FORBIDDEN
NOT_FOUND
VALIDATION_ERROR
RATE_LIMITED
QUEUE_FULL
QUEUE_CANCELLED
JUDGE_UNAVAILABLE
DATABASE_BUSY
INTERNAL_ERROR
```

### 33.4 所有分页接口

必须服务端限制：

- `page >= 1`；
- `pageSize >= 1`；
- `pageSize <= maxPageSize`；
- `limit` 有最大值；
- 搜索关键词有最大长度；
- 不允许客户端通过参数返回无限数组；
- 私有接口不能被公共缓存。

## 33. 请求和运行观测

每个请求记录：

- requestId；
- 方法；
- 路由；
- 状态码；
- 响应时间；
- 用户 ID；
- 可信代理解析后的 IP；
- 错误码。

禁止记录：

- 密码；
- Token；
- 邮箱验证码；
- SMTP 密码；
- VAPID 私钥；
- 完整用户代码；
- 完整私信内容。

## 34. 定时清理和存储控制

清理任务必须分批执行、可重试、可观测：

- 过期 session；
- 过期邮箱验证码；
- 过期登录失败记录；
- 过期客户端错误；
- 过期临时文件；
- 超期聊天数据；
- 已处理举报；
- 过期审计日志；
- 编译缓存。

不得删除：

- 用户；
- 题目；
- 提交历史；
- 历史荣誉；
- 题目修订记录；
- 管理员审计核心记录。

---

# 第五部分：安全防护

## 35. 威胁模型

重点保护对象：

- 用户账号和会话；
- 邮箱和个人资料；
- 题目和测试数据；
- 用户源代码；
- 评测主机和数据库；
- 私信、聊天和举报内容；
- 管理员权限；
- 备份和服务器环境变量。

主要威胁：

- 账号接管；
- XSS；
- CSRF；
- 对象级越权；
- SQL 注入；
- SSRF；
- 资源消耗型 DoS；
- 评测沙箱逃逸；
- 恶意文件上传；
- 依赖供应链风险；
- 备份泄露。

安全发布检查可按 OWASP ASVS 建立，而不是只依赖一次人工代码审查。[OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)

## 36. 会话安全

### 37.1 当前问题

当前前端主要通过 `localStorage` 保存 Bearer Token。实现简单，但如果站点发生 XSS，页面脚本可能读取该 Token。

### 37.2 迁移方案

#### 兼容阶段

- 后端同时接受 HttpOnly Cookie 和旧 Bearer Token；
- 登录、注册和 SSO 成功后设置 Cookie；
- 前端请求逐步改用 `credentials: 'include'`；
- 注销同时清理 Cookie 和旧 Token；
- 旧 Token 设置迁移期限。

#### Cookie 约束

```text
HttpOnly
Secure
SameSite=Lax
Path=/
```

如使用 `__Host-` 前缀，不设置 `Domain`，确保只在当前主机生效。

#### 敏感操作

- 修改密码后注销其他会话；
- 修改邮箱后重新验证；
- 修改管理员权限时重新验证；
- 删除、封禁、重置密码时要求二次确认；
- 管理员高风险操作增加 MFA 或重新输入密码。

OWASP 建议避免把会话 ID 放在 localStorage 中，优先使用 HttpOnly Cookie。[OWASP HTML5 Security](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html)

### 37.3 CSRF

迁移到 Cookie 后，所有状态修改请求必须：

- 校验 Origin；
- 严格限制 CORS；
- 使用 SameSite Cookie；
- 对必要场景增加 CSRF Token；
- 不允许任意来源携带认证凭据。

## 37. 对象级权限测试

必须逐一测试：

- 用户 A 是否能修改用户 B 资料；
- 用户 A 是否能读取用户 B 私信；
- 用户 A 是否能取消用户 B 提交；
- 普通用户是否能读取管理员接口；
- 非作者是否能编辑题目；
- 非管理员是否能修改题目状态；
- 被封禁用户是否还能聊天、评论或提交；
- 举报者是否能修改管理员处理结果。

所有带 `:id`、`:userId`、`:problemId`、`:messageId` 的接口都必须有明确的对象归属检查。

## 38. 评测沙箱防护

### 39.1 文件系统测试

- 读取项目源码；
- 读取 SQLite 数据库；
- 读取 `.env`；
- 读取 PM2 环境；
- 访问 `/proc`；
- 访问宿主机根目录；
- 符号链接逃逸；
- 路径穿越；
- 访问其他用户临时目录。

### 39.2 进程测试

- fork bomb；
- 创建大量线程；
- 创建后台进程；
- 杀死其他评测进程；
- 创建僵尸进程；
- 恶意编译器参数。

### 39.3 网络测试

- 访问公网；
- 访问 `127.0.0.1`；
- 访问 Nginx；
- 访问 Node 端口；
- 访问云主机元数据；
- DNS 外带；
- 访问内网网段。

### 39.4 资源测试

- 无限循环；
- 超大输出；
- 超大文件；
- 超大内存；
- 超多进程；
- 深递归；
- 运行时间超过限制。

必须确保超时能终止整个进程组，输出、内存、CPU、进程数、文件大小和网络均受到限制。沙箱探针失败时必须拒绝执行，不能退回宿主机普通执行。

## 39. 输入、富文本和文件安全

### 40.1 富文本

- 服务端白名单过滤；
- 前端渲染前再次过滤；
- 禁止 `javascript:`；
- 禁止协议相对地址；
- 禁止事件属性；
- 代码块转义；
- 外链使用 `noopener noreferrer`；
- 公式渲染不能直接执行 HTML。

XSS 的核心风险是用户控制内容被当作代码执行，必须结合输入校验、输出编码和上下文相关过滤。[OWASP XSS](https://owasp.org/www-community/attacks/xss/)

### 40.2 头像上传

- 检查真实 MIME；
- 限制文件大小；
- 限制宽高；
- 重新编码；
- 删除 EXIF；
- 禁止危险 SVG；
- 使用随机文件名；
- 不允许用户控制保存路径；
- 图片处理失败时不覆盖旧头像。

### 40.3 SSRF

- 不开放通用 URL 代理；
- 用户提供的 URL 不能被服务器任意请求；
- 推送 endpoint 继续使用域名白名单；
- 禁止跟随重定向到内网；
- 禁止访问 localhost、环回地址、内网地址和云元数据地址；
- 需要服务端请求时采用明确 allowlist。

SSRF 可能被用来访问内网服务、服务器配置和云元数据。[OWASP SSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)

## 40. 资源滥用和限流

OWASP API4:2023 将无限制资源消耗列为 API 风险，限制范围不仅是请求次数，也包括执行时间、内存、文件、返回条数、进程数和第三方服务调用。[OWASP API4:2023](https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/)

需要单独限流的接口：

| 接口类型 | 限制维度 |
|---|---|
| 登录 | IP + 账号 |
| 注册 | IP + 邮箱 |
| 邮箱验证码 | IP + 邮箱 + 时间窗口 |
| 样例运行 | 用户并发数 |
| 自定义测试 | 用户并发数 + 运行时间 |
| 正式提交 | 用户排队数 + IP |
| 发帖和评论 | 用户 + IP + 冷却时间 |
| 私信 | 发送者 + 接收者 |
| 聊天 | 用户频率 + 内容长度 |
| 搜索 | 关键词长度 + 频率 |
| 头像上传 | 用户频率 + 文件大小 |
| 举报 | 用户频率 |

限流状态应返回 `429`、明确错误码和必要的 `Retry-After`，前端显示可理解的等待提示。

## 41. CSP、TLS 和依赖安全

- 保持 HTTPS；
- 保持 HSTS；
- 保持 `nosniff`；
- 保持 frame 限制；
- CSP 先 Report-Only 收集误报，再逐步收紧；
- 尽量减少 `unsafe-inline`；
- Node 5174 只监听本机；
- 防火墙只开放必要端口；
- 使用 lockfile 和 `npm ci`；
- 每次发布执行依赖审计；
- 出现 Critical 时禁止发布；
- 不使用 `npm audit fix --force` 破坏当前依赖兼容性；
- 记录暂时没有上游修复版本的依赖风险。

## 42. 备份与服务器安全

- 生产 SQLite 备份前先保证一致性；
- 备份后执行完整性检查；
- 定期进行真实恢复演练；
- 备份目录权限最小化；
- 数据库、WAL、SHM 和私钥权限为最小可读；
- 密码、SMTP、Turnstile、VAPID 等密钥不进仓库；
- PM2 评测服务使用非 root 用户；
- Nginx 反向代理后端，不直接暴露 Node 端口；
- 日志滚动，避免磁盘被写满；
- 监控磁盘、内存、队列和备份状态。

---

# 第六部分：实施顺序

## 43. Phase 0：基线、测试和观测

优先级：P0

### 工作项

1. 记录当前构建产物大小和 chunk 列表。
2. 记录首页、题库、题目详情、聊天和管理员页面的 Web Vitals 基线。
3. 增加 requestId 和结构化日志。
4. 统一错误码和错误响应兼容层。
5. 补充评测队列状态、恢复、取消和异常测试。
6. 补充对象级权限测试。
7. 使用 `EXPLAIN QUERY PLAN` 检查高频 SQL。
8. 检查 Service Worker 版本更新和旧 chunk 恢复。
9. 建立 375px、768px、1024px、1440px 页面回归清单。

### 退出标准

- 任何后续优化都可以用基线比较；
- 测试失败能够定位到接口、页面或队列阶段；
- 生产问题有 requestId 可追踪；
- 评测失败不会导致按钮永久锁死或页面白屏。

## 44. Phase 1：OJ 内容和学习闭环

优先级：P0/P1

### 工作项

1. 实现五层难度元数据和旧值兼容映射。
2. 新建题目和编辑题目只显示“简单、中等、较难、困难、极难”。
3. 题库、题目详情、每日一题、刷题计划、提交记录、个人主页和管理员页面统一使用五层难度标签。
4. 规范题目知识点和技巧标签。
5. 增加题目推荐和内容质量提示。
6. 优化评测结果状态和下一步操作。
7. 增加题目问题举报。
8. 讨论区增加题目问答和最佳回答。
9. 将做题完成和知识点掌握接入成就系统。

### 退出标准

- 新用户能够从题库进入下一道合适的训练题；
- 提交结果能够引导用户继续行动；
- 现有提交、成就和用户数据不受影响。

## 45. Phase 2：页面视觉和交互统一

优先级：P1

### 工作项

1. 统一图标按钮和 tooltip。
2. 统一骨架、空状态、错误状态和重试按钮。
3. 检查顶部栏、菜单、通知和管理员入口。
4. 优化题库、题目详情、IDE 和提交结果。
5. 优化个人主页、资料编辑和装饰预览。
6. 优化聊天、私信和管理员表格。
7. 补全焦点、弹窗、菜单和键盘操作。
8. 完成四种窗口尺寸和两种主题回归。

### 退出标准

- 核心流程没有布局跳动和横向溢出；
- 所有关键操作都有成功、失败、加载和空状态；
- 键盘可以完成登录、筛题、提交、弹窗和资料编辑。

## 46. Phase 3：前端负载降低

优先级：P1

### 工作项

1. 控制路由预加载，只预加载高概率页面。
2. 保证 Monaco 只在进入 IDE 后加载。
3. 统一搜索、筛选、轮询和 SSE 的取消/重连。
4. 检查所有长列表分页和游标策略。
5. 对聊天长列表引入虚拟化评估。
6. 头像和装饰资源懒加载、异步解码和固定尺寸。
7. 更新 Service Worker 缓存版本和旧资源恢复。
8. 配置 HTML、静态 hash 资源和 API 的缓存策略。
9. 比较构建产物，不能超过当前基线 10%。

### 退出标准

- 首屏 JS 没有明显膨胀；
- 搜索和筛选没有过期响应覆盖；
- 长聊天不会随历史消息无限增加 DOM；
- 新部署不会因旧 Service Worker 白屏。

## 47. Phase 4：后端、队列和安全收口

优先级：P0/P1

### 工作项

1. 队列增加公平性、资源配额和完整时间指标。
2. 完善僵尸任务和重启恢复。
3. 检查 SQLite `busy_timeout`、短事务和高频索引。
4. 将深层 OFFSET 改为游标分页。
5. 建立管理员监控指标。
6. 规划并实现 HttpOnly Cookie 会话迁移。
7. 完成全接口 BOLA/IDOR 测试。
8. 完成沙箱逃逸矩阵。
9. 完成上传、XSS、CSRF、SSRF 和资源滥用测试。
10. 完成依赖审计、备份恢复和生产权限检查。

### 退出标准

- 用户代码不能绕过沙箱；
- 普通用户不能越权访问管理员或他人私有资源；
- 高成本接口都有资源和频率限制；
- 数据库迁移、备份、恢复和发布流程可重复执行。

## 48. Phase 5：统一发布

优先级：P0

发布前：

```bash
npm run lint
npm test -- --run
npm run build
npm run test:smoke
npm run db:verify
npm run audit:deps
git diff --check
```

如果新增测试或脚本，还要执行：

```bash
npm run test:release
npm run audit:light
npm run audit:dark
```

生产发布顺序：

1. 检查工作区差异。
2. 确认没有无关用户修改被覆盖。
3. 备份生产 SQLite。
4. 验证备份完整性。
5. 拉取已经验证的提交。
6. 安装锁定依赖。
7. 执行幂等数据库迁移。
8. 构建并同步静态文件。
9. 重载 PM2。
10. 检查 Nginx 配置并 reload。
11. 验证 `/api/health`。
12. 验证静态资源版本、登录、资料、装饰和提交接口。
13. 观察日志和队列一段时间后再确认发布完成。

---

# 第七部分：测试与验收

## 49. 单元测试

必须覆盖：

- 题目标签和完成进度；
- 五层难度映射、颜色 Token 和未知旧值回退；
- 评测队列 FIFO、容量、用户配额和取消；
- 评测状态机；
- 装饰解锁和非法装备；
- 错误码映射；
- 分页参数边界；
- 请求取消和过期响应保护；
- HTML 白名单和危险链接；
- 头像 MIME 和大小校验；
- Cookie、CSRF 和权限判断。

## 50. API 回归测试

### 认证

- 注册、登录、登出；
- 失效会话返回 401；
- 失效后前端跳转并保留路径；
- 邮箱验证码限流；
- 修改密码后旧会话失效。

### OJ

- 题库筛选和分页；
- 题目详情；
- 样例运行；
- 自定义测试；
- 正式提交；
- 排队；
- 取消；
- SSE 断线后轮询；
- 评测失败恢复；
- 单测试点限时 100ms～3000ms。

### 内容

- 题目举报；
- 讨论最佳回答；
- 管理员审核。

### 权限

- 普通用户访问管理员接口被拒绝；
- 非作者不能编辑题目；
- 用户不能查看他人私信；
- 用户不能取消他人提交；
- 被封禁用户不能继续执行受限操作。

## 51. 浏览器回归

### 桌面端

- 1024px；
- 1440px；
- 浅色主题；
- 深色主题；
- 减少动效模式；
- 键盘操作；
- 断网后重试；
- Service Worker 更新。

### 移动端

- 375px；
- 768px；
- 登录注册；
- 题库筛选；
- 题目详情；
- IDE 输入；
- 样例运行；
- 提交结果；
- 聊天和私信；
- 弹窗和软键盘遮挡。

## 52. 性能回归

- 构建产物不能超过基线 10%；
- 检查路由 chunk；
- 检查首屏 LCP、INP、CLS；
- 检查题库 API p95；
- 检查聊天历史接口；
- 检查管理员列表接口；
- 检查评测队列等待时间；
- 检查 Node 内存是否持续上涨；
- 检查 SQLite WAL 和锁等待；
- 检查 Service Worker 是否缓存 API。

## 53. 安全回归

- SQL 注入；
- XSS；
- CSRF；
- BOLA/IDOR；
- SSRF；
- 路径穿越；
- 恶意上传；
- 无限输出；
- fork bomb；
- 内存耗尽；
- 编译超时；
- 运行超时；
- 连接数耗尽；
- 请求体超限；
- 分页参数滥用；
- 登录和验证码暴力尝试；
- 管理员越权；
- 备份权限和恢复完整性。

---

# 第八部分：暂不开发内容

以下功能暂不纳入本阶段：

- 充值、余额和支付；
- 正式赛事和竞赛 Rating 结算系统（练习 Rating 展示已完成，竞赛分仍需独立设计）；
- 多节点分布式评测；
- Redis、Kafka 等新基础设施；
- AI 自动批改题解；
- 用户自定义 CSS 和任意头像特效；
- 无限聊天历史一次性加载；
- 复杂好友关系链；
- 大规模视觉重设计；
- React Router、Monaco 或整体技术栈替换。

原因是这些内容会显著增加数据模型、运维和安全复杂度，但无法优先解决当前的学习闭环、评测稳定、页面一致性和安全边界问题。

---

# 第九部分：开发规范

## 54. 前端规范

- React 页面组件继续放在 `src/pages/`；
- 可复用组件放在 `src/components/`；
- API 请求统一使用 `fetchJson`；
- 纯图标按钮统一使用 `IconButton`；
- 页面必须处理 loading、empty、error 和 retry；
- 新增请求必须考虑 AbortController；
- 新增页面必须验证 375px、768px、1024px、1440px；
- 新增动效必须支持 `prefers-reduced-motion`；
- 禁止 `transition: all`；
- 不重复定义主题颜色。

## 55. 后端规范

- API 路径统一使用 `/api/`；
- SQL 必须参数化；
- 新字段通过兼容迁移增加；
- 不在请求中执行不受限 CPU 任务；
- 用户代码必须进入沙箱；
- 管理员操作必须有权限检查和审计；
- 错误响应不泄露堆栈、路径、环境变量和 SQL；
- 分页和数组返回必须有服务端上限；
- 长连接必须有总数和单用户上限。

## 56. Git 和发布规范

提交格式：

```text
    feat: 添加题目推荐能力
fix: 修复评测结果状态覆盖问题
perf: 优化聊天历史游标分页
refactor: 拆分评测队列模块
test: 增加对象级权限回归测试
docs: 更新生产发布说明
security: 加固会话和上传校验
```

一次提交尽量只包含一个清晰主题。发布前不执行破坏性 reset、clean 或数据库删除操作。

---

# 第十部分：当前版本后的开发队列

前面的基础收口已经完成。后续开发按下面的顺序推进，每一批完成并通过回归后再进入下一批：

## 第一批：题目内容质量和学习闭环增强

1. 补齐题目知识点、技巧标签、预计用时和适用人群的管理能力；
2. 在管理员端增加题目质量状态、测试点检查、题面修改记录和发布前校验；
3. 增加题目问题举报及管理员处理闭环；
4. 将题解、讨论、相近题目和完成进度串联到评测结果页；
5. 评估把做题完成和知识点掌握接入成就，但不改变已有成就规则。

## 第二批：前端性能和真实体验指标

1. 建立首页、题库、题目详情、IDE、聊天和管理员页面的 LCP、INP、CLS 基线；
2. 记录题库、聊天、管理员列表和评测队列的接口 p50/p95；
3. 继续治理聊天历史、通知、活动和管理列表的长列表渲染；
4. 检查 Service Worker 更新、旧 chunk 恢复、静态缓存和移动端弱网重试；
5. 对 375px、768px、1024px、1440px 做可复现的截图和键盘回归。

## 第三批：安全与生产稳定性收口

1. 完成全接口 BOLA/IDOR 测试矩阵；
2. 完成编译、进程、文件系统、网络和资源限制的沙箱逃逸矩阵；
3. 增加登录、验证码、提交、聊天、上传和搜索等高成本操作的滥用回归；
4. 演练数据库备份恢复、PM2 重启、队列异常恢复和静态资源版本切换；
5. 将测试报告、健康检查、备份完整性和关键日志纳入正式发布记录。

## 第四批：正式赛事和竞赛 Rating

只有前三批稳定后才开始设计：

1. 独立的赛事、赛题、报名、赛中提交和排行榜数据模型；
2. 明确封榜、罚时、重测、作弊处理和赛后复核规则；
3. 竞赛 Rating 与练习 Rating 分离，提供可解释的赛后变化记录；
4. 先做只读赛事列表和单场内部测试，再逐步开放公开赛事。

本队列不包含充值、复杂社交扩张或大规模视觉重设计。所有新增功能必须保持已有用户、题目、提交、荣誉和装饰数据兼容。

---

# 参考资料

## OJ 和学习产品

- [Codeforces Problemset](https://codeforces.com/problemset?lang=en&locale=en)
- [Codeforces Contests](https://codeforces.com/contests/?locale=en)
- [AtCoder Contests](https://atcoder.jp/contests?lang=en)
- [AtCoder Contest Detail](https://atcoder.jp/contests/abc449)
- [洛谷题库](https://www.luogu.com.cn/problem/list)
- [洛谷训练列表](https://www.luogu.com.cn/training/list)
- [LeetCode Study Plan](https://leetcode.com/studyplan/)
- [Exercism FAQ](https://exercism.org/docs/using/faqs)
- [Exercism Unlocking Exercises](https://exercism.org/docs/building/product/unlocking-exercises)

## 社区和内容治理

- [GitHub Discussions 关于](https://docs.github.com/en/discussions/collaborating-with-your-community-using-discussions/about-discussions)
- [GitHub Discussions 类别](https://docs.github.com/en/discussions/managing-discussions-for-your-community/managing-categories-for-discussions)
- [GitHub 社区管理和审核](https://docs.github.com/en/communities/moderating-comments-and-conversations)

## 前端、缓存和性能

- [React lazy](https://react.dev/reference/react/lazy)
- [Vite Features](https://vite.dev/guide/features.html)
- [Vite Performance](https://vite.dev/guide/performance.html)
- [Vite Troubleshooting](https://vite.dev/guide/troubleshooting.html)
- [Web Vitals](https://web.dev/articles/vitals?hl=en)
- [Web Vitals Tools](https://web.dev/articles/vitals-tools)
- [MDN AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)
- [MDN Intersection Observer](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API)
- [MDN HTTP Caching](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching)
- [web.dev 长列表虚拟化](https://web.dev/articles/virtualize-long-lists-react-window)

## 后端和数据库

- [Express 生产性能与可靠性](https://expressjs.com/en/advanced/best-practice-performance/)
- [Node.js 不要阻塞事件循环](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop)
- [SQLite WAL](https://www.sqlite.org/wal.html)
- [SQLite Query Planner](https://www.sqlite.org/queryplanner.html)
- [SQLite EXPLAIN QUERY PLAN](https://www.sqlite.org/eqp.html)

## 安全

- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)
- [OWASP API4:2023 Unrestricted Resource Consumption](https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP HTML5 Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP XSS](https://owasp.org/www-community/attacks/xss/)
- [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- [MDN CSP](https://developer.mozilla.org/en-US/docs/Web/Security/Practical_implementation_guides/CSP)
- [MDN TLS](https://developer.mozilla.org/en-US/docs/Web/Security/Practical_implementation_guides/TLS)
