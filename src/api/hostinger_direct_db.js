/**
 * ============================================================================
 * ⚠️ AJUSTE TEMPORAL: hostinger_direct_db.js
 * ============================================================================
 * 
 * MOTIVO:
 *   Actualmente existe un problema de conectividad / bloqueo TLS entre el VPS
 *   (DigitalOcean) y el servidor de Hostinger donde corre api.batidospitaya.com,
 *   lo que causa ECONNRESET en peticiones HTTPS salientes desde el VPS.
 * 
 * SOLUCIÓN TEMPORAL:
 *   Este módulo conecta DIRECTAMENTE a la base de datos MySQL de Hostinger
 *   utilizando credenciales hardcodeadas (con respaldo en variables de entorno),
 *   emulando la funcionalidad de los endpoints de la API.
 * 
 * ADVERTENCIA:
 *   Este archivo es EXCLUSIVAMENTE TEMPORAL hasta que se solucione la comunicación
 *   TLS/red con api.batidospitaya.com. Una vez restablecida, cambiar USE_DIRECT_DB = false
 *   en hostinger.js para retomar el flujo estándar por API.
 * ============================================================================
 */

'use strict';

require('dotenv').config();

// ── Credenciales Hardcodeadas (Ajuste Temporal) ───────────────────────────────

const DB_CONFIG = {
  host:               process.env.DB_HOST || '145.223.105.42',
  port:     parseInt(process.env.DB_PORT) || 3306,
  database:           process.env.DB_NAME || 'u839374897_erp',
  user:               process.env.DB_USER || 'u839374897_erp',
  password:           process.env.DB_PASS || 'ERpPitHay2025$',
  waitForConnections: true,
  connectionLimit:    5,
  queueLimit:         0,
  connectTimeout:     15000,
};

// ── Pool de conexiones ────────────────────────────────────────────────────────

let pool = null;

function getPool() {
  if (!pool) {
    let mysql;
    try {
      mysql = require('mysql2/promise');
    } catch (e) {
      throw new Error('[DB-DIRECTO-TEMPORAL] Falta el paquete mysql2. Ejecuta: npm install mysql2');
    }
    pool = mysql.createPool(DB_CONFIG);
    console.log('[DB-DIRECTO-TEMPORAL] Pool MySQL inicializado →', DB_CONFIG.host, `(BD: ${DB_CONFIG.database})`);
  }
  return pool;
}

// ── Utilidades ────────────────────────────────────────────────────────────────

function truncate(str, max = 3000) {
  if (!str) return '';
  return str.length > max ? str.substring(0, max) : str;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'America/Managua',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(d).replace('T', ' ');
  } catch {
    return '';
  }
}

// ── getLocations ──────────────────────────────────────────────────────────────

/**
 * Devuelve sucursales con cod_googlebusiness configurado.
 * Equivale a GET /api/google/reviews/locations.php
 * @returns {Promise<{success: true, locations: Array<{locationId: string, locationName: string}>}>}
 */
async function getLocations() {
  const db = getPool();
  const [rows] = await db.query(`
    SELECT
      cod_googlebusiness AS locationId,
      nombre             AS locationName
    FROM sucursales
    WHERE cod_googlebusiness IS NOT NULL
      AND cod_googlebusiness != ''
    ORDER BY nombre ASC
  `);
  return { success: true, locations: rows };
}

// ── getExistingReviews ────────────────────────────────────────────────────────

/**
 * Devuelve reseñas existentes en BD para una location (para cálculo de diff).
 * Equivale a GET /api/google/reviews/list.php?locationId=XXX
 * @param {string} locationId
 * @returns {Promise<{success: true, reviews: Array}>}
 */
async function getExistingReviews(locationId) {
  const db = getPool();
  const [rows] = await db.query(
    `SELECT reviewId, comment, starRating, createTime, updateTime, reviewReplyComment
     FROM ResenasGoogle
     WHERE locationId = ? AND deleted_at IS NULL`,
    [locationId]
  );
  return { success: true, reviews: rows };
}

// ── upsertReviews ─────────────────────────────────────────────────────────────

/**
 * Aplica lote de operaciones insert/update/delete sobre ResenasGoogle en transacción.
 * Equivale a POST /api/google/reviews/upsert.php
 * @param {string} locationId
 * @param {Array<{action: 'insert'|'update'|'delete', review: object}>} operations
 * @returns {Promise<{success: true, inserted: number, updated: number, deleted: number, errors: Array<string>}>}
 */
async function upsertReviews(locationId, operations) {
  const db = getPool();
  const conn = await db.getConnection();

  let inserted = 0, updated = 0, deleted = 0;
  const errors = [];

  const now = formatDate(new Date());

  const CHUNK_SIZE = 50;

  try {
    for (let i = 0; i < operations.length; i += CHUNK_SIZE) {
      const chunk = operations.slice(i, i + CHUNK_SIZE);
      let attempts = 0;
      let committed = false;

      while (attempts < 3 && !committed) {
        attempts++;
        try {
          await conn.beginTransaction();

          for (const op of chunk) {
            const r = op.review;

            if (op.action === 'insert') {
              await conn.query(`
                INSERT INTO ResenasGoogle
                  (locationId, locationName, reviewId, reviewerName,
                   starRating, comment, createTime, updateTime,
                   reviewReplyComment, reviewReplyUpdateTime, extractionDate)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                  comment               = VALUES(comment),
                  starRating            = VALUES(starRating),
                  createTime            = VALUES(createTime),
                  updateTime            = VALUES(updateTime),
                  reviewReplyComment    = VALUES(reviewReplyComment),
                  reviewReplyUpdateTime = VALUES(reviewReplyUpdateTime),
                  extractionDate        = VALUES(extractionDate),
                  deleted_at            = NULL
              `, [
                r.locationId, r.locationName, r.reviewId, r.reviewerName,
                r.starRating, truncate(r.comment), r.createTime, r.updateTime,
                truncate(r.reviewReplyComment), r.reviewReplyUpdateTime, now
              ]);
              inserted++;

            } else if (op.action === 'update') {
              await conn.query(`
                UPDATE ResenasGoogle SET
                  comment               = ?,
                  starRating            = ?,
                  createTime            = ?,
                  updateTime            = ?,
                  reviewReplyComment    = ?,
                  reviewReplyUpdateTime = ?,
                  extractionDate        = ?,
                  deleted_at            = NULL
                WHERE reviewId = ? AND locationId = ?
              `, [
                truncate(r.comment), r.starRating, r.createTime, r.updateTime,
                truncate(r.reviewReplyComment), r.reviewReplyUpdateTime, now,
                r.reviewId, r.locationId
              ]);
              updated++;

            } else if (op.action === 'delete') {
              await conn.query(`
                UPDATE ResenasGoogle SET deleted_at = ?
                WHERE reviewId = ? AND locationId = ?
              `, [now, r.reviewId, r.locationId]);
              deleted++;
            }
          }

          await conn.commit();
          committed = true;
        } catch (err) {
          await conn.rollback();
          const isLock = err.message.includes('Lock wait timeout') || err.message.includes('Deadlock');
          if (isLock && attempts < 3) {
            console.warn(`[DB-DIRECTO-TEMPORAL] Bloqueo detectado en lote ${i}-${i + chunk.length}, reintentando (${attempts}/3)...`);
            await new Promise(r => setTimeout(r, 1000 * attempts));
          } else {
            errors.push(`Lote ${i}-${i + chunk.length}: ${err.message}`);
            console.error(`[DB-DIRECTO-TEMPORAL] Error en lote ${i}-${i + chunk.length}:`, err.message);
            break;
          }
        }
      }
    }
  } finally {
    conn.release();
  }

  return { success: true, inserted, updated, deleted, errors };
}

module.exports = {
  getLocations,
  getExistingReviews,
  upsertReviews,
  getPool
};
