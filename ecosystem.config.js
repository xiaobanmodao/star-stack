// PM2 生态系统配置文件
// 使用方法: pm2 start ecosystem.config.js

module.exports = {
  apps: [
    {
      name: 'star-stack-api',
      script: './server/index.js',
      cwd: './',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 5174
      },
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      // 进程崩溃后的重启延迟
      restart_delay: 4000,
      // 最小运行时间，低于此时间重启视为异常
      min_uptime: '10s',
      // 异常重启次数限制
      max_restarts: 10,
      // 监听文件变化（开发环境可启用）
      ignore_watch: ['node_modules', 'logs', 'data', '.git'],
      // 优雅关闭超时时间
      kill_timeout: 5000
    }
  ]
}
