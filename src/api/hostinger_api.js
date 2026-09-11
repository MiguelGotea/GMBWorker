/**
 * ============================================================================
 * hostinger_api.js — Comunicación Estándar vía API (MODO ORIGINAL)
 * ============================================================================
 * 
 * Este módulo contiene la implementación original de comunicación con Hostinger
 * a través de endpoints HTTPS en https://api.batidospitaya.com utilizando el
 * header de autenticación X-WSP-Token.
 * 
 * Endpoints utilizados:
 *   - getLocations()       → GET  /api/google/reviews/locations.php
 *   - getExistingReviews() → GET  /api/google/reviews/list.php?locationId=XXX
 *   - upsertReviews()      → POST /api/google/reviews/upsert.php
 * 
 * NOTA: Cuando se restablezca la comunicación TLS/red entre el VPS y Hostinger,
 * este módulo se reactiva cambiando USE_DIRECT_DB = false en hostinger.js.
 * ============================================================================
 */

'use strict';

require('dotenv').config();

const BASE_URL = process.env.HOSTINGER_API_BASE_URL || 'https://api.batidospitaya.com';
const TOKEN    = process.env.HOSTINGER_API_TOKEN    || 'c5b155ba8f6877a2eefca0183ab18e37fe9a6accde340cf5c88af724822cbf50';

const HEADERS = {
  'Content-Type': 'application/json',
  'X-WSP-Token':  TOKEN
};

// ── Helper HTTP ───────────────────────────────────────────────────────────────

async function apiFetch(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { ...HEADERS, ...(options.headers || {}) }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[Hostinger API] ${options.method || 'GET'} ${path} → ${res.status}: ${body}`);
  }

  return res.json();
}

// ── Endpoints ─────────────────────────────────────────────────────────────────

/**
 * GET /api/google/reviews/locations.php
 * Devuelve sucursales con cod_googlebusiness para mapear nombres.
 * @returns {Promise<{success: boolean, locations: Array<{locationId: string, locationName: string}>}>}
 */
async function getLocations() {
  return apiFetch('/api/google/reviews/locations.php');
}

/**
 * GET /api/google/reviews/list.php?locationId=XXX
 * Devuelve reseñas existentes en BD para cálculo de diff.
 * @param {string} locationId
 * @returns {Promise<{success: boolean, reviews: Array}>}
 */
async function getExistingReviews(locationId) {
  return apiFetch(`/api/google/reviews/list.php?locationId=${encodeURIComponent(locationId)}`);
}

/**
 * POST /api/google/reviews/upsert.php
 * Envía un lote de operaciones insert/update/delete.
 * @param {string} locationId
 * @param {Array<{action: 'insert'|'update'|'delete', review: object}>} operations
 * @returns {Promise<{success: boolean, inserted: number, updated: number, deleted: number, errors: Array}>}
 */
async function upsertReviews(locationId, operations) {
  return apiFetch('/api/google/reviews/upsert.php', {
    method: 'POST',
    body: JSON.stringify({ locationId, operations })
  });
}

module.exports = {
  getLocations,
  getExistingReviews,
  upsertReviews
};
