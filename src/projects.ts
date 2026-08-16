// =============================================================
// 星栈 · 项目大厅配置
// -------------------------------------------------------------
// 主站点首页（项目大厅）展示的项目都定义在这里，改这一份配置即可
// 增删项目卡片，不需要动页面代码。
//
// kind 取值：
//   - 'internal' : 本站内部功能（走站内路由，如 /oj）
//   - 'external' : 独立网页应用（同一域名子路径或公网 URL）
//   - 'desktop'  : 桌面应用（网页无法运行，只做介绍 + 下载/启动入口）
//
// 部署到正式域名后，把 external 的 href 改成站内子路径即可，
// 例如 'https://你的域名/jieya/'（Nginx 见根目录 nginx.conf 示例）。
// =============================================================

export interface PortalProject {
  id: string
  name: string
  kicker: string
  tagline: string
  description: string
  kind: 'internal' | 'external' | 'desktop'
  href: string
  external?: boolean
  featured?: boolean
  badges?: string[]
  /** 桌面应用的本地启动指引（kind === 'desktop' 时展示） */
  launchHint?: string
}

export const PORTAL_PROJECTS: PortalProject[] = [
  {
    id: 'oj',
    name: '评测 OJ',
    kicker: 'StarStack Online Judge',
    tagline: '题库 · 代码评测 · 提交记录',
    description: '竞赛编程在线评测平台：C++17 / Python 3 / Java 17 评测，题目讨论、排行榜与成长记录都在这里。',
    kind: 'internal',
    href: '/oj',
    featured: true,
    badges: ['C++17', 'Python 3', 'Java 17'],
  },
  {
    id: 'jieya',
    name: '界芽计划',
    kicker: 'Project JIEYA',
    tagline: '一颗种子，由你塑造成世界',
    description: '本地优先的 2D 创造型世界沙盒：塑造地形、调节气候，观察世界对每次改造产生确定、可解释的回应。',
    kind: 'external',
    href: 'https://xiaobanmodao.github.io/Project-JIEYA-Preview/',
    external: true,
    badges: ['网页应用', '无需账号'],
  },
  {
    id: 'starcode',
    name: 'StarCode',
    kicker: 'Code Editor',
    tagline: '面向信息学奥赛训练的轻量 C++ 编辑器',
    description: '桌面代码编辑器：Monaco 编辑、终端、编译运行一体化，专注竞赛训练场景。桌面应用，请在本地启动或下载安装包。',
    kind: 'desktop',
    href: '/starcode',
    badges: ['桌面应用', 'macOS'],
    launchHint: 'cd ~/Desktop/starcode && npm start',
  },
]
