// StarStack PM2 生产进程配置
// 项目根目录声明了 "type": "module"，因此配置文件使用 .cjs 扩展名。

module.exports = {
  apps: [
    {
      name: 'star-stack-api',
      cwd: __dirname,
      script: 'server/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 5174,
        ALLOWED_ORIGINS: 'https://xingzhan.cc,https://www.xingzhan.cc',
        TURNSTILE_HOSTNAMES: 'xingzhan.cc,www.xingzhan.cc',
        TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY || ''
      },
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      restart_delay: 4000,
      min_uptime: '10s',
      max_restarts: 10,
      ignore_watch: ['node_modules', 'logs', 'data', '.git'],
      kill_timeout: 5000
    }
  ]
};
