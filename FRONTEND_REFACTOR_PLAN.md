# StarStack 前端重构方案

## 背景

StarStack 目前已经具备完整 OJ 产品雏形：题库、题目详情、在线 IDE、判题、讨论区、排行榜、个人中心、私信和后台管理都已存在。

当前主要问题不是功能不足，而是前端经过多轮局部修改后，视觉语言和组件体系变得不够统一：

- 页面风格来自多次叠加优化，整体吸引力不足。
- `src/App.css` 过大，覆盖样式较多，后续维护成本高。
- 部分页面更像功能拼装，而不是统一产品体验。
- 星空主题存在记忆点，但还没有转化为稳定、独特的产品语言。
- 需要兼容低性能电脑，不能依赖重动画、大面积模糊和复杂背景来制造高级感。

本方案目标是将 StarStack 前端重构为一个轻量、高质量、有辨识度的竞赛训练工作台。

## 实施状态

### 阶段一：设计基线与基础组件骨架

状态：已验收通过。

完成内容：

- 新增 `src/styles/tokens.css`，定义颜色、字体、间距、圆角、动效、阴影和低性能模式变量。
- 新增 `src/styles/base.css`，统一基础元素、焦点样式和 reduced motion 策略。
- 新增 `src/styles/layout.css`，提供轻量页面容器和响应式网格工具。
- 新增 `src/styles/components.css`，提供第一批 UI 组件样式。
- 新增 `src/styles/index.css`，作为后续样式拆分入口。
- 新增 `src/components/ui/` 组件骨架：`Button`、`Panel`、`PageHeader`、`Badge`、`DataList`、`EmptyState`。
- 将 `src/index.css` 接入新的样式层，并保留现有兼容变量。

验收结果：

- `npm run lint` 通过。
- `npm run build` 通过。
- 本阶段未大面积改业务页面，只建立后续重构地基。

### 阶段二：题库页重构

状态：已验收通过。

完成内容：

- 将 `src/pages/OjProblemListPage.tsx` 迁移到第一阶段新增的 UI 基线组件。
- 使用 `PageHeader` 替代旧页面标题结构。
- 使用 `Panel` 组织筛选区、统计区和标签区。
- 使用 `DataList`、`DataListHead`、`DataListRow` 重建题目列表。
- 使用 `Button` 统一搜索、重置、分页和加入计划按钮。
- 保留并优化 `CustomSelect` 与 `TagSelector`，保证难度和标签筛选仍可用。
- 支持搜索、难度、标签筛选同步到 URL 查询参数。
- 题库列表改为更适合扫描的专业列表：题号、标题、难度、标签、通过率、计划入口分列显示。
- 移动端改为纵向信息流，避免表格列挤压。
- 新增阶段二专用样式覆盖层，类名以 `problem-library-v2` 和 `problem-library-*` 为主，避免误伤其他页面。

验收结果：

- `npm run lint` 通过。
- `npm run build` 通过。
- 已使用 Edge 浏览器对比洛谷并完成现场验收。
- 已修复标签选择弹层被筛选工具栏压住的问题。
- 已压缩题库页垂直间距，首屏可看到题目列表。
- 题库页已成为后续页面迁移到新 UI 基线的第一个样板页面。

### 阶段三：题目详情 + IDE 工作台

状态：已验收通过。

完成内容：

- 使用 Edge 打开 `localhost:5173/oj/p1001` 验收题目页。
- 发现原有 split 布局在常见桌面宽度下过早降级为单列，IDE 会落到题面下方。
- 调整 `.oj-detail.split` 断点和两栏布局，让常见桌面宽度保持左题面、右 IDE。
- 将 IDE 设为右侧 sticky 工作台，控制高度、圆角、背景和运行区尺寸。
- 保留窄屏降级：宽度不足时仍回到单列分段式视图。
- 减少右侧 IDE 区域的重 blur，保持低配友好。

验收结果：

- `npm run lint` 通过。
- `npm run build` 通过。
- 已使用 Edge 浏览器完成现场验收，IDE 打开后不再掉到题面下方。
- 已确认从评测结果页返回题目后仍能稳定回到双栏工作台。

### 阶段四：评测结果页

状态：已验收通过。

完成内容：

- 将 `src/pages/OjJudgePage.tsx` 改为诊断面板式结果页。
- 使用 `PageHeader`、`Panel`、`Badge`、`Button` 接入统一 UI 基线。
- 为 AC、WA、TLE、RE、CE 建立状态语义、标题文案和调试建议。
- 保留 AC 正反馈，但降低动画在页面中的视觉权重。
- 新增得分、测试点、耗时、语言四项摘要卡片。
- 失败场景增加“建议下一步”和“第一个失败点”区域，方便快速定位。
- 测试点结果改为更紧凑的诊断卡片，源代码区域独立显示。
- 增加低性能模式和 reduced motion 覆盖，避免结果页依赖重动画。

验收结果：

- `npm run lint` 通过。
- `npm run build` 通过。
- 已使用 Edge 打开 `localhost:5173/oj/judge/2` 验收 AC 结果页。
- 已修复 Accepted 后端 message 使用失败色块的问题。
- 已确认“返回题目”按钮可回到 `localhost:5173/oj/p1001`。

### 阶段五：个人主页 / 成长记录

状态：已验收通过。

完成内容：

- 将 `src/pages/AccountPage.tsx` 改为“成长航线”信息架构。
- 接入 `Panel`、`Badge`、`Button`、`EmptyState` 等统一 UI 基线组件。
- 保留头像上传、做题热力图、难度分布、成就、Rating 走势等原有能力。
- 新增轻量星图视图，用 CSS 静态节点表达难度和成就进度，不引入 canvas 或重型图表库。
- 个人身份卡改为左侧稳定信息区，展示排名、连续天数、最长连续天数和头像操作。
- 核心数据压缩为总提交、通过次数、已解决题目、通过率四张摘要卡。
- 难度分布改为带进度条的扫描式卡片。
- 成就区域改为“成就轨道”卡片，提升用户成长反馈。

验收结果：

- `npm run lint` 通过。
- `npm run build` 通过。
- 已使用 Edge 打开 `localhost:5173/account` 验收个人中心。
- 首屏可见身份卡、成长航线星图和核心数据，布局未出现明显挤压。
- 本阶段未增加新的重型依赖，星图为纯 CSS 静态结构。

### 阶段六：讨论区体验闭环

状态：已验收通过。

完成内容：

- 将 `src/pages/DiscussionListPage.tsx` 改为“讨论大厅”结构。
- 讨论列表新增帖子类型识别：题解、求助、题目讨论、公告、普通讨论。
- 讨论列表新增摘要、题目关联入口、右侧大厅概览和发帖建议。
- 题目筛选态 `?problemId=...` 增加更明确的题目讨论标题、返回题目入口和当前筛选提示。
- 将 `src/pages/DiscussionDetailPage.tsx` 改为主内容 + 右侧上下文结构。
- 讨论详情页新增讨论状态、题目绑定卡片、同题讨论入口和讨论礼仪提示。
- 修复从题目相关讨论进入详情后，“返回题目”能回到对应题目，而不是跳回讨论列表。
- 将 `src/pages/DiscussionCreatePage.tsx` 改为发帖工作台结构。
- 发帖页保留富文本编辑器和题目搜索，增加题目绑定说明、checklist 和发布后题目回流状态。
- 取消发帖时，如果当前讨论绑定题目，会返回对应题目页。

验收结果：

- `npm run lint` 通过。
- `npm run build` 通过。
- 已使用 Edge 打开 `localhost:5173/discussions` 验收讨论大厅。
- 已使用 Edge 打开 `localhost:5173/discussions/2` 验收讨论详情页。
- 已确认详情页“返回题目”能回到 `localhost:5173/oj/p1001`。
- 已使用 Edge 打开 `localhost:5173/discussions?problemId=1001` 验收题目讨论筛选态。
- 已使用 Edge 打开 `localhost:5173/discussions/create?problemId=1001` 验收发帖页。
- 已确认发帖页取消路径能回到 `localhost:5173/oj/p1001`。

### 阶段七：首页 / OJ 首页入口重构

状态：已验收通过。

完成内容：

- 将 `src/pages/HomePage.tsx` 改为品牌级入口页。
- 首页首屏新增训练路线图、核心数据、主要行动按钮和四个功能入口卡片。
- 首页重点突出“找题、编码、反馈、复盘”的完整训练路径。
- 将 `src/pages/OjHomePage.tsx` 改为训练控制台结构。
- OJ 首页强化题号直达、进入题库、随机一题、难度筛选、高频标签、热门训练和最近 AC。
- 使用 `Badge`、`Button`、`Panel`、`EmptyState` 接入统一 UI 基线。
- 新增阶段七 CSS 覆盖层，使用纯 CSS 静态路线图和轻量卡片，不增加重型依赖。
- 保持低配友好：无 canvas、无持续动画、无大面积重 blur。

验收结果：

- `npm run lint` 通过。
- `npm run build` 通过。
- 已使用 Edge 打开 `127.0.0.1:5173/` 验收首页首屏。
- 已使用 Edge 打开 `127.0.0.1:5173/oj` 验收 OJ 首页。
- 已在 OJ 首页输入 `1001` 并点击跳转，确认可进入 `127.0.0.1:5173/oj/p1001`。

### 阶段八：出题 / 编辑 / 后台控制台统一

状态：已验收通过。

完成内容：

- 将 `src/pages/CreateProblemPage.tsx` 改为三段式出题工作台：基础信息、题面内容、样例与数据。
- 将 `src/pages/EditProblemPage.tsx` 同步为同款结构，保留原有题目读取、保存和跳转逻辑。
- 出题和编辑页新增右侧 checklist，显示题目标题、题面描述、有效样例、标签、测试数据文件数量等检查状态。
- 统一使用 `PageHeader`、`Panel`、`Badge`、`Button` 等基础 UI 组件，减少页面之间的视觉割裂。
- 优化难度下拉和标签弹层在题目编辑工作台中的层级，避免被表单卡片遮挡。
- 将 `src/pages/MyProblemsPage.tsx` 改为创作者控制台入口，增加题目总数、入门训练、进阶挑战统计。
- 将“我的题目”列表改为自适应两列卡片，减少大屏空白并保证题名可读。
- 将 `src/pages/AdminPage.tsx` 改为后台控制台结构，统一页头、统计卡、用户创建表单和用户表格按钮。
- 后台危险操作仍保留为明确的危险按钮，本阶段不改变删除、封禁、重置密码等业务行为。
- 新增阶段八 CSS 覆盖层，保持低配友好：无新增重型依赖、无持续动画、弱化阴影和 blur。

验收结果：

- `npm run lint` 通过。
- `npm run build` 通过。
- 已使用 Edge 打开 `127.0.0.1:5173/create-problem` 验收创建题目页。
- 已展开创建页难度菜单，确认菜单层级在表单卡片之上，尺寸较克制。
- 已使用 Edge 打开 `127.0.0.1:5173/my-problems` 验收题目管理页，并将卡片布局调整为更稳的两列。
- 已使用 Edge 打开 `127.0.0.1:5173/admin` 验收后台控制台。
- 已使用 Edge 打开 `127.0.0.1:5173/edit-problem/1001` 验收编辑页，确认已有题目数据和 checklist 状态正常显示。

### 阶段九：榜单 / 提交记录 / 私信列表统一

状态：已验收通过。

完成内容：

- 将 `src/pages/LeaderboardPage.tsx` 改为排行榜观测台结构。
- 排行榜新增头名聚焦卡、参与人数、当前用户排名、统计周期和榜单切换面板。
- 排行榜列表从旧表格和内联样式迁移到统一列表行，支持 TOP 排名、用户头像、等级分/通过数、排名变化展示。
- 将 `src/pages/OjSubmissionsPage.tsx` 改为提交日志页。
- 我的提交页新增提交总数、Accepted 数、最高得分、最近提交四张摘要卡。
- 将 `src/pages/OjProblemRecordsPage.tsx` 改为题目提交记录页。
- 题目提交记录页新增题目级摘要、用户 ID 过滤面板和统一状态 badge。
- 将 `src/pages/MessageListPage.tsx` 改为轻量私信收件箱。
- 私信页新增会话数、未读消息、最近会话摘要，并统一空状态和发起聊天入口。
- 发起聊天弹窗保留原搜索逻辑，按钮和用户项迁移到统一交互风格。
- 新增 `ops-page-v2` 阶段九样式层，统一列表型页面的页头、摘要卡、列表面板、响应式和低性能表现。
- 补充 `--ss-radius-xl` 设计变量，修复前面阶段引用未定义圆角 token 的问题。

验收结果：

- `npm run lint` 通过。
- `npm run build` 通过。
- 已使用 Edge 打开 `127.0.0.1:5173/leaderboard` 验收排行榜。
- 已使用 Edge 打开 `127.0.0.1:5173/oj/submissions` 验收我的提交页。
- 已使用 Edge 打开 `127.0.0.1:5173/oj/records/1001` 验收题目提交记录页。
- 已使用 Edge 打开 `127.0.0.1:5173/messages` 验收私信列表空状态。
- 已打开“发起聊天”弹窗验收层级和输入框焦点，未搜索、未发送、未创建会话。

### 阶段十：聊天详情页 / 私信闭环

状态：已验收通过。

完成内容：

- 将 `src/pages/ChatPage.tsx` 改为统一消息工作台结构。
- 聊天详情页新增 `PageHeader`，明确对话对象、轮询刷新和 Enter 发送说明。
- 新增左侧会话资料卡，展示对方头像/名称/ID、是否可发送、7 秒轮询提示、总消息数、我发送、对方发送和最近消息时间。
- 消息区域改为 `Timeline` 面板，保留日期分隔、加载更多、消息气泡、撤回入口和富文本渲染。
- 输入区域改为 `Composer` 面板，保留原 `RichTextEditor`、Enter 发送、Shift+Enter 换行和发送按钮禁用逻辑。
- 保留原发送接口、撤回接口、分页加载和轮询逻辑，本阶段不改变消息业务行为。
- 修复新布局下自动滚动导致整页跳到底部的问题：从 `scrollIntoView` 改为只滚动 `.chat-messages` 内部容器。
- 新增阶段十 CSS 覆盖层，统一聊天页宽度、两栏布局、消息气泡、输入区和移动端折叠。

详细验收结果：

- 静态验收：读取 `src/pages/ChatPage.tsx`，确认发送、撤回、轮询、分页逻辑保留。
- 命令验收 1：页面结构改造后，`npm run lint` 通过。
- 命令验收 2：页面结构改造后，`npm run build` 通过。
- 浏览器验收 1：打开 `127.0.0.1:5173/messages/admin`，确认页头、会话资料卡、消息时间线、富文本输入区、禁用发送按钮均存在。
- 问题修复：首次浏览器验收发现页面自动滚到底部，随后修复为内部消息容器滚动。
- 命令验收 3：滚动修复后，`npm run lint` 通过。
- 命令验收 4：滚动修复后，`npm run build` 通过。
- 浏览器验收 2：刷新 `127.0.0.1:5173/messages/admin`，确认首屏停留在页头和会话资料卡，不再自动跳到底部。
- 浏览器验收 3：点击“返回私信”，确认能回到 `127.0.0.1:5173/messages`。
- 风险控制：验收过程中未输入消息、未点击发送、未触发撤回或删除。

### 阶段十一：路由级 CSS 拆分 / 低配友好收敛

状态：已验收通过。

完成内容：

- 将聊天详情页私有样式从 `src/App.css` 拆出到 `src/pages/ChatPage.css`。
- 在 `src/pages/ChatPage.tsx` 中按路由组件导入 `./ChatPage.css`，使聊天详情页样式跟随懒加载页面一起加载。
- 保留 `ops-page-v2`、`ops-panel-head` 等共享样式在 `src/App.css` 中，避免影响榜单、提交记录、私信列表等已验收页面。
- `src/App.css` 从 16632 行降到 16307 行，聊天详情页样式独立为 325 行。
- 生产构建中出现独立的 `ChatPage-*.css` 产物，说明 Vite 已将该路由样式从主 CSS 包中拆分出来。
- 本阶段不改变任何聊天业务逻辑，不新增依赖，不增加运行时动画。

详细验收结果：

- 边界验收：确认 Stage 10 样式均为 `.chat-*` / `.chat-workspace-v2` 私有选择器，适合从全局 CSS 中拆出。
- 静态验收：`rg` 确认 `src/App.css` 已无 `Stage 10` 和 `chat-workspace-v2` 残留，`src/pages/ChatPage.tsx` 正确导入 `ChatPage.css`。
- 命令验收 1：拆分后 `npm run lint` 通过。
- 命令验收 2：拆分后 `npm run build` 通过。
- 构建验收：生产产物包含 `ChatPage-*.css`，本次构建显示该 CSS 约 5.16 kB，gzip 后约 1.32 kB。
- 浏览器验收 1：在 Edge 打开 `127.0.0.1:5173/messages`，确认私信列表页原样式未受影响。
- 浏览器验收 2：点击会话进入 `127.0.0.1:5173/messages/admin`，确认聊天详情页页头、左侧用户卡、时间线面板样式正常生效。
- 浏览器验收 3：确认页面没有自动跳到底部，聊天详情首屏仍停留在页头和主体区域。
- 浏览器验收 4：点击“返回私信”，确认能回到 `127.0.0.1:5173/messages`。
- 风险控制：验收过程中未输入消息、未发送消息、未撤回或删除任何数据。

### 阶段十二：判题结果页 CSS 拆分 / 评测反馈轻量化

状态：已验收通过。

完成内容：

- 将判题结果页 Stage 4 增强样式从 `src/App.css` 拆出到 `src/pages/OjJudgePage.css`。
- 在 `src/pages/OjJudgePage.tsx` 中按路由组件导入 `./OjJudgePage.css`。
- 保留旧版火箭动画、AC 文案、成就卡片等基础样式在 `src/App.css` 中，避免破坏其他历史样式依赖。
- 本次拆出的样式覆盖 `judge-page-v2`、`judge-overview`、`judge-debug-panel`、`judge-results-panel`、`judge-code-panel` 等判题页私有布局。
- `src/App.css` 从 16307 行降到 15908 行，判题结果页样式独立为 399 行。
- 生产构建中出现独立的 `OjJudgePage-*.css` 产物，说明判题页增强样式已从主 CSS 包中拆分出来。
- 本阶段不改变提交、流式评测、历史记录读取、AC 正反馈、成就读取和页面跳转业务逻辑。

详细验收结果：

- 边界验收：读取 `src/pages/OjJudgePage.tsx` 和 `src/App.css` Stage 4 区域，确认本阶段迁移的选择器主要服务判题详情页。
- 兼容验收：确认 `.submit-anim`、`.judge-result-text`、`.judge-celebration-panel` 的基础样式仍在 `src/App.css`，本阶段只迁移判题页 v2 覆盖层。
- 静态验收：`rg` 确认 `src/App.css` 已无 `Stage 4`、`judge-page-v2`、`judge-overview` 残留，`src/pages/OjJudgePage.tsx` 正确导入 `OjJudgePage.css`。
- 命令验收 1：拆分后 `npm run lint` 通过。
- 命令验收 2：拆分后 `npm run build` 通过。
- 构建验收：生产产物包含 `OjJudgePage-*.css`，本次构建显示该 CSS 约 6.84 kB，gzip 后约 1.82 kB。
- 体积验收：主 CSS 产物从上一阶段约 256.82 kB 降到约 249.99 kB。
- 数据验收：本地数据库存在提交记录 `2 | 1001 | Accepted | 100 | C++`，用于只读浏览器验收。
- 浏览器验收 1：打开 `127.0.0.1:5173/oj/judge/2`，确认判题页成功态正常展示。
- 浏览器验收 2：确认页头、AC 视觉区、进度条、得分/测试点/耗时/语言摘要卡、正反馈区域和测试点结果均正常显示。
- 浏览器验收 3：点击“提交记录”，确认跳转到 `127.0.0.1:5173/oj/submissions` 正常，提交列表页样式未受影响。
- 风险控制：验收过程中未重新提交代码、未触发评测、未修改提交记录。

### 阶段十三：题目详情 / IDE 工作台 CSS 拆分

状态：已验收通过。

完成内容：

- 先清理 Edge 顶栏标签，只保留 `https://www.luogu.com.cn/` 参考页和当前 StarStack 本地页。
- 将题目详情 + IDE 工作台最终 Stage 3 覆盖层从 `src/App.css` 拆出到 `src/pages/OjDetailPage.css`。
- 在 `src/pages/OjDetailPage.tsx` 中按路由组件导入 `./OjDetailPage.css`。
- 本次迁移覆盖 `oj-detail`、`oj-detail.split`、题面区域、样例卡片、右侧 sticky IDE、编辑器高度、测试运行输入输出区域和移动端折叠规则。
- 保留 `src/App.css` 中更早期的 `.oj-detail.split` 历史兜底样式，避免一次性删除多层历史覆盖导致 IDE 布局回退。
- `src/App.css` 从 15908 行降到 15706 行，题目详情最终覆盖层独立为 201 行。
- 生产构建中出现独立的 `OjDetailPage-*.css` 产物，说明题目详情页最终覆盖层已从主 CSS 包中拆分出来。
- 本阶段不改变题目加载、KaTeX 渲染、富文本渲染、讨论摘要、IDE 懒加载、草稿缓存、样例运行和提交业务逻辑。

详细验收结果：

- 标签验收：清理前 Edge 有 15 个标签，关闭 13 个无用标签后，仅保留洛谷参考页和 StarStack 本地页。
- 边界验收：读取 `src/pages/OjDetailPage.tsx` 和 `src/App.css` 多处 `.oj-detail.split` 历史块，确认本阶段只迁移最终生效的 Stage 3 覆盖层。
- 静态验收：确认 `src/pages/OjDetailPage.tsx` 已导入 `OjDetailPage.css`，`src/App.css` 已移除 `Stage 3: problem detail + IDE workbench` 段。
- 命令验收 1：拆分后 `npm run lint` 通过。
- 命令验收 2：拆分后 `npm run build` 通过。
- 构建验收：生产产物包含 `OjDetailPage-*.css`，本次构建显示该 CSS 约 3.81 kB，gzip 后约 1.02 kB。
- 体积验收：主 CSS 产物从上一阶段约 249.99 kB 降到约 246.33 kB。
- 浏览器验收 1：复用当前 StarStack 标签打开 `127.0.0.1:5173/oj/p1001`，没有新建浏览器标签。
- 浏览器验收 2：确认题目普通态展示正常，包括题面、输入输出格式、样例、数据范围、右侧题号/出题人/难度/讨论模块。
- 浏览器验收 3：点击“提交”打开 IDE，确认 split 布局正常，左侧题面和右侧编辑器、语言菜单、提交按钮、测试运行区域均正常显示。
- 标签收尾验收：阶段完成后 Edge 仍只有 2 个标签，未继续堆积无用标签。
- 风险控制：验收过程中未运行样例、未提交代码、未修改题目或讨论数据。

### 阶段十四：题库页 CSS 拆分 / 筛选菜单层级复查

状态：已验收通过。

完成内容：

- 将题库页 Stage 2 覆盖层从 `src/App.css` 拆出到 `src/pages/OjProblemListPage.css`。
- 在 `src/pages/OjProblemListPage.tsx` 中按路由组件导入 `./OjProblemListPage.css`。
- 本次迁移覆盖 `problem-library-v2`、统计摘要、搜索工具栏、难度筛选、标签栏、题目列表、通过率、计划按钮、分页和响应式规则。
- 保留 `CustomSelect`、`TagSelector` 的共享基础样式在 `src/App.css` 中，题库页只保留局部尺寸和层级覆盖。
- 修复浏览器验收中发现的难度菜单层级问题：当题库筛选栏内部 `CustomSelect` 打开时，临时提升 `problem-library-toolbar` 层级，避免被下方标签栏遮挡。
- `src/App.css` 从 15706 行降到 15372 行，题库页样式独立为 333 行。
- 生产构建中出现独立的 `OjProblemListPage-*.css` 产物，说明题库页样式已从主 CSS 包中拆分出来。
- 本阶段不改变题库查询、搜索、难度筛选、标签筛选、分页、加入计划和题目跳转业务逻辑。

详细验收结果：

- 边界验收：读取 `src/pages/OjProblemListPage.tsx`、`src/components/CustomSelect.tsx`、`src/components/TagSelector.tsx` 和 `src/App.css` Stage 2 区域，确认本阶段只迁移题库页私有覆盖层。
- 静态验收：确认 `src/pages/OjProblemListPage.tsx` 已导入 `OjProblemListPage.css`，`src/App.css` 已移除 `Stage 2: problem library refactor` 段。
- 命令验收 1：拆分后 `npm run lint` 通过。
- 命令验收 2：拆分后 `npm run build` 通过。
- 构建验收：生产产物包含 `OjProblemListPage-*.css`，本次最终构建显示该 CSS 约 5.72 kB，gzip 后约 1.41 kB。
- 体积验收：主 CSS 产物从上一阶段约 246.33 kB 降到约 240.81 kB。
- 浏览器验收 1：复用当前 StarStack 标签打开 `127.0.0.1:5173/oj/list`，没有新建浏览器标签。
- 浏览器验收 2：确认题库首屏展示正常，包括页头、统计摘要、搜索框、难度筛选、标签筛选和题目列表。
- 浏览器验收 3：首次打开难度菜单发现仍被标签栏压住一截，随后修复工具栏打开态层级。
- 浏览器验收 4：重新打开难度菜单，确认菜单在标签过滤模块上方展示，大小保持小型菜单风格。
- 浏览器验收 5：打开标签选择器，确认弹窗在最上方，背景和题目列表被压暗，没有被列表遮挡。
- 标签收尾验收：阶段完成后 Edge 仍只有 2 个标签，未继续堆积无用标签。
- 风险控制：验收过程中未选择难度、未选择标签、未搜索、未加入计划、未进入题目详情。

### 阶段十五：个人中心 / 成长页 CSS 拆分

状态：已验收通过。

完成内容：

- 将个人中心 Stage 5 覆盖层从 `src/App.css` 拆出到 `src/pages/AccountPage.css`。
- 在 `src/pages/AccountPage.tsx` 中按路由组件导入 `./AccountPage.css`。
- 本次迁移覆盖 `profile-v2`、成长航线、头像身份卡、统计卡、难度分布、成就轨道、热力图和移动端规则。
- 本轮后续阶段批量迁移完成后，`src/App.css` 收敛到 13004 行；`AccountPage.css` 独立为 462 行。
- 生产构建中出现独立的 `AccountPage-*.css` 产物，本次构建约 7.82 kB，gzip 后约 2.08 kB。

详细验收结果：

- 静态验收：确认 `src/App.css` 已无 `Stage 5: profile growth route` 和 `profile-container.profile-v2` 残留，账号页正确导入新样式。
- 命令验收 1：拆分后 `npm run lint` 通过。
- 命令验收 2：拆分后 `npm run build` 通过。
- 浏览器验收：复用当前 StarStack 标签打开 `127.0.0.1:5173/account`，确认个人信息卡、成长航线、统计卡、热力图和成就模块正常显示。
- 标签收尾验收：Edge 保持 2 个标签，仅保留洛谷参考页和 StarStack 本地页。
- 风险控制：验收过程中未上传头像、未修改用户资料。

### 阶段十六：讨论区 CSS 拆分

状态：已验收通过。

完成内容：

- 将讨论区 Stage 6 覆盖层从 `src/App.css` 拆出到 `src/pages/DiscussionPages.css`。
- 在 `DiscussionListPage`、`DiscussionDetailPage`、`DiscussionCreatePage` 中导入 `./DiscussionPages.css`。
- 本次迁移覆盖讨论大厅、帖子详情、发帖页、右侧摘要栏、富文本工具条、题目关联入口和响应式规则。
- `DiscussionPages.css` 独立为 468 行。
- 生产构建中出现独立的 `DiscussionPages-*.css` 产物，本次构建约 8.62 kB，gzip 后约 1.72 kB。

详细验收结果：

- 静态验收：确认 `src/App.css` 已无 `Stage 6: discussion loop` 残留，三个讨论页面均已导入讨论区专属样式。
- 命令验收 1：拆分后 `npm run lint` 通过。
- 命令验收 2：拆分后 `npm run build` 通过。
- 浏览器验收 1：打开 `127.0.0.1:5173/discussions`，确认讨论大厅列表、搜索、排序、右侧概览和焦点讨论正常显示。
- 浏览器验收 2：打开 `127.0.0.1:5173/discussions/2`，确认帖子正文、评论区、右侧讨论状态和返回题目入口正常显示。
- 浏览器验收 3：打开 `127.0.0.1:5173/discussions/create`，确认发帖表单、题目搜索、富文本工具条和 checklist 正常显示。
- 风险控制：验收过程中未发布讨论、未评论、未点赞、未删除帖子。

### 阶段十七：创作 / 管理页 CSS 拆分

状态：已验收通过。

完成内容：

- 将创作与后台 Stage 8 覆盖层从 `src/App.css` 拆出到 `src/pages/CreatorAdminPages.css`。
- 在 `CreateProblemPage`、`EditProblemPage`、`MyProblemsPage`、`AdminPage` 中导入 `./CreatorAdminPages.css`。
- 本次迁移覆盖题目编辑器、我的题目列表、后台控制台、表单控件、发布检查栏、难度菜单局部层级和响应式规则。
- `CreatorAdminPages.css` 独立为 449 行。
- 生产构建中出现独立的 `CreatorAdminPages-*.css` 产物，本次构建约 7.38 kB，gzip 后约 1.62 kB。

详细验收结果：

- 静态验收：确认 `src/App.css` 已无 `Stage 8: creator/admin console` 残留，四个创作/管理页面均已导入专属样式。
- 命令验收 1：拆分后 `npm run lint` 通过。
- 命令验收 2：拆分后 `npm run build` 通过。
- 浏览器验收 1：打开 `127.0.0.1:5173/create-problem`，确认创建题目表单、发布检查栏、难度菜单和标签入口正常显示。
- 浏览器验收 2：展开创建页难度菜单，确认为项目自定义列表框，贴合控件显示，没有被卡片遮挡。
- 浏览器验收 3：打开 `127.0.0.1:5173/my-problems`，确认题目统计和题目卡片正常显示。
- 浏览器验收 4：打开 `127.0.0.1:5173/edit-problem/1001`，确认已有题目数据、标签、样例和 checklist 状态正常回填。
- 浏览器验收 5：打开 `127.0.0.1:5173/admin`，确认用户统计、创建用户表单和用户列表正常显示。
- 风险控制：验收过程中未创建题目、未更新题目、未删除题目、未创建或修改用户。

### 阶段十八：入口 / 运营页 CSS 拆分与全局收口

状态：已验收通过。

完成内容：

- 将首页与 OJ 首页 Stage 7 覆盖层从 `src/App.css` 拆出到 `src/pages/EntryPages.css`。
- 将排行榜、提交记录、单题记录、私信列表等 Stage 9 覆盖层从 `src/App.css` 拆出到 `src/pages/OpsPages.css`。
- 在 `HomePage`、`OjHomePage` 中导入 `./EntryPages.css`。
- 在 `LeaderboardPage`、`OjSubmissionsPage`、`OjProblemRecordsPage`、`MessageListPage`、`ChatPage` 中导入 `./OpsPages.css`。
- `EntryPages.css` 独立为 481 行，`OpsPages.css` 独立为 509 行。
- 最终全局检查确认 `src/App.css` 已无 `/* Stage ... */` 阶段标记，阶段样式已迁移到页面级 CSS。
- 最终构建中主 CSS 产物约 200.69 kB，gzip 后约 34.81 kB；多个页面 CSS 以路由 chunk 形式按需输出。

详细验收结果：

- 静态验收：`rg` 确认 `src/App.css` 不再包含阶段样式标记，对应页面均已导入 `AccountPage.css`、`DiscussionPages.css`、`EntryPages.css`、`CreatorAdminPages.css`、`OpsPages.css` 等页面级样式。
- 命令验收 1：最终 `npm run lint` 通过。
- 命令验收 2：最终 `npm run build` 通过。
- 浏览器验收 1：打开 `127.0.0.1:5173/`，确认首页主视觉、训练路径和统计入口正常。
- 浏览器验收 2：打开 `127.0.0.1:5173/oj`，确认 OJ 首页题号直达、难度入口、热门训练、标签区和最近 AC 正常。
- 浏览器验收 3：打开 `127.0.0.1:5173/leaderboard`，确认榜单切换和排名卡正常。
- 浏览器验收 4：打开 `127.0.0.1:5173/oj/submissions`，确认我的提交统计卡、提交表格和状态徽章正常。
- 浏览器验收 5：打开正确路由 `127.0.0.1:5173/oj/records/1001`，确认单题记录统计、用户过滤和记录列表正常。
- 浏览器验收 6：打开 `127.0.0.1:5173/messages`，确认私信列表统计和会话卡正常。
- 浏览器验收 7：打开 `127.0.0.1:5173/messages/admin`，确认聊天详情页继续正常依赖 `OpsPages.css` 和 `ChatPage.css`。
- 标签收尾验收：阶段完成后 Edge 仍只有 2 个标签，未继续堆积无用标签。
- 风险控制：验收过程中未发送私信、未发起新会话、未触发评测、未修改数据库数据。

## 产品定位

StarStack 不做洛谷或力扣的换皮，而是吸收它们各自的优点：

- 学习洛谷：竞赛 OJ 的清晰题库、题目详情、讨论和题解氛围。
- 学习力扣：刷题路径短、反馈明确、状态可见、列表扫描效率高。
- 保留星栈特色：用星图、星域、轨道和成长记录表达用户进步。

最终定位：

> 深空主题的轻量竞赛训练工作台。

## 核心原则

### 1. 低配友好

默认体验就应该足够轻，而不是只靠“低性能模式”兜底。

要求：

- 减少持续运行的动画。
- 减少大面积 `backdrop-filter`。
- 减少重阴影、发光、复杂叠层背景。
- Monaco、KaTeX、富文本编辑器继续按需加载。
- 背景星空只保留轻量氛围，不承担主要视觉表达。

### 2. 工作台优先

页面首先服务用户完成任务：

- 找题
- 读题
- 写代码
- 运行样例
- 提交
- 看错误
- 复盘记录
- 参与讨论

视觉设计应辅助这些流程，而不是抢占注意力。

### 3. 统一组件

重构后，页面不再各自写一套相似 UI。

需要沉淀基础组件：

- `Button`
- `Panel`
- `PageHeader`
- `DataList`
- `Badge`
- `Tabs`
- `Modal`
- `EmptyState`
- `Skeleton`
- `CustomSelect`

### 4. 特色集中

星空主题不靠全站炫光堆叠表达，而是集中在有意义的产品功能里：

- 个人主页：星图式解题进度。
- 成就系统：轨道式成长节点。
- 题库标签：星域式分类。
- Rating：航线/轨迹式变化。

这样既有辨识度，也不会拖慢低配电脑。

### 5. 渐进重构

不一次性推倒重写。

先重构最影响用户感知和使用效率的页面，再逐步替换旧组件和旧样式。

## 视觉方向

建议采用：

> 深空纸面感 + 竞赛工作台

具体表现：

- 深色背景保留，但更干净、更安静。
- 内容区域减少玻璃拟态和大圆角。
- 卡片圆角控制在 `6px` 到 `8px`。
- 列表、表格、侧栏更适合长时间扫描。
- 颜色不只依赖蓝紫色，难度、状态、结果使用清晰语义色。
- 动效只用于状态变化、提交反馈、成功反馈等关键节点。

避免：

- 满屏发光装饰。
- 大量模糊玻璃层。
- 每个模块都做成厚重卡片。
- 页面之间各自拥有不同视觉体系。
- 为了高级感牺牲可读性和性能。

## 技术重构方向

### CSS 结构拆分

当前核心样式集中在 `src/App.css`，后续建议拆分为：

- `src/styles/tokens.css`
- `src/styles/base.css`
- `src/styles/layout.css`
- `src/styles/components.css`
- `src/styles/pages.css`

拆分顺序建议：

1. 先抽设计变量和基础 reset。
2. 再抽按钮、输入框、面板、标签等组件样式。
3. 最后按页面逐步迁移旧样式。

### 组件体系

建议新增目录：

```text
src/components/ui/
```

第一批组件：

- `Button.tsx`
- `Panel.tsx`
- `PageHeader.tsx`
- `Badge.tsx`
- `DataList.tsx`
- `Tabs.tsx`
- `Modal.tsx`
- `EmptyState.tsx`
- `Skeleton.tsx`

已有组件中：

- `CustomSelect` 可保留并纳入 UI 体系。
- `TagSelector` 需要统一弹层和按钮风格。
- `OjIdePanel` 单独作为复杂业务组件维护。

### 性能策略

必须保留：

- 页面懒加载。
- Monaco 按需加载。
- KaTeX 按需加载。
- StarBot 页面懒加载。
- 低性能模式。

需要加强：

- 减少全局 CSS 中复杂选择器和重复覆盖。
- 减少页面级 hover 大面积重绘。
- 避免列表项 hover 触发复杂阴影或位移。
- 控制 CSS 包体增长。

## 页面重构优先级

### 第一优先级：题目详情 + IDE

这是用户停留时间最长的核心页面。

目标：

- 左侧题面，右侧 IDE，形成稳定刷题工作台。
- 样例运行、提交、结果反馈在同一工作流里。
- 题目讨论入口保留，但不干扰做题主流程。
- IDE 区域稳定，不因结果面板或语言切换造成布局跳动。
- 移动端改成题面、代码、结果的分段式视图。

验收标准：

- 用户能在 3 秒内看清题目、找到提交入口。
- 写代码区域不被装饰元素干扰。
- 样例运行结果清晰显示差异。
- 低配电脑打开题目页不明显卡顿。

### 第二优先级：题库页

题库页决定用户能否快速找到合适题目。

目标：

- 使用高质量专业列表，而不是松散卡片堆叠。
- 题号、标题、难度、标签、通过率、状态、计划入口清晰排列。
- 搜索、难度筛选、标签筛选稳定且不遮挡。
- 支持从 OJ 首页带参数进入筛选结果。

验收标准：

- 一屏能展示更多题目。
- 用户能快速比较难度和标签。
- 菜单、标签弹层不被遮挡。
- 移动端仍可清楚浏览。

### 第三优先级：评测结果页

评测页决定提交后的情绪反馈和调试效率。

目标：

- AC 有正反馈，但不过度依赖烟花动画。
- WA/TLE/RE/CE 信息更适合定位问题。
- 测试点结果、耗时、得分、错误信息分区明确。
- 提供自然返回路径：回题目、看提交、继续调试。

验收标准：

- 成功和失败状态一眼可识别。
- 错误信息不被动画或装饰稀释。
- 用户能快速知道下一步该做什么。

### 第四优先级：个人主页

个人主页是 StarStack 特色最适合发力的地方。

目标：

- 做出星图式解题进度。
- 展示成就轨道、Rating 变化、连续打卡。
- 将用户成长变成可感知、可回看的路径。

验收标准：

- 用户能明显感受到自己的进步。
- 星栈特色在这里形成记忆点。
- 数据展示清晰，不只是一堆数字。

### 第五优先级：讨论区

讨论区应服务刷题，而不是独立漂浮的社区。

目标：

- 区分题解、提问、讨论、公告等内容类型。
- 题目页能看到相关讨论摘要。
- 帖子列表支持质量排序和题目关联筛选。
- 发帖入口能自然携带题目信息。

验收标准：

- 用户从题目页进入讨论后能自然返回题目。
- 相关讨论能帮助用户解决问题。
- 社区内容和刷题主线形成闭环。

## 第一阶段实施范围

第一阶段建议只做以下内容：

1. 建立设计变量和基础 UI 组件骨架。
2. 重构题目详情 + IDE 页面。
3. 重构题库页。
4. 清理与这两个页面相关的旧覆盖样式。
5. 保留现有 API 和功能，不做大规模后端改动。

第一阶段不做：

- 不重写整个前端。
- 不引入重型 UI 框架。
- 不大改数据库结构。
- 不把所有页面一次性迁移。
- 不堆叠新的复杂动画。

## 建议执行步骤

### Step 1：建立前端设计基线

输出：

- 颜色变量
- 字号变量
- 间距变量
- 圆角变量
- 阴影规范
- 动画规范
- 低性能模式规范

### Step 2：抽基础组件

输出：

- `src/components/ui/Button.tsx`
- `src/components/ui/Panel.tsx`
- `src/components/ui/PageHeader.tsx`
- `src/components/ui/Badge.tsx`
- `src/components/ui/DataList.tsx`

### Step 3：重构题库页

输出：

- 新题库列表结构
- 统一筛选区
- 稳定弹层层级
- 移动端布局

### Step 4：重构题目详情 + IDE

输出：

- 题面/IDE 双栏工作台
- 样例运行区域
- 提交和结果入口
- 讨论入口
- 移动端分段视图

### Step 5：回归测试

每一步都必须运行：

```bash
npm run lint
npm run build
```

建议手动验证：

- 首页打开是否流畅。
- 题库筛选是否正常。
- 题目详情是否能打开。
- IDE 是否能输入、运行样例、提交。
- 判题结果页是否正常。
- 低性能模式是否仍然可用。

## 质量标准

完成后的前端应满足：

- 页面更统一，不像多轮补丁叠加。
- 低配电脑打开主要页面不明显卡顿。
- 找题、读题、写代码、提交路径更短。
- 样式体系有边界，后续可维护。
- StarStack 有自己的产品记忆点。

## 成功标志

用户第一次打开网站时，应感受到：

- 这是一个真实可用的 OJ，不只是练手项目。
- 页面安静、清晰、专业。
- 做题路径顺，不需要猜按钮在哪里。
- 站点有星栈自己的气质。
- 即使电脑配置一般，也能轻松使用。
