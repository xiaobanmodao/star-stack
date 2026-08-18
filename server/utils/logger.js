/**
 * 简单的日志工具
 * 后续可替换为 winston 或 pino
 */

const getTimestamp = () => new Date().toISOString()

export const logger = {
  info: (message, meta = {}) => {
    console.log(`[${getTimestamp()}] INFO:`, message, meta)
  },

  error: (message, error = null, meta = {}) => {
    console.error(`[${getTimestamp()}] ERROR:`, message, meta)
    if (error?.stack) {
      console.error(error.stack)
    }
  },

  warn: (message, meta = {}) => {
    console.warn(`[${getTimestamp()}] WARN:`, message, meta)
  },

  debug: (message, meta = {}) => {
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[${getTimestamp()}] DEBUG:`, message, meta)
    }
  },
}
