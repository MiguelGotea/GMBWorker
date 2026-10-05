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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Helper HTTP ───────────────────────────────────────────────────────────────

async function apiFetch(path, options = {}, retries = 3) {
  const url = `${BASE_URL}${path}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: { ...HEADERS, ...(options.headers || {}) }
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`[Hostinger API] ${options.method || 'GET'} ${path} → ${res.status}: ${body}`);
      }

      return await res.json();
    } catch (err) {
      if (attempt < retries) {
        const delay = (attempt + 1) * 1500;
        console.warn(`[Hostinger API] Error (${err.message}). Reintentando en ${delay}ms (intento ${attempt + 1}/${retries})...`);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
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
 * Envía operaciones insert/update/delete en lotes de 100 para evitar timeouts.
 * @param {string} locationId
 * @param {Array<{action: 'insert'|'update'|'delete', review: object}>} operations
 * @returns {Promise<{success: boolean, inserted: number, updated: number, deleted: number, errors: Array}>}
 */
async function upsertReviews(locationId, operations) {
  if (!operations || operations.length === 0) {
    return { success: true, inserted: 0, updated: 0, deleted: 0, errors: [] };
  }

  const BATCH_SIZE = 100;
  let totalInserted = 0;
  let totalUpdated = 0;
  let totalDeleted = 0;
  const allErrors = [];

  for (let i = 0; i < operations.length; i += BATCH_SIZE) {
    const chunk = operations.slice(i, i + BATCH_SIZE);
    const res = await apiFetch('/api/google/reviews/upsert.php', {
      method: 'POST',
      body: JSON.stringify({ locationId, operations: chunk })
    });

    totalInserted += res.inserted || 0;
    totalUpdated  += res.updated  || 0;
    totalDeleted  += res.deleted  || 0;
    if (res.errors && Array.isArray(res.errors)) {
      allErrors.push(...res.errors);
    }
  }

  return {
    success:  allErrors.length === 0,
    inserted: totalInserted,
    updated:  totalUpdated,
    deleted:  totalDeleted,
    errors:   allErrors
  };
}

module.exports = {
  getLocations,
  getExistingReviews,
  upsertReviews
};
