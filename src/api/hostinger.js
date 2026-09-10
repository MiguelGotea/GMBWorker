/**
 * hostinger.js — Acceso directo a MySQL de Hostinger desde el VPS
 *
 * MOTIVO: Hostinger bloquea el IP del VPS (DigitalOcean) a nivel TLS,
 * impidiendo llamadas HTTPS a api.batidospitaya.com.
 * Solución: conectar directamente a MySQL (mismo enfoque que el GAS script anterior).
 *
 * Equivale funcionalmente a los endpoints anteriores:
 *   getLocations()       ← SELECT FROM sucursales WHERE cod_googlebusiness IS NOT NULL
 *   getExistingReviews() ← SELECT FROM ResenasGoogle WHERE locationId = ?
 *   upsertReviews()      ← INSERT/UPDATE/DELETE en ResenasGoogle
 */

'use strict';

require('dotenv').config();
const mysql = require('mysql2/promise');

// ── Pool de conexiones ────────────────────────────────────────────────────────

let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host:               process.env.DB_HOST     || '145.223.105.42',
      port:     parseInt(process.env.DB_PORT)     || 3306,
      database:           process.env.DB_NAME     || 'u839374897_erp',
      user:               process.env.DB_USER     || 'u839374897_erp',
      password:           process.env.DB_PASS     || '',
      waitForConnections: true,
      connectionLimit:    5,
      queueLimit:         0,
      connectTimeout:     15000,
    });
    console.log('[DB] Pool MySQL inicializado →', process.env.DB_HOST);
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
    return new Date(dateStr).toISOString().slice(0, 19).replace('T', ' ');
  } catch {
    return '';
  }
}

// ── getLocations ──────────────────────────────────────────────────────────────

/**
 * Devuelve sucursales con cod_googlebusiness configurado.
 * Equivale a GET /api/google/reviews/locations.php
 * @returns {Promise<{success: true, locations: Array<{locationId, locationName}>}>}
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
 * Devuelve reseñas existentes en BD para una location (para diff).
 * Equivale a GET /api/google/reviews/list.php?locationId=XXX
 * @param {string} locationId
 * @returns {Promise<{success: true, reviews: Array}>}
 */
async function getExistingReviews(locationId) {
  const db = getPool();
  const [rows] = await db.query(
    `SELECT reviewId, comment, starRating, reviewReplyComment
     FROM ResenasGoogle
     WHERE locationId = ? AND deleted_at IS NULL`,
    [locationId]
  );
  return { success: true, reviews: rows };
}

// ── upsertReviews ─────────────────────────────────────────────────────────────

/**
 * Aplica batch de operaciones insert/update/delete sobre ResenasGoogle.
 * Equivale a POST /api/google/reviews/upsert.php
 * @param {string} locationId
 * @param {Array<{action: 'insert'|'update'|'delete', review: object}>} operations
 * @returns {Promise<{success: true, inserted, updated, deleted, errors}>}
 */
async function upsertReviews(locationId, operations) {
  const db = getPool();
  const conn = await db.getConnection();

  let inserted = 0, updated = 0, deleted = 0;
  const errors = [];

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  try {
    await conn.beginTransaction();

    for (const op of operations) {
      try {
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
              updateTime            = ?,
              reviewReplyComment    = ?,
              reviewReplyUpdateTime = ?,
              extractionDate        = ?,
              deleted_at            = NULL
            WHERE reviewId = ? AND locationId = ?
          `, [
            truncate(r.comment), r.starRating, r.updateTime,
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

      } catch (err) {
        errors.push(`${op.action} ${op.review?.reviewId}: ${err.message}`);
        console.error(`[DB] Error en op ${op.action}:`, err.message);
      }
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  return { success: true, inserted, updated, deleted, errors };
}

module.exports = { getLocations, getExistingReviews, upsertReviews };
