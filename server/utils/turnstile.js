const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

const getClientIp = (req) => req.ip || req.socket?.remoteAddress || ''

const getConfiguredHostnames = () => (process.env.TURNSTILE_HOSTNAMES || '')
  .split(',')
  .map((hostname) => hostname.trim().toLowerCase())
  .filter(Boolean)

export const verifyTurnstile = async ({ token, req, action }) => {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim()

  // 本地开发未配置密钥时保持注册/登录可用；生产环境必须失败关闭。
  if (!secret) {
    return {
      ok: process.env.NODE_ENV !== 'production',
      configured: false,
    }
  }
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
    return { ok: false, configured: true }
  }

  const payload = new URLSearchParams({ secret, response: token })
  const clientIp = getClientIp(req)
  if (clientIp) payload.set('remoteip', clientIp)

  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body: payload,
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return { ok: false, configured: true }

    const result = await response.json()
    const expectedHostnames = getConfiguredHostnames()
    const hostnameValid = expectedHostnames.length === 0
      || expectedHostnames.includes(String(result.hostname || '').toLowerCase())
    const actionValid = !action || result.action === action

    return {
      ok: Boolean(result.success && hostnameValid && actionValid),
      configured: true,
    }
  } catch (error) {
    console.error('Turnstile verification failed:', error)
    return { ok: false, configured: true }
  }
}
