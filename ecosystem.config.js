/**
 * ecosystem.config.js — Configuración PM2 de gmb-worker
 * Google My Business Reviews Sync — Batidos Pitaya
 *
 * Primer deploy en VPS:
 *   cd /opt/gmb-worker
 *   npm install --production
 *   cp .env.example .env && nano .env   ← llenar tokens Google + Hostinger
 *   ufw allow 3009/tcp
 *   pm2 start ecosystem.config.js && pm2 save
 *
 * Trigger manual desde ERP:
 *   POST http://localhost:3009/sync/trigger
 *
 * Status:
 *   GET http://localhost:3009/sync/status
 */

module.exports = {
  apps: [
    {
      name: 'gmb-worker',
      script: 'src/index.js',
      cwd: '/opt/gmb-worker',
      watch: false,
      instances: 1,
      exec_mode: 'fork',
      // autorestart: true porque el proceso es persistente (HTTP server + cron)
      autorestart: true,
      max_restarts: 10,
      restart_delay: 10000,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production'
      },
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true
    }
  ]
};
