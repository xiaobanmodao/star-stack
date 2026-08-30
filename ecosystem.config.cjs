// StarStack PM2 生产进程配置
// 项目根目录声明了 "type": "module"，因此配置文件使用 .cjs 扩展名。

module.exports = {
  apps: [
    {
      name: 'star-stack-api',
      cwd: __dirname,
      script: 'server/index.js',
      exec_mode: 'fork',
      instances: 1,
      // 生产环境必须使用专用非 root 用户；启动前设置 PM2_USER/PM2_GROUP。
      uid: process.env.PM2_USER || undefined,
      gid: process.env.PM2_GROUP || process.env.PM2_USER || undefined,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      exp_backoff_restart_delay: 100,
      env: {
        NODE_ENV: 'production',
        PORT: 5174,
        HOST: process.env.HOST || '127.0.0.1',
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
        JUDGE_MEMORY_LIMIT_KB: process.env.JUDGE_MEMORY_LIMIT_KB || '262144',
        JUDGE_CONCURRENCY: process.env.JUDGE_CONCURRENCY || '1',
        // PM2 是身份切换前的旧运行器，必须永久保持关闭。OIDC 只允许由
        // root 管理的 systemd credentials 启动，避免 Secret 落入 PM2 dump。
        OIDC_ENABLED: 'false',
        OIDC_ISSUER: process.env.OIDC_ISSUER || 'https://auth.xingzhan.cc',
        OIDC_HYDRA_PUBLIC_URL: process.env.OIDC_HYDRA_PUBLIC_URL || 'http://127.0.0.1:4444',
        OIDC_HYDRA_ADMIN_URL: process.env.OIDC_HYDRA_ADMIN_URL || 'http://127.0.0.1:4445',
        OIDC_TOKEN_HOOK_SECRET: '',
        OIDC_LOGOUT_BROKER_SECRET: ''
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
