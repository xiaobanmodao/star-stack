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
      exp_backoff_restart_delay: 100,
      env: {
        NODE_ENV: 'production',
        PORT: 5174,
        TRUST_PROXY_HOPS: process.env.TRUST_PROXY_HOPS || '1',
        ALLOWED_ORIGINS: 'https://xingzhan.cc,https://www.xingzhan.cc',
        TURNSTILE_HOSTNAMES: 'xingzhan.cc,www.xingzhan.cc',
        TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY || '',
        SMTP_HOST: process.env.SMTP_HOST || '',
        SMTP_PORT: process.env.SMTP_PORT || '587',
        SMTP_SECURE: process.env.SMTP_SECURE || 'false',
        SMTP_USER: process.env.SMTP_USER || '',
        SMTP_PASS: process.env.SMTP_PASS || '',
        MAIL_FROM: process.env.MAIL_FROM || '',
        JUDGE_MEMORY_LIMIT_KB: process.env.JUDGE_MEMORY_LIMIT_KB || '262144'
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
