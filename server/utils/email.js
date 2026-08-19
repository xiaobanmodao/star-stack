import nodemailer from 'nodemailer'

let transporter = null

const getSmtpConfig = () => {
  const host = String(process.env.SMTP_HOST || '').trim()
  const port = Number(process.env.SMTP_PORT || 587)
  const user = String(process.env.SMTP_USER || '').trim()
  const pass = String(process.env.SMTP_PASS || '')
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465
  const from = String(process.env.MAIL_FROM || user).trim()

  if (!host || !user || !pass || !from) {
    return null
  }
  return { host, port, secure, user, pass, from }
}

const getTransporter = () => {
  const config = getSmtpConfig()
  if (!config) {
    throw new Error('SMTP 邮件服务未配置')
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass,
      },
      requireTLS: !config.secure,
    })
  }
  return { transporter, config }
}

export const isEmailConfigured = () => Boolean(getSmtpConfig())

export const sendRegistrationCode = async ({ email, code }) => {
  const { transporter: mailer, config } = getTransporter()
  await mailer.sendMail({
    from: config.from,
    to: email,
    subject: 'StarStack 注册验证码',
    text: `你的 StarStack 注册验证码是：${code}\n\n验证码 10 分钟内有效。如果不是你本人操作，请忽略此邮件。`,
    html: `<!doctype html><html lang="zh-CN"><body style="font-family:Arial,sans-serif;color:#172033;line-height:1.7"><h2>StarStack 注册验证</h2><p>你的注册验证码是：</p><p style="font-size:30px;font-weight:700;letter-spacing:8px;color:#2563eb">${code}</p><p>验证码 10 分钟内有效。如果不是你本人操作，请忽略此邮件。</p></body></html>`,
  })
}
