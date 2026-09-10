/**
 * hostinger.js — Cliente HTTP hacia api.batidospitaya.com
 * Usa el header X-WSP-Token para autenticación (mismo patrón que otros workers).
 *
 * Incluye reintento automático ante ECONNRESET/ETIMEDOUT (común desde VPS a Hostinger).
 */

'use strict';

require('dotenv').config();
const fetch  = require('node-fetch');
const https  = require('https');

const BASE_URL = process.env.HOSTINGER_API_URL || 'https://api.batidospitaya.com';
const TOKEN    = process.env.HOSTINGER_API_TOKEN;

// Agente HTTPS con keep-alive desactivado para evitar ECONNRESET en Hostinger
const httpsAgent = new https.Agent({
  keepAlive: false,
  timeout: 20000,
});

const HEADERS = {
  'Content-Type':  'application/json',
  'X-WSP-Token':   TOKEN,
  'Connection':    'close',         // evita reutilizar conexiones que Hostinger cierra
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Helper con reintento ──────────────────────────────────────────────────────

async function apiFetch(path, options = {}, retries = 3) {
  const url = `${BASE_URL}${path}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        agent:   httpsAgent,
        timeout: 20000,
        headers: { ...HEADERS, ...(options.headers || {}) }
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`[Hostinger] ${options.method || 'GET'} ${path} → ${res.status}: ${body}`);
      }

      return res.json();

    } catch (err) {
      const isRetryable = err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' ||
                          err.type === 'request-timeout' || err.message.includes('ECONNRESET');

      if (isRetryable && attempt < retries) {
        const delay = attempt * 2000; // 2s, 4s
        console.warn(`[Hostinger] ${err.code || err.type} en ${path} — reintentando en ${delay}ms (intento ${attempt}/${retries})`);
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
 * @returns {Promise<{success, locations: Array<{locationId, locationName}>}>}
 */
async function getLocations() {
  return apiFetch('/api/google/reviews/locations.php');
}

/**
 * GET /api/google/reviews/list.php?locationId=XXX
 * Devuelve reseñas existentes en BD para el diff.
 * @param {string} locationId
 * @returns {Promise<{success, reviews: Array}>}
 */
async function getExistingReviews(locationId) {
  return apiFetch(`/api/google/reviews/list.php?locationId=${encodeURIComponent(locationId)}`);
}

/**
 * POST /api/google/reviews/upsert.php
 * Envía un batch de operaciones insert/update/delete.
 * @param {string} locationId
 * @param {Array<{action, review}>} operations
 * @returns {Promise<{success, inserted, updated, deleted, errors}>}
 */
async function upsertReviews(locationId, operations) {
  return apiFetch('/api/google/reviews/upsert.php', {
    method: 'POST',
    body: JSON.stringify({ locationId, operations })
  });
}

module.exports = { getLocations, getExistingReviews, upsertReviews };
