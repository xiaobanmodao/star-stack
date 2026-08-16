import { fetchJson } from '../utils'

const PUSH_KEY = 'starstack_push_enabled'

const urlBase64ToUint8Array = (base64: string) => {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const base64Url = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64Url)
  const array = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) array[i] = raw.charCodeAt(i)
  return array
}

export const isPushEnabled = () => {
  try {
    return localStorage.getItem(PUSH_KEY) === '1'
  } catch {
    return false
  }
}

/** 开启浏览器推送：请求权限 → 订阅 → 保存到服务端 */
export const enablePush = async (): Promise<{ ok: boolean; message?: string }> => {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return { ok: false, message: '当前浏览器不支持推送通知' }
    }
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      return { ok: false, message: '未获得通知权限，请在浏览器设置中允许' }
    }
    const reg = await navigator.serviceWorker.ready
    const { response, data } = await fetchJson<{ publicKey?: string }>('/api/push/vapid-public-key')
    if (!response.ok || !data?.publicKey) {
      return { ok: false, message: '无法获取推送密钥' }
    }
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(data.publicKey),
    })
    const saveRes = await fetchJson('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    })
    if (!saveRes.response.ok) {
      return { ok: false, message: '订阅保存失败' }
    }
    localStorage.setItem(PUSH_KEY, '1')
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '订阅失败' }
  }
}

/** 关闭浏览器推送 */
export const disablePush = async () => {
  try {
    const reg = await navigator.serviceWorker.ready
    const subscription = await reg.pushManager.getSubscription()
    const endpoint = subscription?.endpoint || ''
    await subscription?.unsubscribe()
    await fetchJson(
      `/api/push/subscribe${endpoint ? `?endpoint=${encodeURIComponent(endpoint)}` : ''}`,
      { method: 'DELETE' }
    )
  } catch {
    // 忽略
  }
  localStorage.removeItem(PUSH_KEY)
}
