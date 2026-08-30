export const TOKEN_KEY = 'starstack_token'

// 做题功能开关（只做停用，不删除代码）：
// - false：暂时停用全部做题相关内容 —— 题库/题目详情/代码评测/提交记录及其所有入口、
//   排行榜、个人中心的做题数据（热力图/成就/刷题计划/Rating/连续天数等）
// - true：完整恢复做题功能
// 后端 API（/api/oj/*、/api/leaderboard 等）保持原样，不受此开关影响。
export const OJ_ENABLED = true

export const DEFAULT_TESTCASE_TIME_LIMIT_MS = 1500
export const MIN_TESTCASE_TIME_LIMIT_MS = 100
export const MAX_TESTCASE_TIME_LIMIT_MS = 3000

export const LANGUAGE_OPTIONS = [
  {
    label: 'C++17',
    value: 'C++',
    monaco: 'cpp',
    template:
      '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n  ios::sync_with_stdio(false);\n  cin.tie(nullptr);\n\n  return 0;\n}\n',
  },
  {
    label: 'Python 3',
    value: 'Python',
    monaco: 'python',
    template: 'def main():\n    pass\n\n\nif __name__ == "__main__":\n    main()\n',
  },
  {
    label: 'Java 17',
    value: 'Java',
    monaco: 'java',
    template:
      'import java.io.*;\nimport java.util.*;\n\npublic class Main {\n    public static void main(String[] args) throws Exception {\n        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));\n    }\n}\n',
  },
]

export const DIFFICULTY_LEVELS = [
  { key: 'simple', label: '简单', colorToken: '--ss-difficulty-simple' },
  { key: 'medium', label: '中等', colorToken: '--ss-difficulty-medium' },
  { key: 'challenging', label: '较难', colorToken: '--ss-difficulty-challenging' },
  { key: 'difficult', label: '困难', colorToken: '--ss-difficulty-difficult' },
  { key: 'extreme', label: '极难', colorToken: '--ss-difficulty-extreme' },
] as const

export type DifficultyKey = typeof DIFFICULTY_LEVELS[number]['key']
export const DIFFICULTY_OPTIONS = DIFFICULTY_LEVELS.map((item) => item.key)

// 预设标签列表（参考洛谷）
export const PRESET_TAGS = [
  '动态规划', '贪心', '搜索', '深度优先搜索', '广度优先搜索',
  '图论', '最短路', '最小生成树', '树', '二叉树',
  '线段树', '树状数组', '并查集', '字符串', '字符串匹配',
  '前缀和', '差分', '数学', '数论', '组合数学',
  '概率论', '计算几何', '模拟', '枚举', '递推', '递归',
  '分治', '二分', '排序', '哈希', '栈',
  '队列', '链表', '堆', '位运算', '高精度',
  '矩阵', '博弈论', '网络流', '二分图', '拓扑排序',
  '强连通分量', '欧拉回路', '哈密尔顿回路', '最近公共祖先', '树链剖分',
  '莫队算法', '单调栈', '单调队列', '滑动窗口', '双指针',
  '快速幂', '矩阵快速幂', '线性代数', '容斥原理', '逆元',
  '中国剩余定理', '扩展欧几里得', '筛法', '质数', '因数分解',
  '最大公约数', '最小公倍数', '斐波那契', '卡特兰数', '斯特林数',
  '莫比乌斯反演', '生成函数', '多项式', 'FFT', 'NTT',
  '后缀数组', '后缀自动机', 'AC自动机', 'KMP', '马拉车算法',
  '回文树', '字典树', '平衡树', 'Treap', '伸展树',
  '红黑树', '跳表', '可持久化数据结构', '主席树', '分块',
  '根号分治', '点分治', '边分治', '虚树', '动态树',
  'LCT', '线性规划', '网络流24题', '费用流', '上下界网络流',
  '2-SAT', '构造', '交互题', '提答题', 'Special Judge',
]

// 题目标签按知识点/技巧分组，编辑题目时使用分组浏览；存储仍保持原有 tags 字段兼容。
export const PROBLEM_TAG_CATEGORIES = [
  { key: 'fundamentals', label: '基础与思维', tags: ['模拟', '枚举', '递推', '排序', '二分', '前缀和', '差分', '双指针', '滑动窗口', '构造'] },
  { key: 'data-structures', label: '数据结构', tags: ['栈', '队列', '链表', '堆', '哈希', '树', '二叉树', '线段树', '树状数组', '并查集', '字典树', '平衡树', 'Treap', '伸展树', '红黑树', '跳表', '可持久化数据结构', '主席树', '分块', '单调栈', '单调队列', '动态树', 'LCT'] },
  { key: 'algorithms', label: '算法策略', tags: ['贪心', '分治', '递归', '搜索', '深度优先搜索', '广度优先搜索', '动态规划', '快速幂', '矩阵快速幂', '线性规划'] },
  { key: 'graphs', label: '图论', tags: ['图论', '最短路', '最小生成树', '拓扑排序', '强连通分量', '欧拉回路', '哈密尔顿回路', '最近公共祖先', '树链剖分', '网络流', '二分图', '网络流24题', '费用流', '上下界网络流', '2-SAT'] },
  { key: 'math', label: '数学', tags: ['数学', '数论', '组合数学', '概率论', '计算几何', '高精度', '矩阵', '线性代数', '容斥原理', '逆元', '中国剩余定理', '扩展欧几里得', '筛法', '质数', '因数分解', '最大公约数', '最小公倍数', '斐波那契', '卡特兰数', '斯特林数', '莫比乌斯反演', '生成函数', '多项式', 'FFT', 'NTT'] },
  { key: 'strings', label: '字符串', tags: ['字符串', '字符串匹配', 'KMP', '马拉车算法', '回文树', '后缀数组', '后缀自动机', 'AC自动机'] },
] as const

export const getLanguageConfig = (value: string) =>
  LANGUAGE_OPTIONS.find((item) => item.value === value) ?? LANGUAGE_OPTIONS[0]
