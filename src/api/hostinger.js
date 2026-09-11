/**
 * ============================================================================
 * hostinger.js — Router de Integración con Hostinger (API vs Directo BD)
 * ============================================================================
 * 
 * ⚠️ ATENCIÓN: AJUSTE TEMPORAL ACTIVO POR DEFECTO ⚠️
 * 
 * MOTIVO:
 *   Actualmente existe un problema de conectividad / bloqueo TLS entre el VPS
 *   (DigitalOcean) y Hostinger (api.batidospitaya.com / erp.batidospitaya.com).
 *   Para evitar que el bot de reseñas falle, se implementó una conexión directa
 *   a la base de datos MySQL de Hostinger con credenciales hardcodeadas.
 * 
 * ¿CÓMO RESTABLECER CUANDO SE SOLUCIONE LA COMUNICACIÓN CON LA API?
 *   1. Cambiar la constante `USE_DIRECT_DB` a `false` (justo abajo).
 *   2. Reiniciar el proceso con: `pm2 restart gmb-worker`
 *   ¡Listo! Todo el flujo volverá automáticamente a través de api.batidospitaya.com.
 * ============================================================================
 */

'use strict';

// ── INTERRUPTOR DE MODO DE CONEXIÓN ───────────────────────────────────────────
// true  → Conexión DIRECTA a MySQL Hostinger (Ajuste temporal por bloqueo TLS VPS <-> API)
// false → Conexión ESTÁNDAR vía https://api.batidospitaya.com (Modo original)
const USE_DIRECT_DB = true;

// ── Carga de submódulos separados ─────────────────────────────────────────────
const hostingerApi = require('./hostinger_api');
const hostingerDirectDb = require('./hostinger_direct_db');

// Seleccionar cliente activo
const activeClient = USE_DIRECT_DB ? hostingerDirectDb : hostingerApi;

if (USE_DIRECT_DB) {
  console.warn('╔════════════════════════════════════════════════════════════════════╗');
  console.warn('║ ⚠️  GMBWorker: AJUSTE TEMPORAL ACTIVO                             ║');
  console.warn('║ Modo: Conexión DIRECTA a BD Hostinger (MySQL 145.223.105.42)      ║');
  console.warn('║ (api.batidospitaya.com está puenteado por bloqueo TLS VPS)         ║');
  console.warn('╚════════════════════════════════════════════════════════════════════╝');
} else {
  console.log('[GMBWorker] Modo ESTÁNDAR activo: Comunicación vía api.batidospitaya.com (HTTPS)');
}

// ── Fachada de métodos exportados ─────────────────────────────────────────────

/**
 * Devuelve sucursales con cod_googlebusiness configurado.
 */
async function getLocations() {
  return activeClient.getLocations();
}

/**
 * Devuelve reseñas existentes en BD para una location (para diff).
 * @param {string} locationId
 */
async function getExistingReviews(locationId) {
  return activeClient.getExistingReviews(locationId);
}

/**
 * Aplica batch de operaciones insert/update/delete sobre ResenasGoogle.
 * @param {string} locationId
 * @param {Array<{action: 'insert'|'update'|'delete', review: object}>} operations
 */
async function upsertReviews(locationId, operations) {
  return activeClient.upsertReviews(locationId, operations);
}

module.exports = {
  USE_DIRECT_DB,
  getLocations,
  getExistingReviews,
  upsertReviews,
  // Acceso directo a los submódulos para pruebas o tareas avanzadas
  _api: hostingerApi,
  _directDb: hostingerDirectDb
};