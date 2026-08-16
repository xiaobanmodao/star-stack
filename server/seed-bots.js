// =============================================================
// 批量创建人机用户（功能验证用）
// 用法：node seed-bots.js
// 所有账号密码统一为：12345678
// 可重复运行：已存在的账号会自动改为登录，不会重复创建关系。
// =============================================================
const BASE = 'http://localhost:5174'
const PASSWORD = '12345678'

const USERS = [
  { id: 'astro01', name: '星尘旅人' },
  { id: 'astro02', name: '深空电台' },
  { id: 'astro03', name: '银河面包师' },
  { id: 'astro04', name: '极光观察员' },
  { id: 'astro05', name: '黑洞研究员' },
  { id: 'astro06', name: '轨道清洁工' },
  { id: 'astro07', name: '月面信使' },
  { id: 'astro08', name: '星际邮差' },
  { id: 'astro09', name: '双子星' },
  { id: 'astro10', name: '超新星' },
  { id: 'astro11', name: '引力透镜' },
  { id: 'astro12', name: '量子企鹅' },
]

// 关注关系：互相关注的会成为好友
const FOLLOWS = [
  ['astro01', 'astro02'], ['astro01', 'astro03'], ['astro01', 'astro05'],
  ['astro02', 'astro01'], ['astro02', 'astro04'],
  ['astro03', 'astro01'], ['astro03', 'astro06'],
  ['astro04', 'astro02'],
  ['astro05', 'astro01'], ['astro05', 'astro06'],
  ['astro06', 'astro05'],
  ['astro07', 'astro01'], ['astro08', 'astro01'], ['astro09', 'astro02'], ['astro10', 'astro01'],
]

// 帖子（富文本：代码 / 数学公式 / 大小字）
const POSTS = [
  {
    author: 'astro01', module: 'general', title: '新人报到：大家好，我是星尘旅人',
    content: '<p>刚加入星栈，<span class="text-lg">请大家多多关照</span>。平时喜欢刷题和造世界，偶尔也写写代码。</p><p>爱好：算法、界芽、<span class="text-sm">深夜电台</span>。</p>',
  },
  {
    author: 'astro02', module: 'oj', title: 'P1001 星尘求和 题解：前缀和',
    content: '<p>这题就是经典前缀和：</p><pre><code class="language-cpp">#include &lt;bits/stdc++.h&gt;\nusing namespace std;\nint main() {\n  int n; cin &gt;&gt; n;\n  vector&lt;long long&gt; a(n+1), pre(n+1);\n  for (int i = 1; i &lt;= n; i++) { cin &gt;&gt; a[i]; pre[i] = pre[i-1] + a[i]; }\n  cout &lt;&lt; pre[n] &lt;&lt; endl;\n}</code></pre><p>复杂度 O(n)，公式：$$S_n = \\sum_{i=1}^{n} a_i$$，区间和就是 $$S_r - S_{l-1}$$。</p>',
  },
  {
    author: 'astro04', module: 'oj', title: 'P1002 能量峰值 求助：为什么 WA？',
    content: '<p>我的代码在样例上是对的：</p><pre><code class="language-python">n = int(input())\na = list(map(int, input().split()))\nprint(max(a))</code></pre><p>但是提交全 WA，<span class="text-lg">求调</span>！是不是没考虑负数？</p>',
  },
  {
    author: 'astro03', module: 'general', title: '深空电台开播：今日闲聊楼',
    content: '<p>今日话题：你最喜欢哪个模块？我先来——<strong>界芽计划</strong>，捏地形太解压了。</p>',
  },
  {
    author: 'astro05', module: 'jieya', title: '我在界芽里造了一座环形山',
    content: '<p>花了一晚上，用高程工具堆了一座环形山，中间放了个湖。截图在评论区。</p><p>心得：先围山脊，再中间挖坑，最后引水，<span class="text-lg">效果拔群</span>。</p>',
  },
  {
    author: 'astro06', module: 'jieya', title: '界芽地形改造心得：河流怎么挖',
    content: '<p>挖河先定源头，<span class="text-sm">海拔差越大流速越快</span>。想让河变宽，就在中段多挖几格。</p><pre><code class="language-json">{\n  "plan": "源头 → 山脊缺口 → 平原 → 入湖",\n  "width": 3,\n  "depth": 2\n}</code></pre>',
  },
  {
    author: 'astro07', module: 'starcode', title: 'StarCode 使用反馈：希望增加编译参数配置',
    content: '<p>用了一段时间 StarCode，整体很顺手。建议：<span class="text-lg">编译参数可以自定义</span>，比如 -O2 开关。</p><pre><code class="language-bash">g++ main.cpp -O2 -std=c++17 -o main</code></pre>',
  },
  {
    author: 'astro08', module: 'starcode', title: '分享：我的 StarCode 主题配色',
    content: '<p>Monaco 里我最爱的暗色组合：</p><pre><code class="language-json">{\n  "background": "#0b1120",\n  "foreground": "#e2e8f0",\n  "keyword": "#7dd3fc",\n  "string": "#86efac",\n  "comment": "#64748b"\n}</code></pre>',
  },
  {
    author: 'astro09', module: 'oj', title: '动态规划入门思路整理',
    content: '<p>DP 四步：定义状态、写转移、定初值、求答案。以背包为例：$$dp[i][j] = \\max(dp[i-1][j],\\ dp[i-1][j-w_i] + v_i)$$</p><p>先把 <code>dp</code> 表画出来，思路会清晰很多。</p>',
  },
  {
    author: 'astro10', module: 'general', title: '周末组队：算法茶馆已开张，欢迎来聊',
    content: '<p>我在「算法茶馆」聊天室蹲着，<span class="text-lg">周末晚上 8 点</span>一起讨论周赛题，欢迎加入。</p>',
  },
]

// 聊天室：[房主, 房间名, 类型, 成员列表, 消息列表]
const ROOMS = [
  {
    owner: 'astro01', name: '算法茶馆', type: 'public',
    members: ['astro02', 'astro03', 'astro04', 'astro05'],
    messages: [
      ['astro01', '欢迎来到算法茶馆，本店只聊算法不聊八卦 ☕'],
      ['astro02', '今晚有人做 P1003 吗？我卡在贪心证明上了'],
      ['astro04', '做了，思路是先排序再双指针，复杂度 O(n log n)'],
      ['astro01', '代码贴一下？'],
      ['astro04', '```cpp\nsort(a.begin(), a.end());\nint j = 0;\nfor (int i = 0; i < n; i++) { ... }\n```'],
      ['astro05', '路过，顺便问一句界芽计划的地形算法和贪心有关系吗（逃'],
    ],
  },
  {
    owner: 'astro02', name: '星图测绘队', type: 'invite',
    members: ['astro01', 'astro06'],
    messages: [
      ['astro02', '这里是邀请制房间，只有被邀请的人能看到'],
      ['astro01', '收到，测试一下私密性 🕶️'],
      ['astro06', '已就位，测绘任务开始'],
    ],
  },
]

// 私信：[发送者, 接收者, 内容]
const DMS = [
  ['astro01', 'astro02', '你好！看到你的 P1001 题解了，写得很清楚，谢谢'],
  ['astro02', 'astro01', '不客气，有问题随时问我'],
  ['astro03', 'astro01', '关注你啦，有空来面包店坐坐 🍞'],
  ['astro05', 'astro01', '环形山建好了，来看看？'],
]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// 聊天发送有 1 秒冷却，同一用户连续发言间隔需 > 1000ms
const CHAT_GAP_MS = 1200

async function api(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await response.json() } catch { /* 空响应 */ }
  return { ok: response.ok, status: response.status, data }
}

async function main() {
  console.log('== 1/6 创建/登录账号 ==')
  const tokens = {}
  for (const user of USERS) {
    const reg = await api('/api/register', { method: 'POST', body: { id: user.id, name: user.name, password: PASSWORD } })
    if (reg.ok && reg.data?.token) {
      tokens[user.id] = reg.data.token
      console.log(`  创建 ${user.id} (${user.name})`)
      continue
    }
    const login = await api('/api/login', { method: 'POST', body: { id: user.id, password: PASSWORD } })
    if (login.ok && login.data?.token) {
      tokens[user.id] = login.data.token
      console.log(`  已存在，登录 ${user.id}`)
    } else {
      console.error(`  失败: ${user.id} - ${reg.data?.message || login.data?.message}`)
    }
  }

  console.log('== 2/6 建立关注关系 ==')
  for (const [follower, followee] of FOLLOWS) {
    const result = await api(`/api/users/${followee}/follow`, { method: 'POST', token: tokens[follower] })
    if (result.ok) console.log(`  ${follower} → ${followee}`)
    else console.error(`  失败: ${follower} → ${followee}: ${result.data?.message}`)
  }

  console.log('== 3/6 发帖（富文本） ==')
  for (const post of POSTS) {
    // 幂等：标题已存在则跳过
    const existing = await api(`/api/discussions?search=${encodeURIComponent(post.title)}&pageSize=5`)
    if (existing.ok && existing.data?.posts?.some((p) => p.title === post.title)) {
      console.log(`  已存在，跳过 [${post.module}] ${post.title}`)
      continue
    }
    const result = await api('/api/discussions', {
      method: 'POST', token: tokens[post.author],
      body: { title: post.title, content: post.content, moduleKey: post.module },
    })
    if (result.ok) console.log(`  [${post.module}] ${post.author}: ${post.title}`)
    else console.error(`  失败: ${post.title}: ${result.data?.message}`)
    await sleep(300)
  }

  console.log('== 4/6 创建聊天室 ==')
  for (const room of ROOMS) {
    // 幂等：房主已拥有同名房间则跳过
    const list = await api('/api/chat/rooms', { token: tokens[room.owner] })
    const existingRoom = list.ok
      ? list.data?.rooms?.find((r) => r.name === room.name)
      : null
    if (existingRoom) {
      console.log(`  已存在，跳过 ${room.name} (id=${existingRoom.id})`)
      continue
    }
    const created = await api('/api/chat/rooms', {
      method: 'POST', token: tokens[room.owner],
      body: { name: room.name, description: `${room.type === 'invite' ? '邀请制' : '公开'}测试房间`, type: room.type },
    })
    if (!created.ok || !created.data?.roomId) {
      console.error(`  创建失败: ${room.name}: ${created.data?.message}`)
      continue
    }
    const roomId = created.data.roomId
    console.log(`  创建 ${room.name} (id=${roomId}, ${room.type})`)
    for (const member of room.members) {
      const invited = await api(`/api/chat/rooms/${roomId}/members`, {
        method: 'POST', token: tokens[room.owner], body: { userId: member },
      })
      if (invited.ok) console.log(`    邀请 ${member}`)
    }
    for (const [sender, content] of room.messages) {
      const sent = await api(`/api/chat/rooms/${roomId}/messages`, {
        method: 'POST', token: tokens[sender], body: { content },
      })
      if (sent.ok) console.log(`    ${sender}: ${content.slice(0, 30)}...`)
      else console.error(`    消息失败: ${sender}: ${sent.data?.message}`)
      await sleep(CHAT_GAP_MS)
    }
  }

  console.log('== 5/6 私信 ==')
  for (const [sender, receiver, content] of DMS) {
    // 幂等：该会话已存在相同内容则跳过
    const history = await api(`/api/messages/conversations/${receiver}?page=1&pageSize=50`, { token: tokens[sender] })
    if (history.ok && history.data?.messages?.some((m) => m.content === content)) {
      console.log(`  已存在，跳过 ${sender} → ${receiver}`)
      continue
    }
    const result = await api(`/api/messages/conversations/${receiver}`, {
      method: 'POST', token: tokens[sender], body: { content },
    })
    if (result.ok) console.log(`  ${sender} → ${receiver}: ${content.slice(0, 24)}...`)
    else console.error(`  失败: ${sender} → ${receiver}: ${result.data?.message}`)
    await sleep(CHAT_GAP_MS)
  }

  console.log('== 6/6 点亮在线状态（演示用，60 秒后自动离线） ==')
  for (const user of USERS.slice(0, 6)) {
    await api('/api/chat/presence', { method: 'POST', token: tokens[user.id] })
  }

  console.log('\n✅ 完成！账号密码均为 12345678，推荐先用 astro01 登录验证：')
  console.log('  - 个人中心 /account：关注 3 / 粉丝 6 / 好友 3')
  console.log('  - 好友：astro02 深空电台、astro03 银河面包师、astro05 黑洞研究员')
  console.log('  - 聊天中心：各模块帖子、算法茶馆（公开）、星图测绘队（邀请制）')
  console.log('  - 私信：astro01 与 astro02 / astro03 / astro05 有历史对话')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
