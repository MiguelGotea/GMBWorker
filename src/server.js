/**
 * server.js — Mini HTTP server para trigger manual y status
 * Puerto: process.env.PORT (default 3009)
 *
 * Rutas:
 *   GET  /health         → status del proceso
 *   POST /sync/trigger   → dispara el sync inmediatamente (async, no bloquea)
 *   GET  /sync/status    → devuelve estado actual + último sync guardado
 */

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const { runSync, getSyncState } = require('./sync/reviews');

const PORT = parseInt(process.env.PORT) || 3009;

// ── Helpers ───────────────────────────────────────────────────────────────────

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readLastSync() {
  try {
    const filePath = path.join(__dirname, '../logs/last-sync.json');
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// ── Request handler ───────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const { method, url } = req;

  // GET /health
  if (method === 'GET' && url === '/health') {
    sendJSON(res, 200, {
      status:  'ok',
      service: 'gmb-worker',
      time:    new Date().toISOString()
    });
    return;
  }

  // GET /sync/status
  if (method === 'GET' && url === '/sync/status') {
    const state    = getSyncState();
    const lastSync = readLastSync();
    sendJSON(res, 200, { ...state, lastSync });
    return;
  }

  // POST /sync/trigger
  if (method === 'POST' && url === '/sync/trigger') {
    const state = getSyncState();

    if (state.running) {
      sendJSON(res, 409, {
        error:      'El sync ya está en ejecución',
        startedAt:  state.startedAt
      });
      return;
    }

    // Lanzar async sin esperar — el cliente recibe 202 inmediatamente
    runSync().catch((err) => console.error('[Server] Error en sync manual:', err.message));

    sendJSON(res, 202, {
      message:   'Sync iniciado',
      startedAt: new Date().toISOString()
    });
    return;
  }

  // 404 para cualquier otra ruta
  sendJSON(res, 404, { error: 'Ruta no encontrada' });
});

// ── Exportar función para iniciar el servidor ─────────────────────────────────

function startServer() {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[GMB Worker] HTTP server escuchando en puerto ${PORT}`);
    console.log(`[GMB Worker]   GET  /health`);
    console.log(`[GMB Worker]   GET  /sync/status`);
    console.log(`[GMB Worker]   POST /sync/trigger`);
  });

  server.on('error', (err) => {
    console.error('[Server] Error:', err.message);
  });
}

module.exports = { startServer };
