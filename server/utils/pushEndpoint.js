const TRUSTED_PUSH_HOSTS = [
  'fcm.googleapis.com',
  'android.googleapis.com',
  'push.services.mozilla.com',
  'push.apple.com',
  'notify.windows.com',
]

// Web Push endpoints are supplied by the browser. Restrict them to known push
// service domains so a user cannot turn notification delivery into an SSRF.
export const isTrustedPushEndpoint = (endpoint) => {
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'https:' || url.username || url.password) return false
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
    return TRUSTED_PUSH_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`))
  } catch {
    return false
  }
}
