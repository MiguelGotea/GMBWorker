/**
 * index.js — Orquestador principal del GMB Worker
 *
 * Hace dos cosas al arrancar:
 *   1. Inicia el HTTP server (puerto 3009) para trigger manual y status
 *   2. Registra el cron job (default: 0 2 * * * = 2am) para sync automático
 *
 * Para correr manualmente una vez:
 *   node -e "require('./src/sync/reviews').runSync()"
 */

'use strict';

require('dotenv').config();

const cron = require('node-cron');

const { startServer } = require('./server');
const { runSync }     = require('./sync/reviews');

// ── Arrancar servidor HTTP ────────────────────────────────────────────────────
startServer();

// ── Registrar cron ────────────────────────────────────────────────────────────
const schedule = process.env.CRON_SCHEDULE || '0 2 * * *';

if (!cron.validate(schedule)) {
  console.error(`[Cron] Schedule inválido: "${schedule}". Usando default: "0 2 * * *"`);
}

cron.schedule(
  cron.validate(schedule) ? schedule : '0 2 * * *',
  async () => {
    console.log('[Cron] Disparado — iniciando sync automático');
    try {
      await runSync();
    } catch (err) {
      console.error('[Cron] Error en sync:', err.message);
    }
  },
  { timezone: 'America/Managua' }
);

console.log(`[GMB Worker] Listo. Cron: "${schedule}" (America/Managua)`);
console.log('[GMB Worker] Para trigger manual: POST http://localhost:3009/sync/trigger');
