# StarStack 与主流算法平台差距调研

**调研日期：** 2026-08-27
**调研对象：** StarStack、Codeforces、AtCoder、洛谷、牛客、LeetCode、Kattis
**调研目的：** 识别 StarStack 当前真正影响用户增长、学习效果、评测可信度和后续扩展的差距，并确定不应盲目复制的功能。

## 一、直接结论

StarStack 当前已经具备一个可用的小型 OJ 的技术骨架：题库、题面、在线 IDE、样例/自定义运行、提交评测、队列、提交记录、讨论、聊天、私信、个人成长、管理员审核、数据库迁移、备份和基础安全能力都已经存在。它的视觉统一、用户身份装饰和聊天/讨论整合，是当前产品比较有辨识度的部分。

但它与成熟平台的差距不是某一个页面少了几个按钮，而是“内容、竞技、学习和治理”还没有形成规模化闭环：

1. 题库数量和题目质量信号远低于成熟平台；
2. 当前没有真正的比赛系统，排行榜路由也被重定向到首页；
3. 题目发现和个性化推荐仍缺少足够的课程、题单、题解和提示；
4. 题目编辑和评测主要覆盖标准输入输出，缺少 Special Judge、交互题、子任务/分组计分、数据包导入和更完整的出题审核链路；
5. 社区已有讨论、聊天和私信，但缺少成熟的信任等级、内容质量排序、最佳回答和反作弊体系；
6. 当前后端适合早期单机规模，距离多评测机、水平扩展、真实用户性能观测和大规模内容运营还有明显距离。

因此，StarStack 不应该立即复制“所有大站功能”。更合理的定位是：**一个界面现代、题目质量可靠、带有个性化身份装饰的中文算法学习型 OJ**。先把少量题目的质量和完成率做出来，再决定是否进入比赛和团队平台。

## 二、StarStack 当前基线

### 2.1 已有能力

根据当前工作区代码、README 和最近的本地发布门禁，StarStack 已有：

- 账号注册、邮箱验证、登录、资料编辑、会话管理和站内装饰；
- 题库搜索、标签、五层难度和服务端分页；
- C++17、Python 3、Java 17 的标准输入输出评测；
- 样例运行、自定义测试、正式提交、SSE 进度、轮询恢复、排队、取消和服务重启恢复；
- 题目创建、编辑、测试点限时、版本历史、审核和管理员处理；
- 题解、讨论、评论、点赞、聊天室、私信、通知、好友/关注和举报；
- 用户等级、成就、热力图、练习统计、排行榜 API 和头像框/叠加层/称号；
- HttpOnly Cookie 增量会话、CSRF 来源校验、输入长度限制、SQLite WAL、队列配额、沙箱和备份恢复检查。

### 2.2 当前基线限制

本地数据库本轮核验为 45 张表、17 个用户、8 道题、7 条提交记录。这是开发环境数据，不代表产品上限，但说明目前还处在“功能骨架和验证期”，不能用成熟平台的社区规模来衡量细节体验。

当前前端路由中 `/leaderboard` 明确重定向到 `/`，源码注释为“排行榜功能已屏蔽”；后端虽然保留排行榜 API 和聊天活动榜，但没有比赛报名、比赛计时、比赛题集、比赛 standings、虚拟参赛或竞赛 Rating 的完整产品闭环。

## 三、平台定位对比

| 平台 | 主要定位 | 最强闭环 | 对 StarStack 的启示 |
|---|---|---|---|
| Codeforces | 高密度竞技比赛 + 社区 | 比赛、Rating、分组、Hack、赛后复盘、题库 | 竞技平台的核心不是单题提交，而是持续比赛和可比较的实力反馈 |
| AtCoder | 高质量定期比赛 + 结构化训练 | ABC/ARC/AGC、Rated/Unrated、Virtual、Editorial、专题练习 | 训练内容必须有稳定节奏、明确分层和赛后复盘 |
| 洛谷 | 中文大型题库 + 社区 + 学习/团队/教育 | 大题库、题单、比赛、团队、题解、文章、工单、商业服务 | 题库之外，题单、团队、治理和内容生产体系才构成网络效应 |
| 牛客 | 算法竞赛 + 面试/求职 | 知识点专项、视频题解、公司真题、竞赛、重现赛、职业内容 | 可把算法练习和职业场景连接起来，但这会显著扩大内容和运营成本 |
| LeetCode | 面试题库 + 结构化学习 | Explore、Study Plan、My List、Progress、Contest、Discuss、编辑器分析 | 用户需要“下一道做什么”和“我掌握了什么”，不只是题目列表 |
| Kattis | 标准化问题包 + 统计型 OJ | 题目包规范、难度、语言、完整通过率、最快运行时间、题目统计 | 出题生产和题目元数据标准化，会直接提高评测可信度和可维护性 |

## 四、核心差距分析

### 4.1 内容规模与质量：最大差距，P0/P1

洛谷帮助中心称其主站拥有约 15000 道公有题目，且同时提供官方、精选和用户自定义题单；洛谷关于页面进一步披露，截至 2025 年底拥有超过 200 万用户、15000 道公有题目和 2.5 亿次评测。这个规模带来的优势不是“数字好看”，而是用户几乎总能找到下一道合适的题。[洛谷主站操作指南](https://help.luogu.com.cn/manual/luogu/)、[关于洛谷](https://help.luogu.com.cn/about-us)、[洛谷题单](https://help.luogu.com.cn/manual/luogu/training)

AtCoder 官方信息页列出 500k+ 用户、6k+ Tasks、590+ 官方比赛和每年 80+ Rated contests；其长期练习入口还提供 APG4B、Beginners Selection、Library Practice、Typical 90 等固定内容。[AtCoder 官方信息页](https://info.atcoder.jp/)、[AtCoder 比赛列表](https://atcoder.jp/contests?lang=en)、[AtCoder 典型 90](https://atcoder.jp/contests/typical90?lang=ja)

StarStack 当前有标签、难度和题目审核，但还没有足够的内容密度，也没有成熟的题目质量指标。具体短板是：

- 没有 30～100 道可以覆盖入门到基础算法的稳定核心题集；
- 没有每道题的官方提示、标准题解、复杂度说明和常见错误样例；
- 没有按通过率、尝试人数、热门程度、题解质量和最近维护时间建立的质量信号；
- 没有用户题单、收藏/复制/分享题单和题单完成率；
- 没有题目版本发布说明、测试数据变更影响和回归结果的用户可见摘要。

**判断：** 继续做装饰、聊天或大型运营功能，收益会低于先把 20～50 道题做成“值得反复使用”的内容。StarStack 目前缺的不是更多入口，而是入口后的内容密度。

### 4.2 比赛、Rating 和竞技闭环：结构性差距，P1

Codeforces 官方将自己定义为“比赛平台 + 编程社区”，提供定期比赛、Rating、Divisions、Gym、Groups、Edu 和 API；其比赛规则还把赛中 Hack、赛后最终测试和动态分值结合起来。官方帮助页提到每月大约组织六场比赛，并明确说明 Rating 反映选手能力、Divisions 按 Rating 划分。[Codeforces Help](https://codeforces.com/help?locale=en&mobile=true)、[Codeforces Problemset](https://codeforces.com/problemset?lang=en&locale=en)、[Codeforces Contests](https://codeforces.com/contests/?locale=en)

AtCoder 的单场比赛页面已经把 Tasks、Clarifications、All Submissions、Standings、Virtual Standings、Editorial 和 Discuss 组织在同一个上下文中，并区分 Beginner、Regular、Grand、Heuristic 等比赛范围。[AtCoder 题目与比赛页面](https://atcoder.jp/contests/abc461/tasks)

牛客则把 ACM、OI、IOI 等赛制、Rated 比赛、报名、赛后回顾和创建重现赛放在统一竞赛中心；当前页面还展示了持续更新的练习赛、周赛、挑战赛和多校训练营。[牛客竞赛中心](https://ac.nowcoder.com/acm/contest/vip-index?internalFrom=sideBar)

StarStack 当前差距：

- 没有 `contests`、`contest_problems`、`contest_registrations`、`contest_submissions`、`standings` 等比赛核心模型；
- 没有固定开始/结束时间、报名、赛中题面访问、赛后封榜或重赛机制；
- 没有比赛 Rating，当前用户 Rating 更接近练习成长分，不具备比赛比较意义；
- 没有 Virtual participation、重现赛、赛后题解和比赛历史；
- 没有作弊检测、代码相似度、赛中讨论限制和争议处理流程。

**判断：** 如果目标只是“让用户学习并通过题目”，比赛可以后置；如果目标是“竞赛社区”，比赛系统是不可回避的基础设施，不能只加一个排行榜页面。

### 4.3 个性化发现与学习支持：基础已具备，但内容层明显落后，P0/P1

LeetCode 官方把 Explore 分成 Learn 和 Interview，并以章节导航、文章/视频/题目和完成状态组织学习；其 Study Plan 页面提供 Featured 和 My Study Plan。官方更新记录还显示，平台已经发展到 Smart List、动态筛选规则、Progress、知识图谱、提交分析、题目/公司/主题多维搜索和移动端同步。[LeetCode QuickStart](https://support.leetcode.com/hc/en-us/articles/360012067053-LeetCode-QuickStart-Guide)、[How to use Explore](https://support.leetcode.com/hc/en-us/articles/360013578114-How-to-use-Explore)、[LeetCode Study Plan](https://leetcode.com/studyplan/)、[LeetCode 功能更新](https://leetcode.com/discuss/post/5736503/)

洛谷题单则强调“简介 + 指导说明 + 题目列表 + 已完成状态”，同时允许官方、精选和用户分享题单。[洛谷题单](https://help.luogu.com.cn/manual/luogu/training)

StarStack 当前暂不提供独立学习路径模块，仍缺：

- 路径中的知识点讲解、学习目标和阶段验收；
- 用户创建/收藏/复制的自定义题单；
- 根据已做题、失败状态、难度和标签自动推荐下一题；
- 题目完成后的复盘入口：查看题解、讨论、复杂度和相似题；
- 按知识点聚合的掌握度、薄弱点和学习连续性；
- 低门槛的入门教程，帮助用户从“第一次登录”走到“第一次提交成功”。

这里不建议做用户之前明确不要的“错题本”和“复习星图”。后续如果需要增强学习支持，应优先把推荐、题解、提示和题目质量信号做好，不新增一套需要长期维护的路径产品。

### 4.4 题目搜索和发现：已有基础筛选，缺少质量排序和可组合列表，P1

Codeforces 题库把 Rating、标签、题目、通过人数和多种分类直接放在列表中；Kattis 题库还展示 Difficulty、Problem Type、Objective、Languages、Full Solves、Ratio、Fastest 和 Shortest，并提供单题统计页面。[Codeforces Problemset](https://codeforces.com/problemset?lang=en&locale=en)、[Kattis Problems](https://open.kattis.com/problems?language=en)、[Kattis Problem Statistics](https://open.kattis.com/problems/hello/statistics)

牛客题库同时提供题库分类、知识点、难度、已通过/未通过/未提交状态和视频题解入口；其知识点练习页进一步展示每个算法知识点的题量、练习人数和通过情况。[牛客全部编程题](https://www.nowcoder.com/exam/oj/ta?tpId=382)、[牛客知识点练习](https://ac.nowcoder.com/acm/skill/acm)

StarStack 目前已有搜索、标签、五层难度、已解决筛选、分页和每日题，但后续可以补：

- 按通过率、尝试人数、最近维护时间和题解数量排序；
- 组合筛选：难度 + 标签 + 已解决状态；
- 题目质量状态和“适合谁”标签；
- 用户收藏题单和管理员精选题单；
- 对搜索无结果、题解过少和测试点异常给出内容级提示。

### 4.5 评测能力与出题生产：核心可用，专业能力差距大，P1/P2

洛谷官方文档列出了标准输入输出、Linux 评测环境、O2、测试点配置、Special Judge、交互题、自定义计分脚本、个人题库与数据包上传等完整出题能力；还支持对测试点时间、内存和数据包进行配置。[洛谷题目功能说明](https://help.luogu.com.cn/manual/luogu/problem/)

Kattis 公开了问题包格式规范，用统一目录和文件名规则分发算法竞赛和教育问题包；题目页按难度、类型、语言和统计结果组织问题。[Kattis Problem Package Format](https://www.kattis.com/problem-package-format/)、[Kattis Problems](https://open.kattis.com/problems?language=en)

StarStack 当前已经解决了早期最重要的安全和正确性问题：用户代码进入沙箱，队列有并发/排队上限，测试点限时为 100～3000ms，输入规模和测试点数量有上限，支持 C++17/Python 3/Java 17。但仍不具备：

- Special Judge；
- 交互题；
- OI/IOI 式子任务或部分分；
- 自定义计分脚本；
- 标准化数据包导入/导出和本地验题命令；
- 题面、样例、测试点、标准程序、随机数据生成器的一体化版本发布；
- 编译器版本、依赖库和评测镜像的可追踪版本信息。

**判断：** 在题目数量还很少时，优先提高标准题的出题校验、测试点回归和错误提示，不要立刻加入交互题和自定义评分。这些功能会把沙箱、数据管理和争议处理复杂度提升一个数量级。

### 4.6 题解、讨论与社区治理：有功能，缺少“质量机制”，P1

Codeforces 把比赛、题库、提交状态、博客和社区贡献结合起来；LeetCode 的 Discuss 有 For you、Most Votes、All Time、Newest 和题目上下文讨论；洛谷提供题解审核、题解评论、点赞/点踩、讨论板块、文章、工单和学术规范。[Codeforces Help](https://codeforces.com/help?locale=en&mobile=true)、[LeetCode Discuss](https://leetcode.com/discuss/)、[洛谷题目功能说明](https://help.luogu.com.cn/manual/luogu/problem/)、[洛谷帮助中心](https://help.luogu.com.cn/)

StarStack 已有帖子、评论、点赞、题解、聊天、私信、通知、举报和管理员审核，这一点比单纯 OJ 更完整；但仍缺少：

- 题解/回答的质量排序、最佳回答或官方标记；
- 对题面错误、数据错误、题解错误的不同反馈类型；
- 举报后的状态通知、申诉和处理时限；
- 对重复题解、广告、刷屏和抄袭的识别；
- 内容贡献积分与权限之间的可解释关系；
- 更细的管理员角色，例如内容审核、题目审核、用户安全和只读运维。

洛谷账号文档显示，其权限不只是 `is_admin`，还按邮箱、实名/手机认证、受信任用户和动态等级分层，并把权限、私信、通知和社区行为连接起来。[洛谷账号与权限](https://help.luogu.com.cn/manual/luogu/account/)

StarStack 目前用户权限主要是普通用户/管理员二元开关，聊天室内部有房主/成员角色。短期不必复制复杂实名体系，但至少应建立“普通用户、已验证用户、题目作者、内容审核员、管理员”几类业务权限，并对敏感内容操作保留审计记录。

### 4.7 身份装饰和个人主页：这是 StarStack 的相对优势，但要绑定真实行为

LeetCode 已经使用由比赛 Rating 计算出的 Badge，并允许用户在个人资料和讨论中展示；官方说明明确将 Badge 与 Rating、排名和用户展示结合。[LeetCode Contest Badge](https://leetcode.com/discuss/post/934706/The-new-contest-badge-is-here%21/)

StarStack 的头像框、透明叠加层、等级/荣誉称号、热力图和个人资料编辑，比当前小型 OJ 常见的默认头像体验更有品牌辨识度。差距不在“装饰种类不够多”，而在于：

- 装饰解锁目前主要绑定等级/荣誉，还可以增加题目质量贡献、题解被认可、完成训练目标等可信行为；
- 装饰展示需要和排行榜、讨论、聊天、私信、通知等所有身份区域持续一致；
- 稀有装饰必须有清晰来源，避免用户误以为可以付费购买或后台直接发放；
- 应补充隐私开关，例如是否在公开评论中展示称号和头像叠加层。

这部分不应该被视为需要追赶大站的短板，而应作为 StarStack 的差异化品牌层，前提是底层学习行为真实可靠。

### 4.8 后端负载和生产能力：早期够用，距离规模化差距明显，P1/P2

StarStack 当前是 Node.js + Express + SQLite + PM2 + Nginx 的单机结构，评测队列以单进程并发上限和用户配额保护 2 核 2G 服务器；本地健康压力测试 200 请求、20 并发通过，但这只能证明当前接口在开发规模下稳定，不能推导公网生产吞吐。

成熟平台的公开资料已经体现出更大的运营规模：洛谷关于页面称其截至 2025 年底拥有 2.5 亿评测，并披露其平台面向学校和机构提供高级团队、评测 API、课程和命题咨询；AtCoder 公开列出 500k+ 用户和 6k+ Tasks；牛客比赛页面展示了持续运营的周赛、挑战赛、多校训练营、报名、Rating 和重现赛。[关于洛谷](https://help.luogu.com.cn/about-us)、[AtCoder 官方信息页](https://info.atcoder.jp/)、[牛客竞赛中心](https://ac.nowcoder.com/acm/contest/vip-index?internalFrom=sideBar)

StarStack 后续需要关注：

- API 进程与评测 worker 分离；
- 提交、编译、执行、数据库写入的分阶段耗时；
- 编译缓存、题目数据缓存和静态资源 CDN；
- 评测机故障转移、僵尸任务清理和重试策略；
- 数据库备份恢复演练和备份告警；
- Web Vitals、错误率、队列等待时间和每用户资源消耗的长期趋势。

但在当前用户量和题目量下，不建议先引入 Redis、Kafka、Kubernetes 或多节点评测。先建立指标，等单机的实测瓶颈出现后再拆分。

### 4.9 安全和反作弊：基础防护已较好，竞技安全还没完成

StarStack 最近已经完成了 HttpOnly Cookie 增量会话、CSRF 校验、请求输入限制、参数化 SQL、沙箱预检、资源配额和富文本清洗，基础 Web 安全处于“可继续运营”的水平。

成熟竞赛平台的安全难点还包括：

- 比赛期间的多账号和代码相似度检测；
- 测试数据泄露、硬编码、提交重判和错误数据争议处理；
- 高成本接口的精确限流和单用户配额；
- 题目作者、审核员、管理员之间的最小权限；
- 邮箱/手机/两步验证、账号申诉和风控记录。

Codeforces 明确禁止多账号、比赛期间交流和干扰评测系统；LeetCode 的竞赛规则还规定了多账号、相似代码、外部辅助和测试点问题的处理方式；洛谷则将邮箱、手机/实人认证、信任等级和社区权限关联起来。[Codeforces Help](https://codeforces.com/help?locale=en&mobile=true)、[LeetCode Contest Rules](https://leetcode.com/discuss/post/951105/)、[洛谷账号与权限](https://help.luogu.com.cn/manual/luogu/account/)

StarStack 暂时不需要做重量级反作弊，但如果未来上线比赛，代码相似度、赛中规则、重判流程和申诉机制必须与比赛系统一起设计。

## 五、按重要性排序的差距清单

| 优先级 | 差距 | 影响 | 建议 |
|---|---|---|---|
| P0 | 题目内容少、质量信号弱 | 用户做完几道题后没有继续留下来的理由 | 先建设 20～50 道高质量核心题，补标准题解、提示、错误样例和测试回归 |
| P0 | 提交结果和学习下一步仍可更强 | 用户知道“错了”，但不一定知道接下来怎么学 | 把 AC/WA/TLE/RE 连接到题解、讨论、相似题和推荐 |
| P1 | 没有题单/收藏/复制/完成进度的内容层 | 题库难以形成可传播的学习路线 | 做管理员精选题单和用户自定义题单，先不做复杂社交推荐 |
| P1 | 没有比赛闭环 | 缺少周期性回访和实力比较 | 先做轻量练习赛/固定时间赛，包含报名、题集、计时、排名、赛后回顾 |
| P1 | 出题审核链路不够专业 | 题目增长后容易出现弱数据和题面错误 | 增加标准程序校验、测试点批量回归、审核 checklist 和发布版本 |
| P1 | 社区质量机制不足 | 讨论越多越难找到可信内容 | 增加官方/最佳回答、质量排序、题目错误反馈和更细的审核权限 |
| P1 | 观测指标不够长期化 | 只能知道服务是否活着，不知道哪里变慢 | 增加 requestId、Web Vitals、评测阶段耗时、队列等待和错误趋势看板 |
| P2 | 高级评测类型缺失 | 无法覆盖专业竞赛全部题型 | 等标准题和比赛需求稳定后，再做 SPJ、交互题、子任务和自定义评分 |
| P2 | 单机架构扩展性有限 | 高并发时 API、SQLite 和评测互相争抢资源 | 先记录瓶颈，达到阈值后拆 worker、缓存和独立数据库读写 |
| P2 | 学校/团队/商业服务缺失 | 无法复制洛谷、牛客的机构业务 | 只有明确商业需求后，再设计租户、团队题库和计费体系 |

## 六、建议的产品路线

### 第一阶段：把“做一道题”变成完整学习闭环

目标不是增加页面，而是提升一次做题后的继续行动率：

1. 每道核心题补标准提示、官方题解、复杂度和常见错误；
2. 评测结果增加“查看原因、看提示、看题解、做相似题、获取推荐”；
3. 题目详情显示知识点、先修知识、推荐难度和维护状态；
4. 管理员可以对题面、样例和测试点执行一键回归；
5. 用完成率、首次 AC 时间、重复提交率和题解点击率衡量改动效果。

### 第二阶段：建立题单和内容传播能力

1. 管理员精选题单；
2. 用户创建、收藏、复制和完成题单；
3. 题单包含简介、适用人群、预计时间和阶段目标；
4. 题单中的题目展示完成状态和下一题；
5. 只开放有限的公开分享和举报，不做无限推荐流。

### 第三阶段：做轻量比赛，而不是一步复制 Codeforces

最小可行比赛应包含：

- 比赛创建/审核；
- 题目集合；
- 报名和开始/结束时间；
- 比赛期间提交与排名；
- 赛后题解和回顾；
- Unrated 练习赛和重现赛。

先不做 Hack、复杂 Rating、团队赛、IOI 部分分和多节点评测。等比赛稳定后再决定是否增加正式 Rating。

### 第四阶段：题目生产和安全专业化

1. 统一问题包和本地验题工具；
2. 标准程序、随机数据生成、边界样例和测试点回归；
3. 内容审核、题目审核、运维只读和安全管理员分权；
4. 比赛反作弊、相似代码检测和申诉流程；
5. 根据真实瓶颈拆分评测 worker 和缓存。

## 七、不建议现在追赶的内容

- 充值、商城和付费装饰；
- 复杂赛事、Hack、IOI/IOP 多种计分体系；
- Redis/Kafka/Kubernetes 等基础设施替换；
- AI 自动批改题解；
- 无限动态推荐流；
- 多层复杂社交关系；
- 用户自定义 CSS 和任意头像特效。

这些功能在成熟平台上成立，是因为它们背后有足够的题目、用户、内容审核、比赛运营和商业收入支撑。对当前 StarStack，优先级明显低于题目质量、学习闭环和评测可信度。

## 八、研究限制

- 各平台的用户数、题目数和比赛数量来自官方公开页面，动态页面会随时间变化；
- 没有各平台内部的真实 QPS、评测机数量、成本和故障率，因此不能据公开页面推导它们的工程吞吐；
- StarStack 的差距判断基于当前工作区代码、路由、数据库和最近本地发布门禁，不等同于生产服务器实时状态；
- “P0/P1/P2”是结合 StarStack 当前阶段做出的产品判断，不是竞争对手官方优先级。

## 九、来源索引

1. [Codeforces Help](https://codeforces.com/help?locale=en&mobile=true)
2. [Codeforces Problemset](https://codeforces.com/problemset?lang=en&locale=en)
3. [Codeforces Contests](https://codeforces.com/contests/?locale=en)
4. [AtCoder 官方信息页](https://info.atcoder.jp/)
5. [AtCoder 比赛列表](https://atcoder.jp/contests?lang=en)
6. [AtCoder ABC 461 题目页](https://atcoder.jp/contests/abc461/tasks)
7. [AtCoder 典型 90](https://atcoder.jp/contests/typical90?lang=ja)
8. [洛谷主站操作指南](https://help.luogu.com.cn/manual/luogu/)
9. [洛谷题目功能说明](https://help.luogu.com.cn/manual/luogu/problem/)
10. [洛谷账号与权限](https://help.luogu.com.cn/manual/luogu/account/)
11. [洛谷题单](https://help.luogu.com.cn/manual/luogu/training)
12. [关于洛谷](https://help.luogu.com.cn/about-us)
13. [牛客全部编程题](https://www.nowcoder.com/exam/oj/ta?tpId=382)
14. [牛客竞赛中心](https://ac.nowcoder.com/acm/contest/vip-index?internalFrom=sideBar)
15. [牛客知识点练习](https://ac.nowcoder.com/acm/skill/acm)
16. [LeetCode QuickStart](https://support.leetcode.com/hc/en-us/articles/360012067053-LeetCode-QuickStart-Guide)
17. [LeetCode Explore](https://support.leetcode.com/hc/en-us/articles/360013578114-How-to-use-Explore)
18. [LeetCode Study Plan](https://leetcode.com/studyplan/)
19. [LeetCode 功能更新](https://leetcode.com/discuss/post/5736503/)
20. [LeetCode Discuss](https://leetcode.com/discuss/)
21. [LeetCode Contest Rules](https://leetcode.com/discuss/post/951105/)
22. [LeetCode Contest Badge](https://leetcode.com/discuss/post/934706/The-new-contest-badge-is-here%21/)
23. [Kattis Problems](https://open.kattis.com/problems?language=en)
24. [Kattis Problem Statistics](https://open.kattis.com/problems/hello/statistics)
25. [Kattis Problem Package Format](https://www.kattis.com/problem-package-format/)
