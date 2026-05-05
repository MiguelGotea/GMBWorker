/**
 * hostinger.js — Cliente HTTP hacia api.batidospitaya.com
 * Usa el header X-WSP-Token para autenticación (mismo patrón que otros workers).
 */

'use strict';

require('dotenv').config();
const fetch = require('node-fetch');

const BASE_URL = process.env.HOSTINGER_API_URL || 'https://api.batidospitaya.com';
const TOKEN    = process.env.HOSTINGER_API_TOKEN;

const HEADERS = {
  'Content-Type': 'application/json',
  'X-WSP-Token':  TOKEN
};

// ── Helper ────────────────────────────────────────────────────────────────────

async function apiFetch(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { ...HEADERS, ...(options.headers || {}) }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[Hostinger] ${options.method || 'GET'} ${path} → ${res.status}: ${body}`);
  }

  return res.json();
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
