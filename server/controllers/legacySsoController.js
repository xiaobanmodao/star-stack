export const retireLegacySso = (_req, res) => {
  res.set('Cache-Control', 'no-store')
  return res.status(410).json({
    error: 'legacy_sso_retired',
    message: '旧共享令牌登录已停用，请通过应用的 OpenID Connect 登录入口继续。',
  })
}
