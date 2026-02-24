import { useNavigate } from 'react-router-dom'

type Feature = {
  icon: string
  title: string
  desc: string
}

type UpdateGroup = {
  title: string
  items: string[]
}

const REPO_URL = 'https://github.com/xiaobanmodao/starbot'
const LOCAL_PROJECT_PATH = 'C:\\Users\\胡书源\\Desktop\\starbot'

const openRepo = () => {
  window.open(REPO_URL, '_blank', 'noopener,noreferrer')
}

const listStyle = {
  margin: 0,
  paddingLeft: '18px',
  lineHeight: 1.7,
  color: 'var(--muted)',
} as const

const features: Feature[] = [
  {
    icon: '🤖',
    title: 'Discord 远程控制',
    desc: '通过 Discord 接收自然语言指令，在本地 Windows 电脑上执行自动化操作。',
  },
  {
    icon: '🖱️',
    title: '桌面自动化',
    desc: '支持鼠标、键盘、窗口操作、截图等常见桌面任务。',
  },
  {
    icon: '🌐',
    title: '网页与文件处理',
    desc: '支持网页检索/抓取、文件读写/搜索，并可配合 LLM 完成自动化流程。',
  },
  {
    icon: '🧠',
    title: '记忆与后台任务',
    desc: '支持长期记忆、后台任务执行与进度查询，适合连续任务场景。',
  },
  {
    icon: '🩺',
    title: '配置向导与诊断',
    desc: '新版本支持配置向导（config_wizard.py）和 `/doctor` 诊断命令，便于部署与排障。',
  },
  {
    icon: '🧩',
    title: '外部 Skills 生态',
    desc: '支持安装外部 `SKILL.md` 技能包扩展能力（此页面仅做介绍，不展开机制细节）。',
  },
]

const recentUpdates: UpdateGroup[] = [
  {
    title: '近期已同步（基于本机 StarBot 项目）',
    items: [
      '新增独立配置向导 `config_wizard.py`。',
      '支持命令行重跑配置：`start.py setup/config/--setup/--setup-only`。',
      '新增 `/doctor` 用于依赖与能力诊断。',
      '新增外部 `SKILL.md` 生态支持（安装/更新能力）。',
    ],
  },
  {
    title: '本页保留内容范围',
    items: [
      '项目介绍（用途、能力概览、系统要求）。',
      '安装与部署教程（下载、依赖、配置、启动、排障）。',
      '不展示详细机制实现与完整工具清单。',
    ],
  },
]

function SourceBadge({ children }: { children: string }) {
  return (
    <span className="starbot-badge" style={{ letterSpacing: '0.02em' }}>
      {children}
    </span>
  )
}

export function StarBotPageView() {
  const navigate = useNavigate()

  return (
    <section className="starbot-page">
      <div className="starbot-hero">
        <div className="starbot-hero-icon">🤖</div>
        <div className="starbot-hero-content">
          <div className="starbot-hero-title-row">
            <h1 className="starbot-title">StarBot</h1>
            <span className="starbot-badge starbot-badge-green">Windows 智能代理</span>
            <span className="starbot-badge starbot-badge-blue">Discord 远程控制</span>
            <span className="starbot-badge starbot-badge-purple">LLM 驱动</span>
          </div>
          <p className="starbot-desc">
            StarBot 是一个运行在本地 Windows 机器上的 AI 自动化代理。你可以通过 Discord 发送自然语言指令，
            让它在你的电脑上执行桌面操作、网页/文件任务，并结合大语言模型完成更复杂的自动化流程。
          </p>
          <div className="starbot-stats-row">
            <div className="starbot-stat">
              <span className="starbot-stat-num">50+</span>
              <span className="starbot-stat-label">内置能力与工具</span>
            </div>
            <div className="starbot-stat">
              <span className="starbot-stat-num">3.12+</span>
              <span className="starbot-stat-label">Python 要求</span>
            </div>
            <div className="starbot-stat">
              <span className="starbot-stat-num">Windows</span>
              <span className="starbot-stat-label">本地运行环境</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button className="primary" onClick={() => navigate('/starbot/get-started')}>
              查看安装部署教程
            </button>
            <button className="ghost" onClick={openRepo}>
              打开 GitHub 仓库
            </button>
          </div>
        </div>
      </div>

      <section className="starbot-section">
        <h3 className="starbot-section-title">同步来源（本次更新依据）</h3>
        <div className="starbot-install-card">
          <div className="starbot-install-label">读取的本机项目文件</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <SourceBadge>{LOCAL_PROJECT_PATH}</SourceBadge>
            <SourceBadge>README.md</SourceBadge>
            <SourceBadge>CHANGELOG.md</SourceBadge>
            <SourceBadge>.env.template</SourceBadge>
            <SourceBadge>pyproject.toml</SourceBadge>
          </div>
          <div className="starbot-tools-grid">
            {recentUpdates.map((group) => (
              <div key={group.title} className="starbot-tool-group">
                <div className="starbot-tool-group-name">{group.title}</div>
                <ul style={listStyle}>
                  {group.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="starbot-section">
        <h3 className="starbot-section-title">项目介绍</h3>
        <div className="starbot-features-grid">
          {features.map((item) => (
            <div key={item.title} className="starbot-feature-card">
              <div className="starbot-feature-icon">{item.icon}</div>
              <div>
                <div className="starbot-feature-title">{item.title}</div>
                <div className="starbot-feature-desc">{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="starbot-section starbot-two-col">
        <div id="starbot-step-2" className="starbot-anchor-subsection">
          <h3 className="starbot-section-title">系统要求</h3>
          <div className="starbot-req-list">
            <div className="starbot-req-row"><span className="starbot-req-key">操作系统</span><span className="starbot-req-val">Windows 10 / 11</span></div>
            <div className="starbot-req-row"><span className="starbot-req-key">Python</span><span className="starbot-req-val">3.12+（来自 `pyproject.toml`）</span></div>
            <div className="starbot-req-row"><span className="starbot-req-key">LLM 接口</span><span className="starbot-req-val">OpenAI 兼容接口（可配置主/备 LLM）</span></div>
            <div className="starbot-req-row"><span className="starbot-req-key">Discord</span><span className="starbot-req-val">需要 Bot Token、Owner ID、频道权限</span></div>
            <div className="starbot-req-row"><span className="starbot-req-key">可选组件</span><span className="starbot-req-val">Playwright / Tesseract / yt-dlp / faster-whisper</span></div>
          </div>
        </div>
        <div>
          <h3 className="starbot-section-title">快速开始（概览）</h3>
          <div className="starbot-install-methods">
            <div className="starbot-install-card">
              <div className="starbot-install-label">推荐方式：uv</div>
              <pre className="starbot-code">{`git clone ${REPO_URL}
cd starbot
uv sync
Copy-Item .env.template .env
uv run python start.py`}</pre>
            </div>
            <div className="starbot-install-card">
              <div className="starbot-install-label">备选方式：pip</div>
              <pre className="starbot-code">{`pip install -r requirements.txt
python start.py`}</pre>
            </div>
            <div className="starbot-install-card">
              <div className="starbot-install-label">完整教程</div>
              <div className="starbot-feature-desc">
                查看下一页“开始使用”，包含配置向导、`.env`、Discord Bot、启动部署与排障步骤。
              </div>
              <div style={{ marginTop: 10 }}>
                <button className="primary" onClick={() => navigate('/starbot/get-started')}>
                  进入完整教程
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </section>
  )
}

export function StarBotGettingStartedView() {
  const navigate = useNavigate()
  const tutorialSteps: Array<[string, string, string]> = [
    ['1', '环境检查', 'starbot-step-1'],
    ['2', '下载项目', 'starbot-step-2'],
    ['3', '安装依赖', 'starbot-step-3'],
    ['4', '运行配置向导', 'starbot-step-4'],
    ['5', '配置 Discord Bot', 'starbot-step-5'],
    ['6', '启动与验证', 'starbot-step-6'],
    ['7', '可选组件与排障', 'starbot-step-7'],
  ]
  const scrollToStep = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <section className="starbot-page starbot-page-tutorial">
      <div className="starbot-hero" style={{ padding: '24px 28px' }}>
        <div className="starbot-hero-icon">📘</div>
        <div className="starbot-hero-content">
          <div className="starbot-hero-title-row">
            <h1 className="starbot-title">安装部署教程</h1>
            <span className="starbot-badge">精简版：只保留安装与部署相关内容</span>
          </div>
          <p className="starbot-desc">
            本教程基于你本机 <code>{LOCAL_PROJECT_PATH}</code> 的最新 README / CHANGELOG / `.env.template` / `pyproject.toml`
            整理，聚焦安装、配置、启动、部署与排障，不展开详细机制实现。
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button className="ghost" onClick={() => navigate('/starbot')}>
              返回 StarBot 介绍
            </button>
            <button className="primary" onClick={openRepo}>
              打开 GitHub 仓库
            </button>
          </div>
        </div>
      </div>

      <section className="starbot-section starbot-tutorial-overview">
        <h3 className="starbot-section-title">部署步骤概览</h3>
        <div className="starbot-tutorial-stepbar" data-no-auto-translate>
          {tutorialSteps.map(([no, label, targetId]) => (
            <button
              key={no}
              type="button"
              className="starbot-tutorial-stepchip"
              onClick={() => scrollToStep(targetId)}
              aria-label={`跳转到步骤 ${no}: ${label}`}
              title={`跳转到步骤 ${no}`}
            >
              <span className="starbot-tutorial-stepchip-num">{no}</span>
              <span className="starbot-tutorial-stepchip-label">{label}</span>
            </button>
          ))}
        </div>
        <div className="starbot-feature-desc">
          建议按顺序执行。大多数问题都可以通过配置向导和 <code>/doctor</code> 在早期发现。
        </div>
      </section>

      <section id="starbot-step-1" className="starbot-section starbot-two-col starbot-anchor-section">
        <div>
          <h3 className="starbot-section-title">1. 环境要求</h3>
          <div className="starbot-req-list">
            <div className="starbot-req-row"><span className="starbot-req-key">系统</span><span className="starbot-req-val">Windows 10 / 11</span></div>
            <div className="starbot-req-row"><span className="starbot-req-key">Python</span><span className="starbot-req-val">3.12+（`pyproject.toml`）</span></div>
            <div className="starbot-req-row"><span className="starbot-req-key">Discord</span><span className="starbot-req-val">需要 Bot Token / Owner ID / 频道权限</span></div>
            <div className="starbot-req-row"><span className="starbot-req-key">LLM API</span><span className="starbot-req-val">OpenAI 兼容接口（支持主/备 LLM）</span></div>
          </div>
        </div>
        <div>
          <h3 className="starbot-section-title">2. 下载项目</h3>
          <div className="starbot-install-methods">
            <div className="starbot-install-card">
              <div className="starbot-install-label">Git 克隆（推荐）</div>
              <pre className="starbot-code">{`git clone ${REPO_URL}
cd starbot`}</pre>
            </div>
            <div className="starbot-install-card">
              <div className="starbot-install-label">ZIP 下载（备选）</div>
              <pre className="starbot-code">{`GitHub -> Code -> Download ZIP
解压后进入 starbot 目录`}</pre>
            </div>
          </div>
        </div>
      </section>

      <section id="starbot-step-3" className="starbot-section starbot-anchor-section">
        <h3 className="starbot-section-title">3. 安装依赖</h3>
        <div className="starbot-install-methods">
          <div className="starbot-install-card">
            <div className="starbot-install-label">方式 A：uv（推荐）</div>
            <pre className="starbot-code">{`# 如未安装 uv
pip install uv

# 安装依赖
uv sync`}</pre>
          </div>
          <div className="starbot-install-card">
            <div className="starbot-install-label">方式 B：pip</div>
            <pre className="starbot-code">{`pip install -r requirements.txt`}</pre>
          </div>
          <div className="starbot-install-card">
            <div className="starbot-install-label">方式 C：双击启动器</div>
            <pre className="starbot-code">{`启动Starbot.bat`}</pre>
          </div>
        </div>
      </section>

      <section id="starbot-step-4" className="starbot-section starbot-two-col starbot-anchor-section">
        <div>
          <h3 className="starbot-section-title">4. 配置方式（推荐先用配置向导）</h3>
          <div className="starbot-install-card">
            <div className="starbot-install-label">命令行重跑配置（新版本支持）</div>
            <pre className="starbot-code">{`python start.py --setup`}</pre>
          </div>
          <div className="starbot-install-card" style={{ marginTop: 10 }}>
            <div className="starbot-install-label">配置向导说明</div>
            <ul style={listStyle}>
              <li>按步骤配置 LLM / Discord / Proxy。</li>
              <li>已配置项支持 <code>Skip / Modify</code>，方便后续调整。</li>
              <li>适合首次安装和后续维护。</li>
            </ul>
          </div>
        </div>
        <div>
          <h3 className="starbot-section-title">5. 手动配置 `.env`（来自 `.env.template`）</h3>
          <div className="starbot-install-card">
            <div className="starbot-install-label">复制模板</div>
            <pre className="starbot-code">{`# PowerShell
Copy-Item .env.template .env`}</pre>
          </div>
          <div className="starbot-install-card" style={{ marginTop: 10 }}>
            <div className="starbot-install-label">当前模板字段（本机项目）</div>
            <pre className="starbot-code">{`# ===== Primary LLM =====
LLM_API_BASE=
LLM_API_KEY=
LLM_MODEL=claude-sonnet-4-20250514

# ===== Secondary LLM (optional fallback) =====
LLM2_API_BASE=
LLM2_API_KEY=
LLM2_MODEL=

# ===== Discord =====
DISCORD_BOT_TOKEN=
DISCORD_OWNER_ID=
DISCORD_CHANNEL_ID=
DISCORD_PROXY=`}</pre>
          </div>
        </div>
      </section>

      <section id="starbot-step-5" className="starbot-section starbot-two-col starbot-anchor-section">
        <div>
          <h3 className="starbot-section-title">6. 创建并配置 Discord Bot</h3>
          <div className="starbot-req-list">
            <div className="starbot-req-row"><span className="starbot-req-key">步骤 1</span><span className="starbot-req-val">打开 Discord Developer Portal 并创建应用</span></div>
            <div className="starbot-req-row"><span className="starbot-req-key">步骤 2</span><span className="starbot-req-val">创建 Bot，复制 Token，写入 `.env`</span></div>
            <div className="starbot-req-row"><span className="starbot-req-key">步骤 3</span><span className="starbot-req-val">在 OAuth2 URL Generator 中生成邀请链接并勾选必要权限</span></div>
            <div className="starbot-req-row"><span className="starbot-req-key">步骤 4</span><span className="starbot-req-val">邀请 Bot 到服务器并确认目标频道可读写</span></div>
          </div>
        </div>
        <div>
          <h3 className="starbot-section-title">7. 启动与部署（常用方式）</h3>
          <div className="starbot-install-methods">
            <div className="starbot-install-card">
              <div className="starbot-install-label">启动命令（推荐）</div>
              <pre className="starbot-code">{`uv run python start.py`}</pre>
            </div>
            <div className="starbot-install-card">
              <div className="starbot-install-label">备用命令</div>
              <pre className="starbot-code">{`python start.py`}</pre>
            </div>
            <div className="starbot-install-card">
              <div className="starbot-install-label">Windows 双击启动</div>
              <pre className="starbot-code">{`启动Starbot.bat`}</pre>
            </div>
          </div>
          <div className="starbot-install-card" style={{ marginTop: 10 }}>
            <div className="starbot-install-label">部署建议（精简）</div>
            <ul style={listStyle}>
              <li>先在测试频道验证，再用于正式频道。</li>
              <li>长期运行建议使用固定账号与稳定网络/代理配置。</li>
              <li>升级版本后优先执行 <code>/doctor</code> 做依赖诊断。</li>
            </ul>
          </div>
        </div>
      </section>

      <section id="starbot-step-6" className="starbot-section starbot-two-col starbot-anchor-section">
        <div>
          <h3 className="starbot-section-title">8. 启动后基础验证</h3>
          <div className="starbot-install-card">
            <div className="starbot-install-label">建议先测试</div>
            <pre className="starbot-code">{`/status
/doctor
/help
/screenshot`}</pre>
          </div>
          <div className="starbot-install-card" style={{ marginTop: 10 }}>
            <div className="starbot-install-label">验证目标</div>
            <ul style={listStyle}>
              <li>确认 Bot 在线并能回复命令。</li>
              <li>确认依赖能力检测通过（尤其 OCR / 浏览器能力）。</li>
              <li>确认截图功能可正常工作。</li>
            </ul>
          </div>
        </div>
        <div>
          <h3 className="starbot-section-title">9. 可选组件（按需安装）</h3>
          <div className="starbot-install-methods">
            <div className="starbot-install-card">
              <div className="starbot-install-label">Playwright</div>
              <pre className="starbot-code">{`playwright install`}</pre>
            </div>
            <div className="starbot-install-card">
              <div className="starbot-install-label">Tesseract OCR</div>
              <pre className="starbot-code">{`# 安装后加入 PATH，或在 .env 中设置
TESSERACT_PATH=C:\\Program Files\\Tesseract-OCR\\tesseract.exe`}</pre>
            </div>
            <div className="starbot-install-card">
              <div className="starbot-install-label">视频学习相关</div>
              <pre className="starbot-code">{`按需启用 yt-dlp / faster-whisper`}</pre>
            </div>
          </div>
        </div>
      </section>

      <section id="starbot-step-7" className="starbot-section starbot-anchor-section">
        <h3 className="starbot-section-title">10. 常见问题排查</h3>
        <div className="starbot-req-list">
          <div className="starbot-req-row"><span className="starbot-req-key">Bot 无响应</span><span className="starbot-req-val">先执行 `/doctor`，再检查 `DISCORD_BOT_TOKEN`、频道权限与 `DISCORD_PROXY`。</span></div>
          <div className="starbot-req-row"><span className="starbot-req-key">LLM 请求失败</span><span className="starbot-req-val">检查 `LLM_API_BASE / LLM_API_KEY / LLM_MODEL`，必要时配置 `LLM2_*` 作为备用。</span></div>
          <div className="starbot-req-row"><span className="starbot-req-key">依赖导入报错</span><span className="starbot-req-val">确认 Python 版本不低于 3.12，并在当前环境执行 `uv sync` 或 `pip install -r requirements.txt`。</span></div>
          <div className="starbot-req-row"><span className="starbot-req-key">OCR / 浏览器能力异常</span><span className="starbot-req-val">确认 Playwright 浏览器已安装、Tesseract 已安装且 PATH / `TESSERACT_PATH` 正确。</span></div>
        </div>
      </section>
    </section>
  )
}
