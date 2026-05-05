/**
 * reviews.js — Lógica de sincronización inteligente
 *
 * Detecta 4 casos por reviewId:
 *   NUEVA     → reviewId no existe en BD              → INSERT
 *   EDITADA   → comment o starRating cambió            → UPDATE
 *   RESPUESTA → reviewReplyComment cambió              → UPDATE
 *   ELIMINADA → existe en BD pero no vino de Google   → soft delete (deleted_at)
 *
 * Idempotente: correr dos veces no genera duplicados ni errores.
 */

'use strict';

const gmb       = require('../api/gmb');
const hostinger = require('../api/hostinger');
const pLimit    = require('p-limit');
const fs        = require('fs');
const path      = require('path');

// ── Estado global del sync (compartido con server.js via module cache) ────────
const syncState = {
  running:    false,
  startedAt:  null,
  finishedAt: null,
  result:     null,
  error:      null
};

// ── Utilidades ────────────────────────────────────────────────────────────────

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toISOString().slice(0, 19).replace('T', ' ');
  } catch {
    return '';
  }
}

function truncate(str, max = 3000) {
  if (!str) return '';
  return str.length > max ? str.substring(0, max) : str;
}

/**
 * Convierte un review de la Google API al formato de la tabla ResenasGoogle.
 */
function mapReview(gReview, locationId, locationName) {
  const reply = gReview.reviewReply;
  return {
    locationId,
    locationName,
    reviewId:              gReview.reviewId || '',
    reviewerName:          gReview.reviewer?.displayName || '',
    starRating:            gReview.starRating || '',
    comment:               truncate(gReview.comment || ''),
    createTime:            formatDate(gReview.createTime),
    updateTime:            formatDate(gReview.updateTime),
    reviewReplyComment:    reply ? truncate(reply.comment || '') : '',
    reviewReplyUpdateTime: reply ? formatDate(reply.updateTime) : '',
    extractionDate:        new Date().toISOString().slice(0, 19).replace('T', ' ')
  };
}

// ── Lógica de diff por location ───────────────────────────────────────────────

/**
 * Procesa el diff entre Google y la BD para una location.
 * @param {{locationId, locationName, accountId}} locationInfo
 * @param {Array} googleReviews  reviews crudos de la API de Google
 * @returns {Promise<{locationId, locationName, inserted, updated, deleted, errors}>}
 */
async function syncLocation(locationInfo, googleReviews) {
  const { locationId, locationName } = locationInfo;
  const logEntry = { locationId, locationName, inserted: 0, updated: 0, deleted: 0, errors: [] };

  try {
    // 1. Obtener reviews existentes en nuestra BD
    const existingRes = await hostinger.getExistingReviews(locationId);
    const existing = {};
    for (const r of (existingRes.reviews || [])) {
      existing[r.reviewId] = r;
    }

    // 2. Indexar reviews de Google
    const googleMap = {};
    for (const r of googleReviews) {
      if (r.reviewId) googleMap[r.reviewId] = r;
    }

    // 3. Construir operaciones
    const operations = [];

    // Revisar cada review que viene de Google
    for (const [reviewId, gReview] of Object.entries(googleMap)) {
      const formatted = mapReview(gReview, locationId, locationName);

      if (!existing[reviewId]) {
        // NUEVA
        operations.push({ action: 'insert', review: formatted });
      } else {
        const db = existing[reviewId];
        const commentChanged = formatted.comment           !== (db.comment           || '');
        const ratingChanged  = formatted.starRating        !== (db.starRating        || '');
        const replyChanged   = formatted.reviewReplyComment !== (db.reviewReplyComment || '');

        if (commentChanged || ratingChanged || replyChanged) {
          // EDITADA o RESPUESTA nueva/editada
          operations.push({ action: 'update', review: formatted });
        }
      }
    }

    // Revisar reviews en BD que ya no están en Google → ELIMINADAS
    for (const reviewId of Object.keys(existing)) {
      if (!googleMap[reviewId]) {
        operations.push({ action: 'delete', review: { reviewId, locationId } });
      }
    }

    // 4. Enviar batch solo si hay cambios
    if (operations.length > 0) {
      const result = await hostinger.upsertReviews(locationId, operations);
      logEntry.inserted = result.inserted || 0;
      logEntry.updated  = result.updated  || 0;
      logEntry.deleted  = result.deleted  || 0;
      if (result.errors && result.errors.length) {
        logEntry.errors = result.errors;
      }
    }

  } catch (err) {
    logEntry.errors.push(err.message);
    console.error(`[Sync] Error en ${locationId}: ${err.message}`);
  }

  return logEntry;
}

// ── Orquestador principal ─────────────────────────────────────────────────────

/**
 * Corre el sync completo:
 *   1. Obtiene cuentas y locations de Google
 *   2. Para cada location (con p-limit), descarga reviews y hace diff
 *   3. Guarda resultado en logs/last-sync.json
 *
 * Es idempotente: puede correrse múltiples veces sin duplicados.
 * @returns {Promise<object>} resultado del sync
 */
async function runSync() {
  if (syncState.running) {
    return { already_running: true, startedAt: syncState.startedAt };
  }

  syncState.running    = true;
  syncState.startedAt  = new Date().toISOString();
  syncState.finishedAt = null;
  syncState.result     = null;
  syncState.error      = null;

  const CONCURRENCY = parseInt(process.env.CONCURRENCY) || 5;
  const limit       = pLimit(CONCURRENCY);
  const logLines    = [];

  const ts  = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
  const log = (msg) => { const line = `[${ts()}] ${msg}`; console.log(line); logLines.push(line); };

  try {
    log('════════ GMB Sync iniciado ════════');

    // 1. Cuentas de Google
    const accounts = await gmb.getAccounts();
    log(`Cuentas Google encontradas: ${accounts.length}`);

    // 2. Locations de Google (todas, sin filtro)
    const allGoogleLocations = [];
    for (const account of accounts) {
      const locs = await gmb.getLocations(account.accountId);
      allGoogleLocations.push(...locs);
      log(`  Cuenta ${account.accountId} → ${locs.length} sucursales`);
    }

    // 3. Mapa de nombres desde nuestra API (cod_googlebusiness → nombre local)
    const nameMap = {};
    try {
      const locRes = await hostinger.getLocations();
      for (const loc of (locRes.locations || [])) {
        nameMap[loc.locationId] = loc.locationName;
      }
    } catch (e) {
      log(`WARN: No se pudo cargar mapa de nombres: ${e.message}`);
    }

    // Aplicar nombres locales donde existan
    for (const loc of allGoogleLocations) {
      if (nameMap[loc.locationId]) loc.locationName = nameMap[loc.locationId];
    }

    log(`Total sucursales a sincronizar: ${allGoogleLocations.length}`);

    // 4. Procesar con concurrencia limitada
    const tasks = allGoogleLocations.map((locationInfo) =>
      limit(async () => {
        log(`→ Procesando: ${locationInfo.locationName || locationInfo.locationId}`);

        const googleReviews = await gmb.getLocationReviews(locationInfo.accountId, locationInfo.locationId);
        log(`  Google: ${googleReviews.length} reseñas encontradas`);

        const result = await syncLocation(locationInfo, googleReviews);
        const errMsg = result.errors.length ? ` | ${result.errors.length} error(es)` : '';
        log(`  Resultado: +${result.inserted} nuevas, ~${result.updated} actualizadas, -${result.deleted} eliminadas${errMsg}`);

        return result;
      })
    );

    const results = await Promise.all(tasks);

    // 5. Totales
    const totals = results.reduce(
      (acc, r) => ({
        inserted: acc.inserted + r.inserted,
        updated:  acc.updated  + r.updated,
        deleted:  acc.deleted  + r.deleted,
        errors:   acc.errors   + r.errors.length
      }),
      { inserted: 0, updated: 0, deleted: 0, errors: 0 }
    );

    log(`════════ Sync completado: +${totals.inserted} nuevas, ~${totals.updated} actualizadas, -${totals.deleted} eliminadas, ${totals.errors} errores ════════`);

    syncState.result = { success: true, totals, locations: results, log: logLines };

  } catch (err) {
    log(`ERROR CRÍTICO: ${err.message}`);
    syncState.error  = err.message;
    syncState.result = { success: false, error: err.message, log: logLines };
  } finally {
    syncState.running    = false;
    syncState.finishedAt = new Date().toISOString();

    // Persistir último sync
    const logsDir = path.join(__dirname, '../../logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

    fs.writeFileSync(
      path.join(logsDir, 'last-sync.json'),
      JSON.stringify({ startedAt: syncState.startedAt, finishedAt: syncState.finishedAt, result: syncState.result }, null, 2)
    );

    // Log diario
    const dateStr = new Date().toISOString().slice(0, 10);
    fs.appendFileSync(path.join(logsDir, `sync-${dateStr}.log`), logLines.join('\n') + '\n\n');
  }

  return syncState.result;
}

function getSyncState() {
  return {
    running:    syncState.running,
    startedAt:  syncState.startedAt,
    finishedAt: syncState.finishedAt,
    result:     syncState.result,
    error:      syncState.error
  };
}

module.exports = { runSync, getSyncState };
