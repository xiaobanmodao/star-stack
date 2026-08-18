export const errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err)
  const status = err.status || err.statusCode || 500
  const message = status < 500 ? (err.message || '请求错误') : '服务器内部错误'
  if (status >= 500) {
    console.error('[errorHandler]', req.method, req.path, err)
  }
  res.status(status).json({ message })
}
