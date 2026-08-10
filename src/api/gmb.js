/**
 * gmb.js — Google Business Profile API
 * Maneja: cuentas, locations y reseñas con paginación completa.
 * Retry automático con backoff exponencial en caso de 429 (rate limit).
 */

'use strict';

const fetch = require('node-fetch');
const googleAuth = require('../auth/google');

// ── Utilidades ────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch con auto-refresh de token y retry exponencial en 429/503.
 * @param {string} url
 * @param {object} options  opciones fetch (sin Authorization, se agrega automático)
 * @param {number} retries  máximo de reintentos (default 5)
 */
async function fetchGMB(url, options = {}, retries = 5) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const token = await googleAuth.getAccessToken();

    const res = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        ...(options.headers || {})
      }
    });

    // 401/403 → credenciales inválidas, no tiene sentido reintentar
    if (res.status === 401 || res.status === 403) {
      const body = await res.text();
      throw new Error(`[GMB] Sin autorización (${res.status}) para ${url}: ${body.slice(0, 200)}`);
    }

    // 429 / 503 → rate limit o servicio no disponible → esperar y reintentar
    if (res.status === 429 || res.status === 503) {
      const delay = Math.pow(2, attempt) * 2000 + Math.random() * 1000; // 2s, 4s, 8s, 16s, 32s + jitter
      console.warn(`[GMB] ${res.status} Rate limit. Esperando ${Math.round(delay/1000)}s (intento ${attempt + 1}/${retries + 1})`);
      await sleep(delay);
      continue;
    }

    return res;
  }
  throw new Error(`[GMB] Máximo de reintentos alcanzado para: ${url}`);
}

// ── API: Cuentas ──────────────────────────────────────────────────────────────

/**
 * Devuelve todas las cuentas de Google Business vinculadas al OAuth.
 * @returns {Promise<Array<{accountId: string, name: string}>>}
 */
async function getAccounts() {
  const url = 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts';
  const res = await fetchGMB(url);

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[GMB] getAccounts falló (${res.status}): ${body}`);
  }

  const data = await res.json();
  return (data.accounts || []).map((acc) => ({
    accountId: acc.name.split('/')[1],
    name:      acc.accountName || acc.name
  }));
}

// ── API: Locations ────────────────────────────────────────────────────────────

/**
 * Devuelve todas las locations de una cuenta.
 * @param {string} accountId
 * @returns {Promise<Array<{locationId, accountId, locationName, storeCode}>>}
 */
async function getLocations(accountId) {
  const readMask = 'name,title,storeCode';
  const url = `https://mybusinessbusinessinformation.googleapis.com/v1/accounts/${accountId}/locations`
            + `?pageSize=100&readMask=${encodeURIComponent(readMask)}`;

  const res = await fetchGMB(url);

  if (!res.ok) {
    console.warn(`[GMB] getLocations(${accountId}) → ${res.status}`);
    return [];
  }

  const data = await res.json();
  return (data.locations || []).map((loc) => {
    const parts = loc.name.split('/');
    return {
      locationId:   parts[parts.length - 1],
      accountId,
      locationName: loc.title     || '',
      storeCode:    loc.storeCode || ''
    };
  });
}

// ── API: Reviews ──────────────────────────────────────────────────────────────

/**
 * Descarga TODAS las reseñas de una location con paginación completa.
 * No tiene límite de tiempo — descarga hasta agotar el nextPageToken.
 *
 * @param {string} accountId
 * @param {string} locationId
 * @returns {Promise<Array>} array de review objects de la API de Google
 */
async function getLocationReviews(accountId, locationId) {
  const allReviews = [];
  let pageToken = null;
  let page = 1;

  do {
    let url = `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/reviews?pageSize=100`;
    if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;

    const res = await fetchGMB(url);

    if (!res.ok) {
      const body = await res.text();
      console.warn(`[GMB] getLocationReviews(${locationId}) pág ${page} → ${res.status}: ${body}`);
      break;
    }

    const data = await res.json();
    const pageReviews = data.reviews || [];
    allReviews.push(...pageReviews);

    pageToken = data.nextPageToken || null;

    if (pageToken) {
      // Pausa cortés entre páginas para evitar rate limit
      await sleep(300);
    }

    page++;
  } while (pageToken);

  return allReviews;
}

module.exports = { getAccounts, getLocations, getLocationReviews };
