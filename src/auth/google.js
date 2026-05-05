/**
 * google.js — OAuth2 con auto-refresh del access_token
 * Scope: https://www.googleapis.com/auth/business.manage
 *
 * Usa el refresh_token del .env para obtener access_tokens nuevos
 * automáticamente cuando falte menos de 5 minutos para expirar.
 */

'use strict';

require('dotenv').config();
const fetch = require('node-fetch');

class GoogleAuth {
  constructor() {
    this.accessToken = null;
    this.expiresAt = null;  // timestamp ms
  }

  /**
   * Devuelve un access_token válido.
   * Si falta menos de 5 min para expirar (o nunca se obtuvo), refresca primero.
   */
  async getAccessToken() {
    const BUFFER_MS = 5 * 60 * 1000; // 5 minutos
    if (this.accessToken && this.expiresAt && Date.now() < this.expiresAt - BUFFER_MS) {
      return this.accessToken;
    }
    await this._refresh();
    return this.accessToken;
  }

  async _refresh() {
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
      throw new Error(
        'Faltan variables de entorno: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET o GOOGLE_REFRESH_TOKEN'
      );
    }

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: GOOGLE_REFRESH_TOKEN,
        grant_type:    'refresh_token'
      })
    });

    const data = await res.json();

    if (!data.access_token) {
      throw new Error('Error al refrescar access_token: ' + JSON.stringify(data));
    }

    this.accessToken = data.access_token;
    // expires_in viene en segundos (normalmente 3600)
    this.expiresAt = Date.now() + (data.expires_in * 1000);

    console.log(`[Auth] Access token refrescado. Expira en ${Math.round(data.expires_in / 60)} min`);
  }
}

// Singleton — una sola instancia comparte el token entre todos los módulos
module.exports = new GoogleAuth();
