import { TOKEN_KEY } from '../constants'
import { fetchJson } from '../utils'

/**
 * SSO 共享登录工具
 *
 * 适用场景：
 * 1. 同域名子路径（如 /jieya/ 与主站 /）：localStorage 天然共享，
 *    子项目直接读 TOKEN_KEY 并在请求头带 Authorization: Bearer <token> 即可。
 * 2. 跨源 iframe 嵌入：父窗口加载 <iframe src="https://主站域名/sso.html">，
 *    sso.html 会把本地令牌 postMessage 给父窗口。
 * 3. 跳转带参：跳转前把 token 拼到 URL 上，由 /api/sso/session?token= 校验。
 */

export const getSharedToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

/** 通过 iframe 从主站 /sso.html 获取令牌（跨源场景） */
export const fetchSsoTokenViaIframe = (ssoUrl: string, timeoutMs = 5000): Promise<string | null> => {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe')
    iframe.style.display = 'none'
    iframe.src = ssoUrl
    let settled = false

    const finish = (token: string | null) => {
      if (settled) return
      settled = true
      window.removeEventListener('message', handleMessage)
      iframe.remove()
      resolve(token)
    }

    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'STARSTACK_SSO') {
        finish(typeof event.data.token === 'string' && event.data.token ? event.data.token : null)
      }
    }

    window.addEventListener('message', handleMessage)
    document.body.appendChild(iframe)
    // 主动请求一次（兼容 sso.html 已先加载完的情况）
    window.setTimeout(() => {
      try {
        iframe.contentWindow?.postMessage({ type: 'STARSTACK_SSO_REQUEST' }, '*')
      } catch {
        // 跨源限制时忽略
      }
    }, 300)
    window.setTimeout(() => finish(null), timeoutMs)
  })
}

/** 用令牌向主站换取会话（子项目侧校验登录态） */
export const fetchSsoSession = async (token: string) => {
  const { response, data } = await fetchJson<{
    user: { id: string; name: string; avatar?: string | null; isAdmin: boolean; isBanned: boolean } | null
    token?: string
  }>('/api/sso/session', {
    method: 'POST',
    body: JSON.stringify({ token }),
  })
  if (response.ok && data) return data
  return { user: null, token: undefined }
}
